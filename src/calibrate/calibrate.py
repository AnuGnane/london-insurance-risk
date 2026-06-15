"""M4b: calibrate the risk index against real published premiums.

In  : data/processed/lsoa_risk.parquet  (+ features)
      data/interim/wtw_anchors.csv
      data/interim/postcode_lookup.parquet  (for LSOA → postcode_area roll-up)
Out : reports/calibration.md  (+ optional fitted weights for build_risk_index)

Steps:
  1. Roll LSOA features up to postcode_area (mean), join to WTW avg premium.
  2. Fit interpretable regression premium ~ features (OLS / Ridge).
     Report coefficients, signs, R². Sanity check: crime ↑ → premium ↑ etc.
  3. (Optional) derive back-fit weights from standardised coefficients; write
     them out so M3 can re-score with market-aligned weights.
  4. Be explicit in the report: WTW's London grain is coarse, so this is a
     directional sanity check + weight aid, NOT a per-LSOA price model.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

from src.common.config import settings, ROOT
from src.common.io import (
    LSOA_RISK_PARQUET,
    WTW_ANCHORS,
    interim,
    processed,
)

log = logging.getLogger(__name__)

REPORTS_DIR = ROOT / "reports"
FEATURE_COLS = list(settings["risk_index"]["weights"].keys())


def _load_data() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load risk features, postcode lookup, and WTW anchors."""
    risk = pd.read_parquet(processed(LSOA_RISK_PARQUET))
    postcode_lookup = pd.read_parquet(interim("postcode_lookup.parquet"))
    wtw = pd.read_csv(interim(WTW_ANCHORS))
    return risk, postcode_lookup, wtw


def rollup_to_postcode_area(
    risk: pd.DataFrame,
    postcode_lookup: pd.DataFrame,
) -> pd.DataFrame:
    """Roll LSOA-level features up to postcode-area grain (mean).

    The WTW index publishes at postcode_area (e.g. 'WC', 'E', 'SW') and
    region ('Inner London', 'Outer London') grain. We aggregate to
    postcode_area first.

    Pure function for testability.
    """
    # Map each LSOA to its dominant postcode area
    # An LSOA may span multiple postcode areas; we use the most common one
    lsoa_pca = (
        postcode_lookup.groupby("lsoa11cd")["postcode_area"]
        .agg(lambda x: x.mode().iloc[0] if len(x) > 0 else None)
        .reset_index()
    )

    merged = risk.merge(lsoa_pca, on="lsoa11cd", how="left")

    # Aggregate features to postcode area level (population-weighted mean)
    if "population" in merged.columns:
        # Weighted average
        def _wmean(group: pd.DataFrame, col: str) -> float:
            weights = group["population"].fillna(1)
            return np.average(group[col].fillna(0), weights=weights)

        rows = []
        for pca, grp in merged.groupby("postcode_area"):
            row = {"postcode_area": pca}
            for col in FEATURE_COLS:
                if col in grp.columns:
                    row[col] = _wmean(grp, col)
            row["risk_index"] = _wmean(grp, "risk_index")
            row["n_lsoas"] = len(grp)
            rows.append(row)
        return pd.DataFrame(rows)
    else:
        # Simple mean fallback
        agg_cols = [c for c in FEATURE_COLS + ["risk_index"] if c in merged.columns]
        return (
            merged.groupby("postcode_area")[agg_cols]
            .mean()
            .reset_index()
        )


def fit_calibration(
    pca_features: pd.DataFrame,
    wtw: pd.DataFrame,
) -> dict:
    """Fit OLS regression: avg_premium ~ features at postcode-area grain.

    Returns dict with model summary, coefficients, R², diagnostics.
    """
    # Join WTW anchors to postcode-area features
    # WTW has postcode_area for postcode-area-grain rows
    wtw_pca = wtw[wtw["grain"] == "postcode_area"].copy()
    if wtw_pca.empty:
        log.warning("No postcode_area-grain WTW anchors — using all rows")
        wtw_pca = wtw.copy()

    joined = pca_features.merge(
        wtw_pca[["postcode_area", "avg_premium_gbp"]],
        on="postcode_area",
        how="inner",
    )

    if len(joined) < 3:
        log.warning(
            "Only %d matched postcode areas — too few for meaningful regression. "
            "Add more WTW anchor rows.",
            len(joined),
        )
        return {
            "n_matched": len(joined),
            "matched_areas": joined["postcode_area"].tolist(),
            "error": "Too few observations for regression",
        }

    # Prepare X and y
    available_features = [c for c in FEATURE_COLS if c in joined.columns]
    X = joined[available_features].fillna(0)
    y = joined["avg_premium_gbp"]

    # OLS with constant
    X_const = sm.add_constant(X)
    model = sm.OLS(y, X_const).fit()

    log.info("Calibration R² = %.3f (n=%d)", model.rsquared, len(joined))
    log.info("Coefficients:\n%s", model.params.to_string())

    # Sign checks
    sign_checks = {}
    expected_positive = ["vehicle_crime", "road_casualties", "deprivation", "population_density"]
    for feat in available_features:
        coef = model.params.get(feat, 0)
        expected = "positive" if feat in expected_positive else "any"
        actual = "positive" if coef > 0 else "negative"
        ok = expected == "any" or expected == actual
        sign_checks[feat] = {
            "coefficient": float(coef),
            "expected_sign": expected,
            "actual_sign": actual,
            "sensible": ok,
        }

    # Back-fit weights from standardised coefficients
    if len(available_features) > 0:
        # Standardise features for comparable coefficient magnitudes
        X_std = (X - X.mean()) / X.std().clip(lower=1e-10)
        X_std_const = sm.add_constant(X_std)
        model_std = sm.OLS(y, X_std_const).fit()

        abs_coefs = model_std.params.drop("const").abs()
        backfit_weights = (abs_coefs / abs_coefs.sum()).to_dict()
    else:
        backfit_weights = {}

    return {
        "n_matched": len(joined),
        "matched_areas": joined["postcode_area"].tolist(),
        "r_squared": float(model.rsquared),
        "adj_r_squared": float(model.rsquared_adj),
        "coefficients": model.params.to_dict(),
        "p_values": model.pvalues.to_dict(),
        "sign_checks": sign_checks,
        "backfit_weights": backfit_weights,
        "ols_summary": model.summary().as_text(),
    }


