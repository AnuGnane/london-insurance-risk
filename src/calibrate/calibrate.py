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
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy.stats import pearsonr, spearmanr
from sklearn.linear_model import LinearRegression, RidgeCV
from sklearn.model_selection import KFold, cross_val_score
from sklearn.preprocessing import StandardScaler
from statsmodels.stats.outliers_influence import variance_inflation_factor

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
_FEATURES = settings.get("features", {})
FEATURE_BASIS = _CALIB.get("feature_basis", "raw")
RESPONSE = _CALIB.get("response", "absolute_gbp")
_SUPPORTED_RESPONSES = {"relative_index"}
if RESPONSE not in _SUPPORTED_RESPONSES:
    raise ValueError(
        f"calibration.response={RESPONSE!r} is not supported. "
        f"Supported values: {sorted(_SUPPORTED_RESPONSES)}"
    )
_BASIS_SUFFIX = "_pct" if FEATURE_BASIS == "percentile" else ""


def _cols(bases: list[str]) -> list[str]:
    return [f"{b}{_BASIS_SUFFIX}" for b in bases]


# PLACE = territorial drivers (the headline territorial effect); COMPOSITION =
# demographic controls (young-driver share, cars/household) included so the place
# coefficients are net of who lives there, then reported separately. See
# NEXT_PHASE_DESIGN.md §2. FEATURE_COLS = all regressors (e.g. "vehicle_crime_pct").
PLACE_COLS = _cols(_FEATURES.get("place") or _CALIB.get("premium_features", ALL_FEATURES))
COMPOSITION_COLS = _cols(_FEATURES.get("composition", []))
FEATURE_COLS = PLACE_COLS + COMPOSITION_COLS


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


def to_relative_index(panel: pd.DataFrame) -> pd.DataFrame:
    """Add `national_avg` and `premium_index` (= premium ÷ national avg) per quarter.

    The national average uses the panel's own 'national'-grain rows where present
    (the published national figure); otherwise it falls back to the cross-row mean
    for that quarter. Modelling the index isolates the *spatial* effect and removes
    the national level/time trend (NEXT_PHASE_DESIGN.md §2.1). Pure function."""
    panel = panel.copy()
    if "grain" in panel.columns and (panel["grain"] == "national").any():
        natl = panel[panel["grain"] == "national"].groupby("quarter")["avg_premium_gbp"].mean()
        panel["national_avg"] = panel["quarter"].map(natl)
        fallback = panel.groupby("quarter")["avg_premium_gbp"].transform("mean")
        panel["national_avg"] = panel["national_avg"].fillna(fallback)
    else:
        panel["national_avg"] = panel.groupby("quarter")["avg_premium_gbp"].transform("mean")
    panel["premium_index"] = panel["avg_premium_gbp"] / panel["national_avg"]
    if "source" not in panel.columns:
        panel["source"] = "confused"
    return panel


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
            "source": r.get("source", "confused"),
            "avg_premium_gbp": r["avg_premium_gbp"],
            "national_avg": r["national_avg"], "premium_index": r["premium_index"],
            **{c: feats.get(c) for c in FEATURE_COLS + ["risk_index"]},
        })

    df = pd.DataFrame(matched)
    if skipped:
        from collections import Counter
        reasons = Counter(f"{n} ({g})" for n, g, _ in skipped)
        log.info("Skipped %d unmatched panel rows: %s", len(skipped), dict(reasons))
    # PLACE features are essential — drop rows missing any (e.g. Scottish areas lack
    # crime). COMPOSITION controls are non-essential at this aggregated grain; fill
    # the rare NaN with the median percentile (50) so a panel area isn't dropped.
    before = len(df)
    df = df.dropna(subset=PLACE_COLS)
    if len(df) < before:
        log.info("Dropped %d matched rows missing a place feature (e.g. Scotland)",
                 before - len(df))
    for c in COMPOSITION_COLS:
        if c in df.columns:
            df[c] = df[c].fillna(50.0)
    return df.reset_index(drop=True)


def _premium_from_logindex(pred_logindex, national_avg) -> "np.ndarray":
    """Convert a predicted log relative-index back to £ for MAE reporting."""
    return np.exp(np.asarray(pred_logindex)) * np.asarray(national_avg)


