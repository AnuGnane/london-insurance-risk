"""Path conventions + tiny read/write helpers for Parquet and GeoJSON.

Keeps every module agreeing on where interim/processed artefacts live.
"""
from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd

from src.common.config import path

# Canonical artefact names (referenced across modules) ------------------------
LSOA_FEATURES = "lsoa_features.parquet"        # interim, M2
LSOA_RISK_PARQUET = "lsoa_risk.parquet"        # processed, M3
LSOA_RISK_GEOJSON = "lsoa_risk.geojson"        # processed, M3
WTW_ANCHORS = "wtw_anchors.csv"                # interim, M4


def interim(name: str) -> Path:
    return path("interim") / name


def processed(name: str) -> Path:
    return path("processed") / name


def raw(name: str) -> Path:
    return path("raw") / name


def write_parquet(df: pd.DataFrame, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(dest, index=False)
    return dest


def write_geojson(gdf: gpd.GeoDataFrame, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_crs("EPSG:4326").to_file(dest, driver="GeoJSON")
    return dest