def _write_report(results: dict) -> Path:
    """Write calibration results to reports/calibration.md."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / "calibration.md"

    lines = [
        "# Calibration Report",
        "",
        "## Overview",
        "",
        "This report validates the composite risk index against the WTW/Confused.com",
        "Car Insurance Price Index. The calibration operates at **postcode-area** grain",
        "(e.g. 'WC', 'E', 'SW') because that is the finest grain the WTW index publishes",
        "for London.",
        "",
    ]

    if "error" in results:
        lines.extend([
            f"> **⚠️ {results['error']}**",
            f"",
            f"Matched postcode areas: {results.get('matched_areas', [])}",
            "",
            "Add more WTW anchor rows to `src/calibrate/wtw_index.py` and re-run.",
        ])
    else:
        lines.extend([
            f"- **Observations**: {results['n_matched']} postcode areas matched",
            f"- **R²**: {results['r_squared']:.3f}",
            f"- **Adjusted R²**: {results['adj_r_squared']:.3f}",
            f"- **Matched areas**: {', '.join(results['matched_areas'])}",
            "",
            "## Coefficient Sign Checks",
            "",
            "| Feature | Coefficient | Expected | Actual | Sensible? |",
            "|---------|------------|----------|--------|-----------|",
        ])

        for feat, check in results["sign_checks"].items():
            emoji = "✅" if check["sensible"] else "❌"
            lines.append(
                f"| {feat} | {check['coefficient']:.4f} | "
                f"{check['expected_sign']} | {check['actual_sign']} | {emoji} |"
            )

        lines.extend([
            "",
            "## Back-fit Weights",
            "",
            "These weights are derived from the absolute standardised regression",
            "coefficients. They represent how the market (WTW index) weights each",
            "factor, as opposed to our expert-set weights.",
            "",
            "| Feature | Expert Weight | Back-fit Weight |",
            "|---------|-------------|----------------|",
        ])

        expert = settings["risk_index"]["weights"]
        for feat, bfw in results.get("backfit_weights", {}).items():
            ew = expert.get(feat, 0)
            lines.append(f"| {feat} | {ew:.2f} | {bfw:.2f} |")

        lines.extend([
            "",
            "## Full OLS Summary",
            "",
            "```",
            results.get("ols_summary", "N/A"),
            "```",
            "",
            "## Caveats",
            "",
            "- The WTW/Confused index publishes London at **region / postcode-area grain**,",
            "  so this calibration is approximate — it validates the *direction* of our risk",
            "  factors, not the per-LSOA precision.",
            "- With only ~3–50 anchor rows, R² should be interpreted cautiously.",
            "- This is a **sanity check + weight aid**, NOT a per-LSOA price model.",
            "- Coefficients may be unstable with few observations.",
        ])

    report_path.write_text("\n".join(lines), encoding="utf-8")
    log.info("Wrote calibration report to %s", report_path)
    
    # Write JSON for M5 API to consume
    import json
    json_path = REPORTS_DIR / "calibration.json"
    json_path.write_text(json.dumps(results, indent=2))
    log.info("Wrote calibration JSON to %s", json_path)
    
    return report_path


def run() -> None:
    log.info("Calibrating risk index against WTW anchors")

    risk, postcode_lookup, wtw = _load_data()

    # Roll up to postcode area
    pca_features = rollup_to_postcode_area(risk, postcode_lookup)
    log.info("Rolled up to %d postcode areas", len(pca_features))

    # Fit calibration
    results = fit_calibration(pca_features, wtw)

    # Write report
    _write_report(results)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
