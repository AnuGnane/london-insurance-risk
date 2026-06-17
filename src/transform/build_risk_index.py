"""M3: turn the feature table into a composite 0-100 risk index.

In  : data/interim/lsoa_features.parquet
Out : data/processed/lsoa_risk.parquet          (full, enriched — read by the API)
      data/processed/lsoa_risk.geojson.gz        (slim, gzipped — served to the map)

What changed vs the original:
  - Bakes per-component display fields into the output so the *map* can show a
    full breakdown on click and recolour by a single driver:
      {c}_val, {c}_pct, {c}_contrib   for each component, plus `quintile`.
  - Bakes `calibrated_premium` per LSOA *if* reports/calibration.json exists
    (so re-running `make risk` after `make calibrate` shows the premium on click).
  - Carries `lsoa_name` from the boundaries (friendlier titles + rankings).
  - Writes a gzipped GeoJSON, which is what main.py serves.

Keep this weight-driven and config-only so calibration can swap in back-fit
weights and re-run without code changes.
"""
from __future__ import annotations

import gzip
import json
import logging

import geopandas as gpd
import numpy as np
import pandas as pd

from src.common.config import settings, ROOT
from src.common.io import LSOA_FEATURES, LSOA_RISK_PARQUET, interim, processed, write_parquet

log = logging.getLogger(__name__)


def normalise(s: pd.Series, method: str, groups: pd.Series | None = None) -> pd.Series:
    """Scale a feature to 0-100 by the chosen method.

    If ``groups`` is given, normalise WITHIN each group (used for vehicle crime,
    where England+Wales and Scotland come from different sources on
    incomparable scales — only the within-nation ordering is meaningful, exactly
    as for deprivation)."""
    if groups is not None:
        return s.groupby(groups).transform(lambda x: normalise(x, method))
    if method == "percentile":
        return s.rank(pct=True) * 100
    if method == "minmax":
        return (s - s.min()) / (s.max() - s.min()) * 100
    if method == "zscore":
        return (s - s.mean()) / s.std(ddof=0)
    raise ValueError(f"unknown normalisation: {method}")


# Features measured by nation-specific sources on incomparable scales → ranked
# within nation-group before use. Maps nation -> comparability group.
_CRIME_SOURCE_GROUP = {"england": "ew", "wales": "ew", "scotland": "scotland"}


def _crime_groups(features: pd.DataFrame) -> pd.Series | None:
    """Comparability groups for vehicle_crime, or None if no nation column."""
    if "nation" not in features.columns:
        return None
    return features["nation"].map(_CRIME_SOURCE_GROUP).fillna("other")


