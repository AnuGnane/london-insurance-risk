"""Bake static assets for the GitHub Pages (static) showcase build.

GitHub Pages can't run the FastAPI backend, so the frontend reads pre-baked static
files instead (see SHOWCASE_PLAN.md). This script produces:

  frontend/public/data/areas.geojson    — simplified choropleth (≈ 6–7 MB gzip; Pages
                                           serves it compressed)
  frontend/public/data/methodology.json — trimmed reports/calibration.json

The served GeoJSON is ~250 MB uncompressed, so we shrink hard. The geometry is
simplified with **mapshaper** (Visvalingam) rather than Shapely's `.simplify()`:
Shapely simplifies every polygon independently, so a border shared by two areas is
simplified twice and the two copies pull apart — leaving white slivers/gaps and
overlaps between neighbouring areas. mapshaper is *topology-aware*: it simplifies each
shared arc once, so neighbours keep identical edges (no slivers). `-clean` then removes
any residual overlap/gap and `precision` snaps coordinates so json writes short floats.

Pipeline: load boundaries + risk features → trim/coarsen props → reproject to WGS84 →
write a full-resolution intermediate GeoJSON → mapshaper (simplify + clean + precision)
→ read back → repair the handful of residual self-intersections with `make_valid`.

mapshaper is a dev dependency of the frontend (frontend/node_modules/.bin/mapshaper),
so `npm --prefix frontend install` must have run first.

Run: `make showcase-data` (after `make risk` + `make calibrate`).
"""
from __future__ import annotations

import json
import logging
import subprocess
import tempfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

from src.common.config import ROOT
from src.common.io import LSOA_RISK_PARQUET, interim, processed

log = logging.getLogger(__name__)

OUT_DIR = ROOT / "frontend" / "public" / "data"
MAPSHAPER = ROOT / "frontend" / "node_modules" / ".bin" / "mapshaper"
# mapshaper Visvalingam: percentage of *removable* vertices to KEEP. Higher = more
# detail + bigger file. 8% ≈ 6–7 MB gzip with clean, legible per-area boundaries.
SIMPLIFY_PCT = 8
COORD_PRECISION = 0.00001  # ~1 m; snaps output coords so json writes short floats

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


def build_fullres_gdf() -> gpd.GeoDataFrame:
    """Full-resolution, prop-trimmed choropleth in WGS84 (pre-simplification)."""
    boundaries = gpd.read_parquet(interim("area_boundaries.parquet"))
    features = pd.read_parquet(processed(LSOA_RISK_PARQUET))

    geo = boundaries[["area_code", "geometry"]].copy()
    gdf = gpd.GeoDataFrame(geo.merge(features, on="area_code", how="inner"),
                           geometry="geometry", crs=boundaries.crs)
    gdf = gdf.to_crs("EPSG:4326")
    cols = [c for c in _BASE_PROPS if c in gdf.columns] + _component_cols(gdf)
    return _round_props(gdf[cols + ["geometry"]])


def _simplify_with_mapshaper(src: Path, dst: Path) -> None:
    """Topology-aware simplify + clean via mapshaper. Shared arcs are simplified once,
    so neighbouring areas keep matching edges — no slivers (unlike per-geometry
    `.simplify()`). `keep-shapes` stops small areas collapsing; `-clean` removes any
    residual gap/overlap; `precision` snaps coords so json writes short floats."""
    if not MAPSHAPER.exists():
        raise FileNotFoundError(
            f"mapshaper not found at {MAPSHAPER}. Run `npm --prefix frontend install` "
            "(it is a frontend dev dependency)."
        )
    subprocess.run(
        [str(MAPSHAPER), str(src),
         "-simplify", "visvalingam", f"percentage={SIMPLIFY_PCT}%", "keep-shapes",
         "-clean",
         "-o", f"precision={COORD_PRECISION}", str(dst)],
        check=True,
    )


def build_geojson() -> gpd.GeoDataFrame:
    """Simplified, prop-trimmed choropleth in WGS84, with clean shared boundaries."""
    gdf = build_fullres_gdf()
    with tempfile.TemporaryDirectory() as td:
        full = Path(td) / "full.geojson"
        simp = Path(td) / "simp.geojson"
        gdf.to_file(full, driver="GeoJSON")
        _simplify_with_mapshaper(full, simp)
        out = gpd.read_file(simp)

    # mapshaper already snapped coords to COORD_PRECISION (5 dp), so json floats stay
    # short. It leaves a handful of self-intersecting rings, though; repair them in
    # place as the *last* step — make_valid reuses existing vertices, so it doesn't
    # move shared edges or reintroduce slivers. (Rounding *after* make_valid can
    # re-collapse the repaired vertices and re-break validity, dropping the area — so
    # don't.) Keep only polygonal parts in case make_valid yields a collection.
    bad = ~out.geometry.is_valid
    if bad.any():
        out.loc[bad, "geometry"] = out.loc[bad, "geometry"].apply(_repair_polygonal)
    return out[out.geometry.notna() & ~out.geometry.is_empty & out.geometry.is_valid]


def _repair_polygonal(geom: shapely.Geometry) -> shapely.Geometry | None:
    """make_valid a self-intersecting (Multi)Polygon, keeping only polygonal parts."""
    fixed = shapely.make_valid(geom)
    if fixed.geom_type in ("Polygon", "MultiPolygon"):
        return fixed
    parts = [p for p in shapely.get_parts(fixed)
             if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts) if parts else None


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
    if mb > 70:
        log.warning("areas.geojson is %.1f MB — consider a lower SIMPLIFY_PCT to keep "
                    "the repo lean.", mb)

    meth = OUT_DIR / "methodology.json"
    meth.write_text(json.dumps(build_methodology()), encoding="utf-8")
    log.info("Wrote %s", meth)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
