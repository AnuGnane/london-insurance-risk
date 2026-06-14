"""M3: turn the feature table into a composite 0-100 risk index.

In  : data/interim/lsoa_features.parquet
Out : data/processed/lsoa_risk.parquet  (+ lsoa_risk.geojson with boundaries)

Steps:
  1. Normalise each feature per settings['risk_index']['normalisation']
     (percentile | zscore | minmax).
  2. Weighted sum using settings['risk_index']['weights'] -> risk_index 0-100.
  3. Bucket into `buckets` quintiles for the legend.
  4. Join geometry and write GeoJSON (EPSG:4326) for the map.

Keep this weight-driven and config-only so calibration (M4) can swap in
back-fit weights and re-run without code changes.
"""
from __future__ import annotations

import logging

import pandas as pd

from src.common.config import settings


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
    """Weighted sum of normalised feature columns -> risk_index."""
    method = settings["risk_index"]["normalisation"]
    score = sum(normalise(features[col], method) * w for col, w in weights.items())
    return score / sum(weights.values())


def run() -> None:
    logging.getLogger(__name__).info("Building composite risk index")
    raise NotImplementedError("Load features, score, bucket, join geometry, write outputs.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
