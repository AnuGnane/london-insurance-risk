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


def enrich_components(features: pd.DataFrame, weights: dict[str, float]) -> list[str]:
    """Add {c}_val and {c}_pct per component (used by the premium model, the map's
    single-driver colour filters, and the click breakdown). The per-driver £
    contributions are added later from the calibration coefficients — see
    bake_premium_and_contributions."""
    cg = _crime_groups(features)
    comps = [c for c in weights if c in features.columns]
    for c in comps:
        # vehicle_crime is ranked within nation-group (E+W vs Scotland) — the two
        # come from different sources on incomparable scales (see normalise()).
        pct = normalise(features[c], "percentile", cg if c == "vehicle_crime" else None)
        features[f"{c}_val"] = features[c].round(2)
        features[f"{c}_pct"] = pct.round(1)
    return comps


def bake_premium_and_contributions(features: pd.DataFrame, comps: list[str]) -> dict:
    """Bake calibrated_premium and per-driver £ contributions from the calibration
    coefficients. Returns the coefficient dict (empty if not calibrated yet).

    Each premium feature's contribution is coef × {feature}_pct — the £ that
    feature adds to the estimate; with the constant they sum to calibrated_premium.
    Features not in the premium model (e.g. road_casualties) contribute £0."""
    calib_path = ROOT / "reports" / "calibration.json"
    coefs = json.loads(calib_path.read_text()).get("coefficients", {}) if calib_path.exists() else {}
    if not coefs:
        log.info("No calibration coefficients yet — skipping premium + £ contributions. "
                 "Run `make calibrate` then rebuild; risk_index falls back to the composite.")
        for c in comps:
            features[f"{c}_contrib"] = 0.0
        return {}

    est = pd.Series(float(coefs.get("const", 0.0)), index=features.index)
    priced: set[str] = set()
    for col, coef in coefs.items():
        if col == "const" or col not in features.columns:
            continue
        est = est + float(coef) * features[col]
        base = col[:-4] if col.endswith("_pct") else col   # vehicle_crime_pct -> vehicle_crime
        features[f"{base}_contrib"] = (float(coef) * features[col]).round(2)
        priced.add(base)
    features["calibrated_premium"] = est.round().astype("Int64")
    for c in comps:                                  # non-premium drivers contribute £0
        if c not in priced:
            features[f"{c}_contrib"] = 0.0
    log.info("Baked calibrated_premium + £ contributions from %d coefficients (priced: %s)",
             len(coefs), ", ".join(sorted(priced)))
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
