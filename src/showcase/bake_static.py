"""Bake static assets for the GitHub Pages (static) showcase build.

GitHub Pages can't run the FastAPI backend, so the frontend reads pre-baked static
files instead (see SHOWCASE_PLAN.md). This script produces:

  frontend/public/data/areas.geojson    — simplified choropleth (target ≤ ~6 MB raw,
                                           gzips small; Pages serves it compressed)
  frontend/public/data/methodology.json — trimmed reports/calibration.json

The served GeoJSON is ~150 MB uncompressed, so we shrink hard: simplify geometry in
metres (EPSG:27700), round coordinates to 4 dp (~11 m, lets json write short floats),
keep only the props the UI needs and coarsen them to integers, then reproject to
WGS84. Result ≈ 37 MB raw / ≈ 5 MB gzip — and GitHub Pages serves it gzipped.

Run: `make showcase-data` (after `make risk` + `make calibrate`).
"""
from __future__ import annotations

import json
import logging

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from src.common.config import ROOT
from src.common.io import LSOA_RISK_PARQUET, interim, processed

log = logging.getLogger(__name__)

OUT_DIR = ROOT / "frontend" / "public" / "data"
SIMPLIFY_M = 180.0     # metres — national choropleth; coarse but legible per area
COORD_DP = 4           # ~11 m; rounding coords to 4 dp lets json write short floats

# Props the frontend reads (see utils.featureToDetail + DetailPanel). To keep the
# static payload small we drop raw `_val` columns and coarsen numbers; the map
# colours by `_pct` and the detail panel shows percentile + £ `_contrib`.
# NB: the frontend keys on `lsoa11cd` (== area_code in our data), so emit that.
_BASE_PROPS = ["lsoa11cd", "lsoa_name", "calibrated_premium",
               "premium_place_only", "risk_index", "quintile"]
# Premium drivers + composition controls: keep _pct (map) AND _contrib (£ in panel).
_DRIVERS = ["vehicle_crime", "deprivation", "aadf_intensity",
            "young_driver_share", "cars_per_household"]
# Diagnostics: map-filter colouring only → _pct.
_DIAGNOSTICS = ["road_casualties", "population_density", "traffic_per_capita",
                "ksi_collisions_per_billion_vehicle_miles"]
_COMPONENTS = _DRIVERS + _DIAGNOSTICS


def _component_cols(gdf: gpd.GeoDataFrame) -> list[str]:
    cols = []
    for c in _DRIVERS:
        cols += [s for s in (f"{c}_pct", f"{c}_contrib") if s in gdf.columns]
    for c in _DIAGNOSTICS:
        if f"{c}_pct" in gdf.columns:
            cols.append(f"{c}_pct")
    return cols


def _round_props(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Coarsen numbers to cut JSON entropy: percentiles + risk_index to whole
    integers, £ contributions to whole pounds (premiums are already Int)."""
    out = gdf.copy()
    if "risk_index" in out:
        out["risk_index"] = out["risk_index"].round(0).astype("Int64")
    for c in _COMPONENTS:
        if f"{c}_pct" in out:
            out[f"{c}_pct"] = out[f"{c}_pct"].round(0).astype("Int64")
        if f"{c}_contrib" in out:
            out[f"{c}_contrib"] = out[f"{c}_contrib"].round(0).astype("Int64")
    return out


def build_geojson() -> gpd.GeoDataFrame:
    """Simplified, prop-trimmed choropleth in WGS84."""
    boundaries = gpd.read_parquet(interim("area_boundaries.parquet"))
    features = pd.read_parquet(processed(LSOA_RISK_PARQUET))

    geo = boundaries[["area_code", "geometry"]].copy()
    geo["geometry"] = geo["geometry"].simplify(SIMPLIFY_M)            # in metres (27700)
    gdf = gpd.GeoDataFrame(geo.merge(features, on="area_code", how="inner"),
                           geometry="geometry", crs=boundaries.crs)
    gdf = gdf.to_crs("EPSG:4326")
    # Round coordinates to COORD_DP places — as actual floats, so json.dumps writes
    # the short repr ("-2.3456" not "-2.34560000001"). This is the big size win.
    gdf["geometry"] = shapely.transform(
        gdf.geometry.values, lambda c: np.round(c, COORD_DP)
    )
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]

    cols = [c for c in _BASE_PROPS if c in gdf.columns] + _component_cols(gdf)
    return _round_props(gdf[cols + ["geometry"]])


def build_methodology() -> dict:
    """Trim calibration.json to what the About/methodology panel shows."""
    calib = json.loads((ROOT / "reports" / "calibration.json").read_text())
    keep = ["n_matched", "n_areas", "n_quarters", "feature_basis", "response",
            "place_features", "composition_features", "r_squared", "adj_r_squared",
            "ridge_cv", "leave_one_area_out", "spearman_pred_vs_actual",
            "variance_decomposition", "coefficients", "feature_p_values",
            "feature_analysis", "spatial_multiplier_checks",
            "cross_source_agreement", "national_avg_latest"]
    return {k: calib[k] for k in keep if k in calib}


def run() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    gdf = build_geojson()
    dest = OUT_DIR / "areas.geojson"
    dest.write_text(gdf.to_json(drop_id=True), encoding="utf-8")
    mb = dest.stat().st_size / 1e6
    log.info("Wrote %d features to %s (%.1f MB raw; Pages serves it gzipped ~%.0f%% "
             "smaller)", len(gdf), dest, mb, 87)
    if mb > 45:
        log.warning("areas.geojson is %.1f MB — consider a larger SIMPLIFY_M to keep "
                    "the repo lean.", mb)

    meth = OUT_DIR / "methodology.json"
    meth.write_text(json.dumps(build_methodology()), encoding="utf-8")
    log.info("Wrote %s", meth)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
