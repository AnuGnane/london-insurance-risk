"""M4b: calibrate the risk index against the WTW/Confused price-index panel.

In  : data/processed/lsoa_risk.parquet            (area features + risk_index)
      data/interim/wtw_anchors.csv                (multi-quarter, multi-grain panel)
      data/interim/postcode_lookup.parquet        (area_code -> postcode_area)
Out : reports/calibration.{md,json}

Upgrades over the original London-only calibration:
  1. Multi-grain matching — panel rows are matched to model features at their own
     grain: postcode_area / town directly by postcode-area code, region via a
     curated region -> postcode-area mapping (pop-weighted). National rows, NI and
     ambiguous regions are skipped (logged, never silently dropped).
  2. Panel OLS with quarter fixed effects + area-clustered SEs — controls for the
     national premium trend and the repeated-measures structure.
  3. Ridge with K-fold CV — reports CV-R² alongside in-sample R².
  4. Leave-one-area-out hold-out — predict each area from the others; MAE in £.
  5. Temporal back-test — fit on quarters <= T, predict T+1; MAE in £.
  6. Spearman rank correlation — does the index rank areas like the market does?

This remains a directional validation + weight aid, NOT a per-LSOA price model:
the panel grain is far coarser than an LSOA.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy.stats import spearmanr
from sklearn.linear_model import LinearRegression, RidgeCV
from sklearn.model_selection import KFold, cross_val_score
from sklearn.preprocessing import StandardScaler

from src.common.config import ROOT, settings
from src.common.io import LSOA_RISK_PARQUET, WTW_ANCHORS, interim, processed

log = logging.getLogger(__name__)

REPORTS_DIR = ROOT / "reports"

# Every risk-index component (used for the expert-vs-backfit weight comparison).
ALL_FEATURES = list(settings["risk_index"]["weights"].keys())

# The PREMIUM model fits on a configurable subset, measured on a configurable
# basis. Percentile basis (the `{f}_pct` columns baked by build_risk_index) is
# bounded to 0–100, so per-LSOA premiums can't blow up the way raw-unit features
# do on outlier areas (MODEL_REVIEW.md §3.2). road_casualties is excluded by
# config — it's insignificant and wrong-signed at the coarse panel grain — but is
# still ingested and shown as a map driver. FEATURE_COLS is the list of actual
# column names fed to the regression (e.g. "vehicle_crime_pct").
_CALIB = settings.get("calibration", {})
FEATURE_BASIS = _CALIB.get("feature_basis", "raw")
_PREMIUM_BASE = _CALIB.get("premium_features", ALL_FEATURES)
_BASIS_SUFFIX = "_pct" if FEATURE_BASIS == "percentile" else ""
FEATURE_COLS = [f"{f}{_BASIS_SUFFIX}" for f in _PREMIUM_BASE]


def _base_name(col: str) -> str:
    """'vehicle_crime_pct' -> 'vehicle_crime' (strip the basis suffix for display)."""
    return col[: -len(_BASIS_SUFFIX)] if _BASIS_SUFFIX and col.endswith(_BASIS_SUFFIX) else col

# Curated WTW region -> GB postcode areas. Only regions we can define with
# confidence and that have complete model features (E+W) are included. Scottish
# regions are omitted (data.police.uk has no Scottish crime, so vehicle_crime is
# NaN there); Northern Ireland is not modelled; vague regions ("North of
# England", "South Central England", …) are skipped. All skips are logged.
REGION_POSTCODE_AREAS = {
    "Inner London": ["EC", "WC", "E", "N", "NW", "SE", "SW", "W"],
    "Outer London": ["BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"],
    "Manchester / Merseyside": ["M", "L", "BL", "OL", "WN", "SK", "WA"],
    "West Midlands": ["B", "WV", "DY", "WS", "CV"],
    "Leeds / Sheffield": ["LS", "S", "WF", "BD", "HD", "HX", "DN"],
    "South West": ["BS", "BA", "TA", "EX", "PL", "TQ", "TR", "DT", "GL", "SN"],
    "South Wales": ["CF", "NP", "SA"],
    "Central & North Wales": ["LL", "LD", "SY"],
}


def _load_data() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    risk = pd.read_parquet(processed(LSOA_RISK_PARQUET))
    postcode_lookup = pd.read_parquet(interim("postcode_lookup.parquet"))
    wtw = pd.read_csv(interim(WTW_ANCHORS))
    return risk, postcode_lookup, wtw


def _wmean(values: pd.Series, weights: pd.Series) -> float:
    """Population-weighted mean ignoring NaN; NaN if nothing to average."""
    mask = values.notna()
    if not mask.any() or weights[mask].sum() == 0:
        return np.nan
    return float(np.average(values[mask], weights=weights[mask]))


def build_pca_features(risk: pd.DataFrame, postcode_lookup: pd.DataFrame) -> pd.DataFrame:
    """Roll area-level features up to postcode-area grain (population-weighted).

    Pure function for testability. Returns one row per postcode_area with the
    feature columns, risk_index, summed population and area count.
    """
    dominant = (
        postcode_lookup.groupby("area_code")["postcode_area"]
        .agg(lambda x: x.mode().iloc[0] if len(x) else None)
        .reset_index()
    )
    merged = risk.merge(dominant, on="area_code", how="inner")

    rows = []
    for pca, grp in merged.groupby("postcode_area"):
        w = grp["population"].fillna(0)
        row = {"postcode_area": pca, "population": float(w.sum()), "n_areas": len(grp)}
        for col in FEATURE_COLS + ["risk_index"]:
            if col in grp.columns:
                row[col] = _wmean(grp[col], w)
        rows.append(row)
    return pd.DataFrame(rows).set_index("postcode_area")


def _region_features(pca: pd.DataFrame, areas: list[str]) -> dict | None:
    """Population-weighted aggregate of postcode-area features over a region."""
    members = pca[pca.index.isin(areas)]
    if members.empty:
        return None
    w = members["population"].fillna(0)
    out = {"population": float(w.sum()), "n_areas": int(members["n_areas"].sum())}
    for col in FEATURE_COLS + ["risk_index"]:
        out[col] = _wmean(members[col], w)
    return out


def match_panel(wtw: pd.DataFrame, pca: pd.DataFrame) -> pd.DataFrame:
    """Attach model features to each panel row at its own grain.

    Returns matched rows (area_name, grain, quarter, avg_premium_gbp + features).
    Logs every row that cannot be matched (NI, unmapped/ambiguous region, area
    outside GB) rather than dropping it silently.
    """
    matched, skipped = [], []
    for _, r in wtw.iterrows():
        grain, name = r["grain"], r["area_name"]
        feats = None
        if grain in ("postcode_area", "town"):
            code = r.get("postcode_area")
            if pd.notna(code) and code in pca.index:
                feats = pca.loc[code].to_dict()
        elif grain == "region":
            if name in REGION_POSTCODE_AREAS:
                feats = _region_features(pca, REGION_POSTCODE_AREAS[name])
        # national rows carry no geography to match — skipped by design.

        if feats is None:
            skipped.append((name, grain, str(r.get("quarter"))))
            continue
        matched.append({
            "area_name": name, "grain": grain, "quarter": r["quarter"],
            "avg_premium_gbp": r["avg_premium_gbp"],
            **{c: feats.get(c) for c in FEATURE_COLS + ["risk_index"]},
        })

    df = pd.DataFrame(matched)
    if skipped:
        from collections import Counter
        reasons = Counter(f"{n} ({g})" for n, g, _ in skipped)
        log.info("Skipped %d unmatched panel rows: %s", len(skipped), dict(reasons))
    # Drop rows missing any feature (e.g. Scottish postcode areas lack vehicle_crime).
    before = len(df)
    df = df.dropna(subset=FEATURE_COLS)
    if len(df) < before:
        log.info("Dropped %d matched rows with incomplete features (e.g. Scotland)",
                 before - len(df))
    return df.reset_index(drop=True)


def _panel_ols(df: pd.DataFrame) -> dict:
    """OLS: premium ~ features + C(quarter), area-clustered SEs."""
    formula = "avg_premium_gbp ~ " + " + ".join(FEATURE_COLS) + " + C(quarter)"
    model = smf.ols(formula, data=df).fit(
        cov_type="cluster", cov_kwds={"groups": df["area_name"]}
    )
    # Effective intercept averaged over quarters, for a per-area premium estimate.
    qeffects = [0.0] + [
        v for k, v in model.params.items() if k.startswith("C(quarter)")
    ]
    coefs = {"const": float(model.params["Intercept"] + np.mean(qeffects))}
    for c in FEATURE_COLS:
        coefs[c] = float(model.params[c])

    expected_pos = set(FEATURE_COLS)
    sign_checks = {
        c: {"coefficient": float(model.params[c]),
            "sensible": bool(model.params[c] > 0) if c in expected_pos else True}
        for c in FEATURE_COLS
    }
    return {
        "r_squared": float(model.rsquared),
        "adj_r_squared": float(model.rsquared_adj),
        "coefficients": coefs,
        "feature_p_values": {c: float(model.pvalues[c]) for c in FEATURE_COLS},
        "sign_checks": sign_checks,
        "ols_summary": model.summary().as_text(),
    }


def _ridge_cv(df: pd.DataFrame, qidx: pd.Series) -> dict:
    """Ridge with K-fold CV-R²; features + numeric quarter trend, standardised."""
    X = np.column_stack([StandardScaler().fit_transform(df[FEATURE_COLS]),
                         StandardScaler().fit_transform(qidx.values.reshape(-1, 1))])
    y = df["avg_premium_gbp"].values
    ridge = RidgeCV(alphas=np.logspace(-2, 3, 20)).fit(X, y)
    k = min(5, len(df))
    cv = cross_val_score(ridge, X, y, cv=KFold(k, shuffle=True, random_state=0), scoring="r2")
    return {"cv_r_squared_mean": float(cv.mean()), "cv_r_squared_std": float(cv.std()),
            "ridge_alpha": float(ridge.alpha_), "cv_folds": k}


def _leave_one_area_out(df: pd.DataFrame, qidx: pd.Series) -> dict:
    """Predict each area's premiums from a model fit on all other areas; MAE £."""
    X = pd.concat([df[FEATURE_COLS], qidx.rename("qidx")], axis=1)
    y = df["avg_premium_gbp"]
    errs = []
    for area in df["area_name"].unique():
        tr, te = df["area_name"] != area, df["area_name"] == area
        if tr.sum() < len(FEATURE_COLS) + 2:
            continue
        pred = LinearRegression().fit(X[tr], y[tr]).predict(X[te])
        errs.extend(np.abs(pred - y[te].values))
    return {"mae_gbp": float(np.mean(errs)) if errs else None,
            "n_predictions": len(errs)}


