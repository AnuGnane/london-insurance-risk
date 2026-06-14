"""M3: turn the feature table into a composite 0-100 risk index.

In  : data/interim/lsoa_features.parquet
Out : data/processed/lsoa_risk.parquet  (+ lsoa_risk.geojson with boundaries)

Steps:
  1. Normalise each feature per settings['risk_index']['normalisation']
     (percentile | zscore | minmax).
  2. Weighted sum using settings['risk_index']['weights'] → risk_index 0-100.
  3. Bucket into `buckets` quintiles for the legend.
  4. Join geometry and write GeoJSON (EPSG:4326) for the map.

Keep this weight-driven and config-only so calibration (M4) can swap in
back-fit weights and re-run without code changes.
"""
from __future__ import annotations

import logging

import geopandas as gpd
import pandas as pd

from src.common.config import settings
from src.common.io import (
    LSOA_FEATURES,
    LSOA_RISK_GEOJSON,
    LSOA_RISK_PARQUET,
    interim,
    processed,
    write_geojson,
    write_parquet,
)

log = logging.getLogger(__name__)


def normalise(s: pd.Series, method: str) -> pd.Series:
    """Scale a feature to 0-100 by the chosen method."""
    if method == "percentile":
        return s.rank(pct=True) * 100
    if method == "minmax":
        return (s - s.min()) / (s.max() - s.min()) * 100
    if method == "zscore":
        z = (s - s.mean()) / s.std(ddof=0)
        return z  # standardised; rescale downstream if a 0-100 view is needed
    raise ValueError(f"unknown normalisation: {method}")


def composite(features: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    """Weighted sum of normalised feature columns → risk_index."""
    method = settings["risk_index"]["normalisation"]
    score = sum(normalise(features[col], method) * w for col, w in weights.items())
    return score / sum(weights.values())


def bucket(score: pd.Series, n_buckets: int) -> pd.Series:
    """Assign quintile bucket labels 1..n_buckets from a continuous score."""
    return pd.qcut(score, q=n_buckets, labels=range(1, n_buckets + 1)).astype(int)


def run() -> None:
    log.info("Building composite risk index")

    # 1. Load features
    feat_path = interim(LSOA_FEATURES)
    if not feat_path.exists():
        raise FileNotFoundError(
            f"Missing {feat_path} — run `make features` first."
        )
    features = pd.read_parquet(feat_path)
    log.info("Loaded %d LSOA features", len(features))

    # 2. Compute risk index
    weights = settings["risk_index"]["weights"]
    features["risk_index"] = composite(features, weights)
    log.info(
        "Risk index: min=%.1f, median=%.1f, max=%.1f",
        features["risk_index"].min(),
        features["risk_index"].quantile(0.5),
        features["risk_index"].max(),
    )

    # 3. Bucket into quintiles
    n_buckets = settings["risk_index"]["buckets"]
    features["risk_bucket"] = bucket(features["risk_index"], n_buckets)
    log.info("Bucket distribution:\n%s", features["risk_bucket"].value_counts().sort_index())

    # 4. Write tabular risk output
    dest_parquet = processed(LSOA_RISK_PARQUET)
    write_parquet(features, dest_parquet)
    log.info("Wrote risk parquet to %s", dest_parquet)

    # 5. Join geometry and write GeoJSON
    boundary_path = interim("lsoa_boundaries.parquet")
    if not boundary_path.exists():
        log.warning(
            "No boundary parquet — cannot produce GeoJSON. "
            "Run `python -m src.ingest.boundaries` first."
        )
        return

    boundaries = gpd.read_parquet(boundary_path)[["lsoa11cd", "geometry"]]
    gdf = boundaries.merge(features, on="lsoa11cd", how="inner")
    gdf = gpd.GeoDataFrame(gdf, geometry="geometry")

    dest_geojson = processed(LSOA_RISK_GEOJSON)
    write_geojson(gdf, dest_geojson)
    log.info("Wrote risk GeoJSON (%d features) to %s", len(gdf), dest_geojson)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