def _panel_ols(df: pd.DataFrame) -> dict:
    """OLS of log(relative premium index) on place + composition features, with
    area-clustered SEs. Source FE absorbs anchor-methodology level differences when
    more than one source is pooled (Phase 2). No quarter FE — the relative index
    already removes the national level/time trend."""
    rhs = " + ".join(FEATURE_COLS)
    if "source" in df.columns and df["source"].nunique() > 1:
        rhs += " + C(source)"
    model = smf.ols(f"_logindex ~ {rhs}", data=df).fit(
        cov_type="cluster", cov_kwds={"groups": df["area_name"]}
    )
    coefs = {"const": float(model.params["Intercept"])}
    for c in FEATURE_COLS:
        coefs[c] = float(model.params[c])
    expected_pos = set(PLACE_COLS)   # place drivers should raise premium
    sign_checks = {
        c: {"coefficient": float(model.params[c]),
            "sensible": bool(model.params[c] > 0) if c in expected_pos else True,
            "bucket": "place" if c in PLACE_COLS else "composition"}
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


def _ridge_cv(df: pd.DataFrame) -> dict:
    """Ridge K-fold CV-R² in log-index space (standardised features)."""
    X = StandardScaler().fit_transform(df[FEATURE_COLS])
    y = df["_logindex"].values
    ridge = RidgeCV(alphas=np.logspace(-2, 3, 20)).fit(X, y)
    k = min(5, len(df))
    cv = cross_val_score(ridge, X, y, cv=KFold(k, shuffle=True, random_state=0), scoring="r2")
    return {"cv_r_squared_mean": float(cv.mean()), "cv_r_squared_std": float(cv.std()),
            "ridge_alpha": float(ridge.alpha_), "cv_folds": k}


def _leave_one_area_out(df: pd.DataFrame) -> dict:
    """Predict each area from a model fit on the others; MAE in £ (index→£)."""
    errs = []
    for area in df["area_name"].unique():
        tr, te = df["area_name"] != area, df["area_name"] == area
        if tr.sum() < len(FEATURE_COLS) + 2:
            continue
        lr = LinearRegression().fit(df.loc[tr, FEATURE_COLS], df.loc[tr, "_logindex"])
        pred = _premium_from_logindex(lr.predict(df.loc[te, FEATURE_COLS]),
                                      df.loc[te, "national_avg"])
        errs.extend(np.abs(pred - df.loc[te, "avg_premium_gbp"].values))
    return {"mae_gbp": float(np.mean(errs)) if errs else None, "n_predictions": len(errs)}


def _temporal_backtest(df: pd.DataFrame, quarters: list[str]) -> dict:
    """Fit on quarters <= T, predict T+1; MAE £ (index→£) across forward steps."""
    qpos = {q: i for i, q in enumerate(quarters)}
    df = df.assign(_qpos=df["quarter"].map(qpos))
    errs = []
    for i in range(len(quarters) - 1):
        tr = df[df["_qpos"] <= i]
        te = df[df["_qpos"] == i + 1]
        if len(tr) < len(FEATURE_COLS) + 2 or te.empty:
            continue
        lr = LinearRegression().fit(tr[FEATURE_COLS], tr["_logindex"])
        pred = _premium_from_logindex(lr.predict(te[FEATURE_COLS]), te["national_avg"])
        errs.extend(np.abs(pred - te["avg_premium_gbp"].values))
    return {"mae_gbp": float(np.mean(errs)) if errs else None, "n_predictions": len(errs)}


def _variance_decomposition(df: pd.DataFrame) -> dict:
    """R² of log-index explained by place-only, composition-only, and the full model
    — shows how much of the spatial premium variation is place vs composition."""
    def r2(cols: list[str]) -> float | None:
        if not cols:
            return None
        return float(smf.ols("_logindex ~ " + " + ".join(cols), data=df).fit().rsquared)
    return {"place_only_r2": r2(PLACE_COLS),
            "composition_only_r2": r2(COMPOSITION_COLS),
            "full_r2": r2(FEATURE_COLS)}


# Named area pairs for the spatial-multiplier sanity check (postcode areas).
_SPATIAL_PAIRS = [
    ("WC", "CV", "West Central London vs Rugby (CV)"),
    ("EC", "TR", "City of London vs Truro (TR)"),
    ("E", "LD", "East London vs Llandrindod (LD)"),
    ("M", "EX", "Manchester vs Exeter (EX)"),
]


def feature_analysis(df: pd.DataFrame) -> dict:
    """Per-feature: univariate corr, PARTIAL corr (controlling the others), VIF,
    and a keep/drop verdict. Answers 'which factors genuinely predict the spatial
    premium, and which are collinear noise?' (NEXT_PHASE_DESIGN.md §2.3)."""
    y = df["_logindex"]
    design = sm.add_constant(df[FEATURE_COLS])
    vif = {c: float(variance_inflation_factor(design.values, i))
           for i, c in enumerate(design.columns) if c != "const"}
    out = {}
    for c in FEATURE_COLS:
        others = [o for o in FEATURE_COLS if o != c]
        if others:
            rc = df[c] - LinearRegression().fit(df[others], df[c]).predict(df[others])
            ry = y - LinearRegression().fit(df[others], y).predict(df[others])
            partial_r, partial_p = pearsonr(rc, ry)
        else:
            partial_r, partial_p = pearsonr(df[c], y)
        uni_r, _ = pearsonr(df[c], y)
        out[c] = {
            "bucket": "place" if c in PLACE_COLS else "composition",
            "univariate_r": float(uni_r),
            "partial_r": float(partial_r),
            "partial_p": float(partial_p),
            "vif": vif.get(c),
            "verdict": "keep" if (partial_p < 0.05 and vif.get(c, 99) < 10) else "weak",
        }
    return out


def _pred_index(coefs: dict, row) -> float:
    z = float(coefs.get("const", 0.0))
    for c in FEATURE_COLS:
        v = row.get(c)
        if pd.notna(v):
            z += float(coefs.get(c, 0.0)) * float(v)
    return float(np.exp(z))


def spatial_multiplier_checks(coefs: dict, pca: pd.DataFrame) -> list[dict]:
    """Predicted premium ratio for named postcode-area pairs (national average
    cancels in the ratio) — does the model reproduce the real spatial spread?"""
    out = []
    for a, b, label in _SPATIAL_PAIRS:
        if a in pca.index and b in pca.index:
            ra, rb = _pred_index(coefs, pca.loc[a]), _pred_index(coefs, pca.loc[b])
            out.append({"pair": label, "predicted_ratio": round(ra / rb, 2)})
    return out


def fit_calibration(matched: pd.DataFrame) -> dict:
    """Run the full validation ladder on the matched panel."""
    n = len(matched)
    if n < 5:
        return {"n_matched": n, "error": "Too few matched observations for regression",
                "matched_areas": sorted(matched.get("area_name", pd.Series()).unique().tolist())}

    matched = matched.copy()
    matched["_logindex"] = np.log(matched["premium_index"])
    quarters = sorted(matched["quarter"].unique())

    # National average premium per quarter (and latest) — persisted so
    # build_risk_index can reconstruct £ from the index-space coefficients.
    natl_by_q = (matched.groupby("quarter")["national_avg"].first().round(2).to_dict())
    national_avg_latest = float(natl_by_q[quarters[-1]])

    results = {
        "n_matched": n,
        "n_areas": int(matched["area_name"].nunique()),
        "n_quarters": len(quarters),
        "feature_basis": FEATURE_BASIS,
        "response": RESPONSE,
        "place_features": PLACE_COLS,
        "composition_features": COMPOSITION_COLS,
        "premium_features": FEATURE_COLS,
        "national_avg_by_quarter": {str(k): float(v) for k, v in natl_by_q.items()},
        "national_avg_latest": national_avg_latest,
        "grain_counts": {str(k): int(v) for k, v in matched["grain"].value_counts().items()},
        **_panel_ols(matched),
        "ridge_cv": _ridge_cv(matched),
        "leave_one_area_out": _leave_one_area_out(matched),
        "temporal_backtest": _temporal_backtest(matched, quarters),
        "variance_decomposition": _variance_decomposition(matched),
    }

    # Rank validation: does the model's PREDICTED premium rank areas like actual?
    coefs = results["coefficients"]
    pred_log = pd.Series(coefs.get("const", 0.0), index=matched.index)
    for c in FEATURE_COLS:
        pred_log = pred_log + coefs.get(c, 0.0) * matched[c]
    pred_premium = _premium_from_logindex(pred_log, matched["national_avg"])
    rho, p = spearmanr(pred_premium, matched["avg_premium_gbp"])
    results["spearman_pred_vs_actual"] = {"rho": float(rho), "p_value": float(p)}

    # Back-fit importances from standardised coefficients (log-index space).
    Xs = StandardScaler().fit_transform(matched[FEATURE_COLS])
    std_coefs = pd.Series(
        LinearRegression().fit(Xs, matched["_logindex"]).coef_, index=FEATURE_COLS
    ).abs()
    results["backfit_weights"] = {c: float(v) for c, v in (std_coefs / std_coefs.sum()).items()}
    results["feature_analysis"] = feature_analysis(matched)
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
        sp = results["spearman_pred_vs_actual"]
        vd = results["variance_decomposition"]
        lines += [
            "## Fit", "",
            f"- Matched observations: **{results['n_matched']}** "
            f"({results['n_areas']} areas × up to {results['n_quarters']} quarters)",
            f"- Grain mix: {results['grain_counts']}",
            f"- Response: **log(relative premium index)** (area premium ÷ national avg). "
            f"Latest national average £{results.get('national_avg_latest', 0):.0f}.",
            f"- Panel OLS (area-clustered SEs) R²: **{results['r_squared']:.3f}** "
            f"(adj {results['adj_r_squared']:.3f})",
            f"- Ridge {rc['cv_folds']}-fold CV-R² (log-index): **{rc['cv_r_squared_mean']:.3f}** "
            f"± {rc['cv_r_squared_std']:.3f} (α={rc['ridge_alpha']:.2g})",
            f"- Leave-one-area-out MAE: **£{lo['mae_gbp']:.0f}** (n={lo['n_predictions']})"
            if lo["mae_gbp"] is not None else "- Leave-one-area-out MAE: n/a",
            f"- Temporal back-test MAE (predict next quarter): **£{tb['mae_gbp']:.0f}** "
            f"(n={tb['n_predictions']})" if tb["mae_gbp"] is not None
            else "- Temporal back-test MAE: n/a",
            f"- Spearman(predicted, actual premium): **{sp['rho']:.3f}** (p={sp['p_value']:.3g})",
            "",
            "## Place vs composition", "",
            f"- Variance explained — place-only R²: **{vd['place_only_r2']:.3f}** · "
            f"composition-only R²: **{vd['composition_only_r2']:.3f}** · full R²: "
            f"**{vd['full_r2']:.3f}**",
            f"- Place features: {', '.join(results['place_features'])}",
            f"- Composition controls: {', '.join(results['composition_features'])}",
            "",
            "## Coefficient sign checks (log-index space)", "",
            "| Feature | Bucket | Coefficient | p-value | Sensible? |",
            "|---|---|---|---|---|",
        ]
        for c, chk in results["sign_checks"].items():
            pv = results["feature_p_values"][c]
            lines.append(f"| {c} | {chk['bucket']} | {chk['coefficient']:.3f} | {pv:.3g} | "
                         f"{'✅' if chk['sensible'] else '⚠️'} |")
        sm_checks = results.get("spatial_multiplier_checks", [])
        if sm_checks:
            lines += ["", "## Spatial-multiplier sanity checks", "",
                      "| Pair | Predicted premium ratio |", "|---|---|"]
            for s in sm_checks:
                lines.append(f"| {s['pair']} | {s['predicted_ratio']}× |")
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
    _write_feature_analysis(results)
    log.info("Wrote calibration report to %s", md)
    return md


def _write_feature_analysis(results: dict) -> None:
    """Standalone significance report: which factors genuinely predict the
    territorial premium index (partial correlation, VIF, verdict)."""
    fa = results.get("feature_analysis")
    if not fa:
        return
    vd = results.get("variance_decomposition", {})
    lines = [
        "# Feature Analysis — what predicts the territorial premium?", "",
        "Each feature's correlation with the relative premium index (area ÷ national",
        "average): the **univariate** correlation, the **partial** correlation (its",
        "independent contribution, controlling the other features), the **VIF**",
        "(collinearity; >10 = redundant), and a verdict.", "",
        f"Variance explained — **place-only R²={vd.get('place_only_r2', 0):.3f}**, "
        f"**composition-only R²={vd.get('composition_only_r2', 0):.3f}**, "
        f"**full R²={vd.get('full_r2', 0):.3f}**.", "",
        "| Feature | Bucket | Univariate r | Partial r | Partial p | VIF | Verdict |",
        "|---|---|---|---|---|---|---|",
    ]
    for c, a in fa.items():
        vif = f"{a['vif']:.1f}" if a.get("vif") is not None else "—"
        flag = "✅ keep" if a["verdict"] == "keep" else "⚠️ weak"
        lines.append(f"| {_base_name(c)} | {a['bucket']} | {a['univariate_r']:+.2f} | "
                     f"{a['partial_r']:+.2f} | {a['partial_p']:.3g} | {vif} | {flag} |")
    lines += ["", "> Verdict 'keep' = partial p < 0.05 AND VIF < 10. 'weak' = collinear or "
              "not independently significant at this (postcode-area) grain — interpret with care."]
    (REPORTS_DIR / "feature_analysis.md").write_text("\n".join(lines), encoding="utf-8")


def run() -> None:
    log.info("Calibrating the territorial premium index against the WTW panel")
    risk, postcode_lookup, wtw = _load_data()
    wtw = to_relative_index(wtw)
    pca = build_pca_features(risk, postcode_lookup)
    log.info("Rolled up to %d postcode areas", len(pca))
    matched = match_panel(wtw, pca)
    log.info("Matched %d panel observations across %d areas",
             len(matched), matched["area_name"].nunique() if not matched.empty else 0)
    results = fit_calibration(matched)
    if "error" not in results:
        results["spatial_multiplier_checks"] = spatial_multiplier_checks(
            results["coefficients"], pca)
        vd = results["variance_decomposition"]
        log.info("R²=%.3f | CV-R²=%.3f | LOAO MAE=£%s | Spearman(pred,actual)=%.3f | "
                 "place-only R²=%.3f composition-only R²=%.3f",
                 results["r_squared"], results["ridge_cv"]["cv_r_squared_mean"],
                 results["leave_one_area_out"]["mae_gbp"],
                 results["spearman_pred_vs_actual"]["rho"],
                 vd["place_only_r2"], vd["composition_only_r2"])
    _write_report(results)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