def _temporal_backtest(df: pd.DataFrame, quarters: list[str]) -> dict:
    """Fit on quarters <= T, predict T+1; MAE £ across all forward steps."""
    qpos = {q: i for i, q in enumerate(quarters)}
    df = df.assign(_qpos=df["quarter"].map(qpos))
    errs = []
    for i in range(len(quarters) - 1):
        tr = df[df["_qpos"] <= i]
        te = df[df["_qpos"] == i + 1]
        if len(tr) < len(FEATURE_COLS) + 2 or te.empty:
            continue
        model = LinearRegression().fit(tr[FEATURE_COLS], tr["avg_premium_gbp"])
        pred = model.predict(te[FEATURE_COLS])
        errs.extend(np.abs(pred - te["avg_premium_gbp"].values))
    return {"mae_gbp": float(np.mean(errs)) if errs else None,
            "n_predictions": len(errs)}


def fit_calibration(matched: pd.DataFrame) -> dict:
    """Run the full validation ladder on the matched panel."""
    n = len(matched)
    if n < 5:
        return {"n_matched": n, "error": "Too few matched observations for regression",
                "matched_areas": sorted(matched.get("area_name", pd.Series()).unique().tolist())}

    quarters = sorted(matched["quarter"].unique())
    qidx = matched["quarter"].map({q: i for i, q in enumerate(quarters)}).astype(float)

    results = {
        "n_matched": n,
        "n_areas": int(matched["area_name"].nunique()),
        "n_quarters": len(quarters),
        "feature_basis": FEATURE_BASIS,
        "premium_features": FEATURE_COLS,
        "grain_counts": {str(k): int(v) for k, v in matched["grain"].value_counts().items()},
        **_panel_ols(matched),
        "ridge_cv": _ridge_cv(matched, qidx),
        "leave_one_area_out": _leave_one_area_out(matched, qidx),
        "temporal_backtest": _temporal_backtest(matched, quarters),
    }

    # Rank validation: does the rolled risk_index rank areas like premiums do?
    rho, p = spearmanr(matched["risk_index"], matched["avg_premium_gbp"])
    results["spearman_risk_vs_premium"] = {"rho": float(rho), "p_value": float(p)}

    # Back-fit weights from standardised feature coefficients.
    Xs = StandardScaler().fit_transform(matched[FEATURE_COLS])
    std_coefs = pd.Series(
        LinearRegression().fit(Xs, matched["avg_premium_gbp"]).coef_, index=FEATURE_COLS
    ).abs()
    results["backfit_weights"] = {c: float(v) for c, v in (std_coefs / std_coefs.sum()).items()}
    return results


