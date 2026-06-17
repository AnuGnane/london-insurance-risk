"""Ingest flood-risk exposure per small area (Phase 4).

Feature: `flood_risk` = the share of each area's land that lies in a High-or-Medium
flood-risk zone (rivers + sea), 0–1. It is percentile-ranked **within nation** in
build_risk_index (the EA, NRW and SEPA maps are separate sources on incomparable
absolute scales — same treatment as deprivation and vehicle crime). Added as a
PLACE *candidate*; the calibration evidence gate (reports/feature_analysis.md)
decides whether it drives the premium or stays a map diagnostic.

Sources (within-nation; High+Medium = "at risk"):
  - England : EA Risk of Flooding from Rivers and Sea (RoFRS), OGL v3.0
  - Wales   : NRW Flood Risk Assessment Wales (FRAW), OGL
  - Scotland: SEPA river + coastal Flood Maps, OGL v3.0

Grain: flood-extent polygons → areal intersection with area_boundaries (EPSG:27700)
       → intersection area ÷ area area = flood_risk share.
Out  : data/interim/flood.parquet  (columns: area_code, flood_risk)

The national flood layers are large and several sit behind ESRI REST / WMS rather
than a single static download, so this ingest is **drop-in friendly**: it reads
pre-fetched extent files from data/raw/flood/<nation>/ and no-ops gracefully
(logging what to fetch) when they're absent — the pipeline keeps running and
flood_risk simply stays unset until the data is present (cf. scotland_crime.py).
See PHASE4_PLAN.md for the data paths and the areal-overlay rationale.
"""
from __future__ import annotations

import logging

import geopandas as gpd
import pandas as pd

from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

WORKING_CRS = "EPSG:27700"   # metric — areas in m²

# Risk-band column candidates and the values we treat as "at risk". Sources name
# the band differently (EA `prob_4band`, SEPA `Likelihood`/`SUITABILITY`, …); we
# match case-insensitively and keep High+Medium. If no band column is found the
# layer is assumed to already be the at-risk extent.
_BAND_COL_CANDIDATES = ("prob_4band", "riskband", "risk_band", "band", "likelihood", "class")
_AT_RISK_VALUES = {"high", "medium", "med"}


def _at_risk_extent(flood: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Keep only High+Medium polygons if a recognised band column exists."""
    cols = {c.lower(): c for c in flood.columns}
    band = next((cols[c] for c in _BAND_COL_CANDIDATES if c in cols), None)
    if band is None:
        return flood
    keep = flood[band].astype(str).str.strip().str.lower().isin(_AT_RISK_VALUES)
    return flood[keep]


def flood_area_share(
    boundaries: gpd.GeoDataFrame, flood: gpd.GeoDataFrame
) -> pd.DataFrame:
    """Share of each area's land area intersecting the flood extent (0–1). Pure.

    Both inputs are reprojected to a metric CRS. Areas with no intersection get 0.
    """
    bnd = boundaries[["area_code", "geometry"]].to_crs(WORKING_CRS).copy()
    bnd["_area"] = bnd.geometry.area
    extent = _at_risk_extent(flood).to_crs(WORKING_CRS)

    inter = gpd.overlay(
        bnd[["area_code", "geometry"]], extent[["geometry"]], how="intersection"
    )
    inter["_ipart"] = inter.geometry.area
    flooded = inter.groupby("area_code")["_ipart"].sum()

    out = bnd[["area_code", "_area"]].copy()
    out["flood_risk"] = (
        out["area_code"].map(flooded).fillna(0.0) / out["_area"].where(out["_area"] > 0)
    ).clip(upper=1.0)
    return out[["area_code", "flood_risk"]]


def _load_nation_extents() -> gpd.GeoDataFrame | None:
    """Load pre-fetched flood-extent layers from data/raw/flood/<nation>/.

    Returns a single concatenated GeoDataFrame, or None if nothing is present.
    """
    base = raw("flood")
    layers = []
    for nation in ("england", "wales", "scotland"):
        ndir = base / nation
        if not ndir.exists():
            continue
        files = [p for p in ndir.iterdir()
                 if p.suffix.lower() in (".gpkg", ".shp", ".geojson", ".json", ".parquet")]
        for fp in files:
            try:
                gdf = (gpd.read_parquet(fp) if fp.suffix.lower() == ".parquet"
                       else gpd.read_file(fp))
                layers.append(gdf[["geometry"]] if "geometry" in gdf else gdf)
                log.info("Loaded flood extent %s (%d features)", fp.name, len(gdf))
            except Exception as exc:  # noqa: BLE001
                log.warning("Could not read flood layer %s: %s", fp, exc)
    if not layers:
        return None
    return gpd.GeoDataFrame(pd.concat(layers, ignore_index=True), crs=layers[0].crs)


def run() -> None:
    log.info("Ingesting flood-risk exposure (Phase 4)")
    extents = _load_nation_extents()
    if extents is None:
        log.warning(
            "No flood-extent files under %s/<nation>/ — flood_risk stays unset. "
            "Fetch EA RoFRS (England), NRW FRAW (Wales) and SEPA Flood Maps "
            "(Scotland) High+Medium extents and drop them there. See PHASE4_PLAN.md.",
            raw("flood"),
        )
        return

    boundaries = gpd.read_parquet(interim("area_boundaries.parquet"))
    out = flood_area_share(boundaries, extents)
    log.info(
        "Flood risk for %d areas | %.1f%% have any High/Medium flood area | "
        "share median=%.3f max=%.3f",
        len(out), (out["flood_risk"] > 0).mean() * 100,
        out["flood_risk"].median(), out["flood_risk"].max(),
    )
    write_parquet(out, interim("flood.parquet"))
    log.info("Wrote %s", interim("flood.parquet"))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