def composite(features: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    """Weighted mean of normalised feature columns → risk_index.

    Reweights per row over the features that are present, so an area missing a
    feature (e.g. Scotland has no vehicle_crime) is scored from its remaining
    features with their weights renormalised — rather than scoring NaN or
    silently treating the gap as zero. With all features present this is exactly
    the weighted average sum(norm*w)/sum(w).
    """
    method = settings["risk_index"]["normalisation"]
    cg = _crime_groups(features)
    norm = pd.DataFrame({
        col: normalise(features[col], method, cg if col == "vehicle_crime" else None)
        for col in weights
    })
    w = pd.Series(weights, dtype=float)
    weighted_sum = (norm * w).sum(axis=1)            # NaNs skipped by pandas
    weight_total = (norm.notna() * w).sum(axis=1)    # only present features count
    return weighted_sum / weight_total.replace(0, pd.NA)


def bucket(score: pd.Series, n_buckets: int) -> pd.Series:
    """Assign quintile bucket labels 1..n_buckets from a continuous score."""
    return pd.qcut(score, q=n_buckets, labels=range(1, n_buckets + 1)).astype(int)


def model_features() -> list[str]:
    """All feature base-names to bake per area: legacy risk-index weights plus the
    declared place + composition + diagnostic features (de-duplicated,
    order-preserving). Diagnostics (e.g. traffic, KSI rate) are shown on the map but
    are not premium drivers — see config features.diagnostics."""
    feats = settings.get("features", {})
    ordered = (list(settings["risk_index"]["weights"].keys())
               + feats.get("place", []) + feats.get("composition", [])
               + feats.get("diagnostics", []))
    seen: set[str] = set()
    return [f for f in ordered if not (f in seen or seen.add(f))]


def enrich_components(features: pd.DataFrame, weights: dict[str, float]) -> list[str]:
    """Add {c}_val and {c}_pct per feature (used by the premium model, the map's
    single-driver colour filters, and the click breakdown). Covers place AND
    composition features. £ contributions are added later from the calibration
    coefficients — see bake_premium_and_contributions."""
    cg = _crime_groups(features)
    comps = [c for c in model_features() if c in features.columns]
    for c in comps:
        # vehicle_crime is ranked within nation-group (E+W vs Scotland) — the two
        # come from different sources on incomparable scales (see normalise()).
        pct = normalise(features[c], "percentile", cg if c == "vehicle_crime" else None)
        features[f"{c}_val"] = features[c].round(2)
        features[f"{c}_pct"] = pct.round(1)
    return comps


MEDIAN_PCT = 50.0   # percentile of a "national-average" area for a given factor


def bake_premium_and_contributions(features: pd.DataFrame, comps: list[str]) -> dict:
    """Bake the three premium numbers + per-driver £ contributions from the
    calibration (a log relative-index model). Returns the coefficient dict.

    premium £ = national_avg × exp(const + Σ coef × {feature}_pct).
      - calibrated_premium     — full prediction (place + composition).
      - premium_place_only     — composition controls held at the national mean
        (pct=50): "what the area costs at national-average demographics".
    Missing controls (e.g. Scotland's uningested demographics, or 2011/2021 LSOA
    mismatches) are held at the national mean, so those areas equal place-only.
    Per-driver contribution £ = full − (that feature held at the national mean):
    the £ this factor adds versus a median area (multiplicative model → these are
    interpretable deltas, not an exact additive split)."""
    calib_path = ROOT / "reports" / "calibration.json"
    calib = json.loads(calib_path.read_text()) if calib_path.exists() else {}
    coefs = calib.get("coefficients", {})
    national_avg = calib.get("national_avg_latest")
    if not coefs or national_avg is None:
        log.info("No calibration (coefficients/national_avg) yet — skipping premium. "
                 "Run `make calibrate` then rebuild; risk_index falls back to the composite.")
        for c in comps:
            features[f"{c}_contrib"] = 0.0
        return {}

    composition_cols = set(calib.get("composition_features", []))
    const = float(coefs["const"])
    all_model_cols = [c for c in coefs if c != "const"]
    missing = [c for c in all_model_cols if c not in features.columns]
    if missing:
        log.warning(
            "Calibration features missing from feature table — treating as national mean (pct=50): %s",
            missing,
        )
    model_cols = all_model_cols

    def predict(hold_at_median: set[str]) -> pd.Series:
        z = pd.Series(const, index=features.index)
        for col in model_cols:
            if col in hold_at_median or col not in features.columns:
                vals = MEDIAN_PCT
            else:
                vals = features[col].fillna(MEDIAN_PCT)
            z = z + float(coefs[col]) * vals
        return float(national_avg) * np.exp(z)

    premium_full = predict(hold_at_median=set())
    premium_place_only = predict(hold_at_median=composition_cols)
    features["calibrated_premium"] = premium_full.round().astype("Int64")
    features["premium_place_only"] = premium_place_only.round().astype("Int64")

    priced: set[str] = set()
    for col in model_cols:
        base = col[:-4] if col.endswith("_pct") else col
        features[f"{base}_contrib"] = (premium_full - predict({col})).round(2)
        priced.add(base)
    for c in comps:                                  # features not in the model contribute £0
        if c not in priced:
            features[f"{c}_contrib"] = 0.0
    log.info("Baked premium (full £%.0f–£%.0f, place-only £%.0f–£%.0f) from %d coefficients",
             premium_full.min(), premium_full.max(),
             premium_place_only.min(), premium_place_only.max(), len(coefs))
    return coefs


def run() -> None:
    log.info("Building composite risk index")

    # 1. Load features
    feat_path = interim(LSOA_FEATURES)
    if not feat_path.exists():
        raise FileNotFoundError(f"Missing {feat_path} — run `make features` first.")
    features = pd.read_parquet(feat_path)
    log.info("Loaded %d LSOA features", len(features))

    # 2. Per-component percentiles (needed by the premium model + map filters)
    weights = settings["risk_index"]["weights"]
    comps = enrich_components(features, weights)

    # 3. Calibrated premium + per-driver £ contributions
    coefs = bake_premium_and_contributions(features, comps)

    # 4. risk_index. Reconciled model: risk_index IS the calibrated premium on a
    #    0–100 scale (its GB-wide percentile), so the map's colouring, the
    #    quintiles and the headline £ are one construct. Falls back to the expert
    #    composite only when calibration hasn't been run yet (first build).
    if coefs and "calibrated_premium" in features:
        features["risk_index"] = features["calibrated_premium"].rank(pct=True) * 100
        log.info("risk_index = percentile of calibrated_premium (premium-reconciled): "
                 "premium £%.0f–£%.0f",
                 features["calibrated_premium"].min(), features["calibrated_premium"].max())
    else:
        features["risk_index"] = composite(features, weights)
        log.info("risk_index = expert composite (no calibration yet): min=%.1f median=%.1f max=%.1f",
                 features["risk_index"].min(), features["risk_index"].quantile(0.5),
                 features["risk_index"].max())

    # 5. Quintile buckets (+ a `quintile` alias the frontend reads directly)
    n_buckets = settings["risk_index"]["buckets"]
    features["risk_bucket"] = bucket(features["risk_index"], n_buckets)
    features["quintile"] = features["risk_bucket"].astype(int)
    log.info("Bucket distribution:\n%s", features["risk_bucket"].value_counts().sort_index())

    # 6. Boundaries: needed for geometry, and a source of area names
    boundary_path = interim("area_boundaries.parquet")
    boundaries = None
    if boundary_path.exists():
        boundaries = gpd.read_parquet(boundary_path)
        name_col = next(
            (c for c in ["area_name", "lsoa11nm", "LSOA11NM", "lsoa21nm", "name"]
             if c in boundaries.columns),
            None,
        )
        if name_col:
            features = features.merge(
                boundaries[["area_code", name_col]].rename(columns={name_col: "lsoa_name"}),
                on="area_code",
                how="left",
            )

    # 7. Write the full, enriched tabular output (the API reads this)
    dest_parquet = processed(LSOA_RISK_PARQUET)
    write_parquet(features, dest_parquet)
    log.info("Wrote enriched risk parquet to %s", dest_parquet)

    # 8. Build a SLIM, gzipped GeoJSON for the map (only the props the UI uses)
    if boundaries is None:
        log.warning(
            "No boundary parquet — cannot produce GeoJSON. "
            "Run `python -m src.ingest.boundaries` first."
        )
        return

    geo = boundaries[["area_code", "geometry"]].copy()
    # Simplify in EPSG:27700 (metres) to shrink the payload, then reproject.
    geo["geometry"] = geo["geometry"].simplify(15)
    gdf = gpd.GeoDataFrame(geo.merge(features, on="area_code", how="inner"), geometry="geometry")
    gdf = gdf.to_crs("EPSG:4326")

    keep = ["area_code", "lsoa11cd", "risk_index", "quintile"]
    if "lsoa_name" in gdf.columns:
        keep.append("lsoa_name")
    if "calibrated_premium" in gdf.columns:
        keep.append("calibrated_premium")
    if "premium_place_only" in gdf.columns:
        keep.append("premium_place_only")
    for c in comps:
        keep += [f"{c}_val", f"{c}_pct", f"{c}_contrib"]

    slim = gdf[keep + ["geometry"]].copy()
    slim["risk_index"] = slim["risk_index"].round(2)

    dest_gz = processed("lsoa_risk.geojson.gz")
    with gzip.open(dest_gz, "wt", encoding="utf-8") as f:
        f.write(slim.to_json())
    log.info("Wrote gzipped GeoJSON (%d features) to %s", len(slim), dest_gz)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