def _write_report(results: dict) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    lines = ["# Calibration Report", "",
             "Validates the composite risk index against the WTW/Confused.com price",
             "index panel (multi-quarter, multi-grain). Directional validation + weight",
             "aid — the panel grain is far coarser than an LSOA, so this is NOT a",
             "per-LSOA price model.", ""]

    if "error" in results:
        lines += [f"> ⚠️ {results['error']}",
                  "", f"Matched areas: {results.get('matched_areas', [])}"]
    else:
        rc = results["ridge_cv"]
        lo = results["leave_one_area_out"]
        tb = results["temporal_backtest"]
        sp = results["spearman_risk_vs_premium"]
        lines += [
            "## Fit", "",
            f"- Matched observations: **{results['n_matched']}** "
            f"({results['n_areas']} areas × up to {results['n_quarters']} quarters)",
            f"- Grain mix: {results['grain_counts']}",
            f"- Panel OLS (quarter FE, area-clustered SEs) R²: **{results['r_squared']:.3f}** "
            f"(adj {results['adj_r_squared']:.3f})",
            f"- Ridge {rc['cv_folds']}-fold CV-R²: **{rc['cv_r_squared_mean']:.3f}** "
            f"± {rc['cv_r_squared_std']:.3f} (α={rc['ridge_alpha']:.2g})",
            f"- Leave-one-area-out MAE: **£{lo['mae_gbp']:.0f}** (n={lo['n_predictions']})"
            if lo["mae_gbp"] is not None else "- Leave-one-area-out MAE: n/a",
            f"- Temporal back-test MAE (predict next quarter): **£{tb['mae_gbp']:.0f}** "
            f"(n={tb['n_predictions']})" if tb["mae_gbp"] is not None
            else "- Temporal back-test MAE: n/a",
            f"- Spearman(risk_index, premium): **{sp['rho']:.3f}** (p={sp['p_value']:.3g})",
            f"- Premium feature basis: **{results.get('feature_basis', 'raw')}** "
            f"(features: {', '.join(results.get('premium_features', []))})",
            "",
            "## Coefficient sign checks", "",
            "| Feature | Coefficient | p-value | Sensible (>0)? |",
            "|---|---|---|---|",
        ]
        for c, chk in results["sign_checks"].items():
            pv = results["feature_p_values"][c]
            lines.append(f"| {c} | {chk['coefficient']:.3f} | {pv:.3g} | "
                         f"{'✅' if chk['sensible'] else '❌'} |")
        lines += ["", "## Expert vs back-fit weights", "",
                  "| Feature | Expert | Back-fit |", "|---|---|---|"]
        expert = settings["risk_index"]["weights"]
        for c, bfw in results["backfit_weights"].items():
            base = _base_name(c)
            lines.append(f"| {base} | {expert.get(base, 0):.2f} | {bfw:.2f} |")
        lines += ["", "## Full OLS summary", "", "```", results["ols_summary"], "```", "",
                  "## Caveats", "",
                  "- WTW publishes at region / postcode-area / town grain — coarser than LSOA.",
                  f"- Premium fit on the **{results.get('feature_basis', 'raw')}** feature basis. "
                  "Percentile (0–100) bounds per-LSOA extrapolation; raw units overshoot on outlier",
                  "  areas (commercial LSOAs with tiny resident denominators, single-block density).",
                  "- road_casualties is excluded from the premium (insignificant + wrong-signed at this",
                  "  grain); it remains an ingested, displayed map driver.",
                  "- Scottish rows are dropped while Scotland lacks vehicle_crime; NI and ambiguous",
                  "  regions are skipped. See the log for exact counts.",
                  "- Coefficients feed a per-area premium estimate, not a precise quote."]

    md = REPORTS_DIR / "calibration.md"
    md.write_text("\n".join(lines), encoding="utf-8")
    (REPORTS_DIR / "calibration.json").write_text(
        json.dumps({k: v for k, v in results.items() if k != "ols_summary"}, indent=2)
    )
    log.info("Wrote calibration report to %s", md)
    return md


def run() -> None:
    log.info("Calibrating risk index against the WTW panel")
    risk, postcode_lookup, wtw = _load_data()
    pca = build_pca_features(risk, postcode_lookup)
    log.info("Rolled up to %d postcode areas", len(pca))
    matched = match_panel(wtw, pca)
    log.info("Matched %d panel observations across %d areas",
             len(matched), matched["area_name"].nunique() if not matched.empty else 0)
    results = fit_calibration(matched)
    if "error" not in results:
        log.info("Panel R²=%.3f | CV-R²=%.3f | LOAO MAE=£%s | Spearman=%.3f",
                 results["r_squared"], results["ridge_cv"]["cv_r_squared_mean"],
                 results["leave_one_area_out"]["mae_gbp"],
                 results["spearman_risk_vs_premium"]["rho"])
    _write_report(results)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
