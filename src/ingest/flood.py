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

Verified endpoints (2026-07-15):
  - SEPA ArcGIS REST: map.sepa.org.uk (4 services, River/Coastal × High/Medium)
  - NRW WFS: datamap.gov.wales/geoserver/ows (FRAW rivers + sea layers)
  - England: interactive DSP download only (SFTP for large extracts)
"""
from __future__ import annotations

import logging
import shutil
import zipfile

import geopandas as gpd
import pandas as pd

from src.common.config import settings
from src.common.esri import fetch_arcgis_polygons
from src.common.http import get_json_with_retry, get_with_retry
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

WORKING_CRS = "EPSG:27700"   # metric — areas in m²

# Risk-band column candidates and the values we treat as "at risk". Sources name
# the band differently (EA `prob_4band`, SEPA `Likelihood`/`SUITABILITY`, NRW
# `risk`, …); we match case-insensitively and keep High+Medium. If no band column
# is found the layer is assumed to already be the at-risk extent.
_BAND_COL_CANDIDATES = (
    "prob_4band", "riskband", "risk_band", "band",
    "likelihood", "class", "risk",
)
_AT_RISK_VALUES = {"high", "medium", "med"}

NATIONS = ("england", "wales", "scotland")

# ---------------------------------------------------------------------------
# SEPA Scotland fetcher (ArcGIS REST, 4 pre-split services)
# ---------------------------------------------------------------------------

# SEPA publishes current flood maps as separate services per source × likelihood
# (already High/Medium-split → no band column to filter). OGL v3.0.
SEPA_SERVICES = (
    "River_Flooding_High_Likelihood",
    "River_Flooding_Medium_Likelihood",
    "Coastal_Flooding_High_Likelihood",
    "Coastal_Flooding_Medium_Likelihood",
)
_SEPA_REST_DEFAULT = "https://map.sepa.org.uk/server/rest/services/Open"


def _sepa_query_url(rest_base: str, service: str, layer_id: int) -> str:
    return f"{rest_base}/{service}/FeatureServer/{layer_id}/query"


def fetch_scotland() -> None:
    """Fetch/cache SEPA High+Medium river & coastal extents as GeoParquet.

    Grain in: national flood-extent polygons (EPSG:27700 requested via outSR).
    Out     : data/raw/flood/scotland/sepa_<service>.parquet (geometry only).
    Layer id is discovered per service (they differ, e.g. River Medium = 1).
    """
    rest = settings["sources"].get("flood_scotland_sepa_rest", _SEPA_REST_DEFAULT)
    dest_dir = raw("flood") / "scotland"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for svc in SEPA_SERVICES:
        dest = dest_dir / f"sepa_{svc.lower()}.parquet"
        if dest.exists():
            log.info("SEPA %s already cached (%s)", svc, dest.name)
            continue
        meta = get_json_with_retry(f"{rest}/{svc}/FeatureServer", {"f": "json"})
        layer_id = int(meta["layers"][0]["id"])
        log.info("Fetching SEPA %s (layer %d)…", svc, layer_id)
        gdf = fetch_arcgis_polygons(_sepa_query_url(rest, svc, layer_id))
        if gdf.empty:
            raise RuntimeError(f"SEPA {svc} returned no features — endpoint moved?")
        gdf.to_parquet(dest)
        log.info("Cached %d SEPA polygons -> %s", len(gdf), dest.name)

# ---------------------------------------------------------------------------
# NRW Wales fetcher (WFS paged GeoJSON)
# ---------------------------------------------------------------------------

# NRW Flood Risk Assessment Wales (FRAW, replaced RoFRS in Wales). Rivers + sea
# layers, High/Medium/Low band attribute; High+Medium filtered at load. OGL.
NRW_LAYERS = (
    "inspire-nrw:NRW_FLOOD_RISK_FROM_RIVERS",
    "inspire-nrw:NRW_FLOOD_RISK_FROM_SEA",
)
_NRW_OWS_DEFAULT = "https://datamap.gov.wales/geoserver/ows"
_WFS_PAGE = 5000


def _wfs_page_params(type_name: str, *, start: int, count: int) -> dict:
    return {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": type_name, "srsName": "EPSG:27700",
        "outputFormat": "application/json", "count": count, "startIndex": start,
    }


def fetch_wales() -> None:
    """Fetch/cache NRW FRAW rivers+sea extents (WFS paged GeoJSON) as GeoParquet.

    Grain in: national flood-extent polygons (EPSG:27700 via srsName).
    Out     : data/raw/flood/wales/nrw_<layer>.parquet (geometry + band column,
              so _at_risk_extent can keep High+Medium at load time).
    """
    ows = settings["sources"].get("flood_wales_nrw_ows", _NRW_OWS_DEFAULT)
    dest_dir = raw("flood") / "wales"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for layer in NRW_LAYERS:
        dest = dest_dir / f"nrw_{layer.split(':')[1].lower()}.parquet"
        if dest.exists():
            log.info("NRW %s already cached (%s)", layer, dest.name)
            continue
        log.info("Fetching NRW %s…", layer)
        feats, start = [], 0
        while True:
            data = get_with_retry(
                ows, _wfs_page_params(layer, start=start, count=_WFS_PAGE),
                timeout=600,
            ).json()
            batch = data.get("features", [])
            feats.extend(batch)
            if len(batch) < _WFS_PAGE:
                break
            start += _WFS_PAGE
        if not feats:
            raise RuntimeError(f"NRW {layer} returned no features — layer renamed?")
        gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:27700")
        cols = {c.lower() for c in gdf.columns}
        if not cols & set(_BAND_COL_CANDIDATES):
            raise RuntimeError(
                f"NRW {layer}: no recognised band column in {sorted(gdf.columns)} "
                "— Low-risk polygons would pass through unfiltered. Add the "
                "attribute name to _BAND_COL_CANDIDATES."
            )
        gdf.to_parquet(dest)
        log.info("Cached %d NRW features -> %s", len(gdf), dest.name)

# ---------------------------------------------------------------------------
# EA England fetcher (local GDB files from Defra SFTP download)
# ---------------------------------------------------------------------------

# Data structure: data/raw/flood/england/RoFRS_<grid>_v*.zip
# Each zip contains a .gdb with layer RoFRS_4band (Risk_band column).
# Risk_band values: High, Medium, Low, Very low. CRS: EPSG:27700.
_ENGLAND_GDB_LAYER = "RoFRS_4band"
_ENGLAND_COMBINED_CACHE = "england_rofrs_combined.parquet"


def fetch_england() -> None:
    """Process locally-downloaded Defra RoFRS GDB tiles into a single GeoParquet.

    The raw data is 83 zipped Esri File Geodatabases from the Defra SFTP,
    tiled by OS National Grid squares. Each GDB contains the layer
    ``RoFRS_4band`` with columns ``Risk_band`` (High/Medium/Low/Very low)
    and geometry (MultiPolygon, EPSG:27700).

    Grain in: flood-extent polygons per ~50km grid tile.
    Out     : data/raw/flood/england/england_rofrs_combined.parquet
              (geometry + Risk_band, so _at_risk_extent filters at load time).
    Source  : EA Risk of Flooding from Rivers and Sea (NaFRA2), OGL v3.0.
    """
    eng_dir = raw("flood") / "england"
    combined_path = eng_dir / _ENGLAND_COMBINED_CACHE

    if combined_path.exists():
        log.info("England flood data already combined (%s)", combined_path.name)
        return

    zips = sorted(eng_dir.glob("RoFRS_*_v*.zip"))
    if not zips:
        log.info("No England RoFRS zips found in %s — skipping", eng_dir)
        return

    log.info("Processing %d England RoFRS GDB tiles…", len(zips))
    parts: list[gpd.GeoDataFrame] = []
    for i, zp in enumerate(zips):
        try:
            with zipfile.ZipFile(zp) as zf:
                # Find the .gdb directory inside the zip.
                gdb_dirs = {n.split("/")[0] for n in zf.namelist()
                            if n.endswith(".gdb/")}
                if not gdb_dirs:
                    # Some zips have the gdb one level deeper.
                    gdb_dirs = {"/".join(n.split("/")[:2]) for n in zf.namelist()
                                if ".gdb/" in n}
                if not gdb_dirs:
                    log.warning("No .gdb found in %s — skipping", zp.name)
                    continue

                # Extract the zip to a temp directory (pyogrio needs filesystem access).
                extract_dir = eng_dir / f"_tmp_{zp.stem}"
                zf.extractall(extract_dir)

            gdb_name = sorted(gdb_dirs)[0]
            gdb_path = extract_dir / gdb_name

            gdf = gpd.read_file(gdb_path, layer=_ENGLAND_GDB_LAYER)
            # Keep only Risk_band + geometry for the combined output.
            if "Risk_band" in gdf.columns:
                gdf = gdf[["Risk_band", "geometry"]]
            else:
                # Fallback: look for any band-like column.
                for col in gdf.columns:
                    if col.lower() in {"risk_band", "prob_4band", "riskband"}:
                        gdf = gdf.rename(columns={col: "Risk_band"})
                        gdf = gdf[["Risk_band", "geometry"]]
                        break

            parts.append(gdf)
            if (i + 1) % 10 == 0:
                log.info("  … processed %d/%d tiles (%d features so far)",
                         i + 1, len(zips), sum(len(p) for p in parts))

            # Clean up extracted GDB.
            shutil.rmtree(extract_dir, ignore_errors=True)

        except Exception as exc:  # noqa: BLE001
            log.warning("Error processing %s: %s — skipping", zp.name, exc)
            continue

    if not parts:
        log.warning("No England flood features extracted from %d zips", len(zips))
        return

    combined = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True),
                                crs="EPSG:27700")
    combined.to_parquet(combined_path)
    log.info("Combined %d England flood features from %d tiles → %s",
             len(combined), len(parts), combined_path.name)


# ---------------------------------------------------------------------------
# Shared transforms (pure)
# ---------------------------------------------------------------------------


def _at_risk_extent(flood: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Keep only High+Medium polygons if a recognised band column exists."""
    cols = {c.lower(): c for c in flood.columns}
    band = next((cols[c] for c in _BAND_COL_CANDIDATES if c in cols), None)
    if band is None:
        return flood
    vals = flood[band].astype(str).str.strip().str.lower()
    keep = vals.isin(_AT_RISK_VALUES)
    log.info("Band column %r: keeping %d/%d features (dropping values: %s)",
             band, int(keep.sum()), len(flood),
             sorted(vals[~keep].unique()) or "none")
    return flood[keep]


def flood_area_share(
    boundaries: gpd.GeoDataFrame, flood: gpd.GeoDataFrame
) -> pd.DataFrame:
    """Share of each area's land area intersecting the flood extent (0–1). Pure.

    Both inputs are reprojected to a metric CRS. Overlapping intersection pieces
    are dissolved per area (unioned) before measuring, so overlapping extent
    layers (e.g. SEPA High ⊂ Medium, river/coastal overlap in estuaries) do not
    double-count. Areas with no intersection get 0.
    """
    bnd = boundaries[["area_code", "geometry"]].to_crs(WORKING_CRS).copy()
    bnd["_area"] = bnd.geometry.area
    extent = flood[["geometry"]].to_crs(WORKING_CRS)

    inter = gpd.overlay(
        bnd[["area_code", "geometry"]], extent[["geometry"]], how="intersection"
    )
    # Dissolve per area so overlapping pieces union instead of summing.
    flooded = inter.dissolve(by="area_code").geometry.area

    out = bnd[["area_code", "_area"]].copy()
    out["flood_risk"] = (
        out["area_code"].map(flooded).fillna(0.0) / out["_area"].where(out["_area"] > 0)
    ).clip(upper=1.0)
    return out[["area_code", "flood_risk"]]


def _load_nation_extents() -> dict[str, gpd.GeoDataFrame]:
    """Load pre-fetched flood-extent layers per nation from data/raw/flood/<nation>/.

    High+Medium filtering happens here, per source file, while the band column
    is still present; only the at-risk geometry is kept.
    """
    base = raw("flood")
    out: dict[str, gpd.GeoDataFrame] = {}
    for nation in NATIONS:
        ndir = base / nation
        if not ndir.exists():
            continue
        layers = []
        for fp in sorted(ndir.iterdir()):
            if fp.suffix.lower() not in (".gpkg", ".shp", ".geojson", ".json", ".parquet"):
                continue
            try:
                gdf = (gpd.read_parquet(fp) if fp.suffix.lower() == ".parquet"
                       else gpd.read_file(fp))
            except Exception as exc:  # noqa: BLE001
                log.warning("Could not read flood layer %s: %s", fp, exc)
                continue
            kept = _at_risk_extent(gdf)
            log.info("Loaded flood extent %s (%d features, %d at-risk)",
                     fp.name, len(gdf), len(kept))
            if len(kept):
                layers.append(kept[["geometry"]])
        if layers:
            out[nation] = gpd.GeoDataFrame(
                pd.concat(layers, ignore_index=True), crs=layers[0].crs)
    return out


def flood_shares_by_nation(
    boundaries: gpd.GeoDataFrame,
    extents: dict[str, gpd.GeoDataFrame],
    chunk: int = 5000,
) -> pd.DataFrame:
    """flood_risk per area, only for nations with extent data. Pure.

    Nations absent from ``extents`` contribute NO rows — the aggregate merge
    then leaves them NaN (missing stays visibly missing, never a silent 0).
    Boundaries are processed in chunks to bound the overlay's memory use on the
    national extent layers.
    """
    parts = []
    for nation, ext in extents.items():
        bnd = boundaries[boundaries["nation"] == nation]
        for i in range(0, len(bnd), chunk):
            parts.append(flood_area_share(bnd.iloc[i:i + chunk], ext))
    if not parts:
        return pd.DataFrame({"area_code": pd.Series(dtype=str),
                             "flood_risk": pd.Series(dtype=float)})
    return pd.concat(parts, ignore_index=True)


def run() -> None:
    log.info("Ingesting flood-risk exposure (Phase 4)")
    fetch_england()
    fetch_scotland()
    fetch_wales()
    extents = _load_nation_extents()
    missing = [n for n in NATIONS if n not in extents]
    if missing:
        log.warning(
            "No flood extents for %s under %s/<nation>/ — those nations stay "
            "unset (NaN). England is a manual download; see PHASE4_PLAN.md.",
            missing, raw("flood"),
        )
    if not extents:
        return

    boundaries = gpd.read_parquet(interim("area_boundaries.parquet"))
    out = flood_shares_by_nation(boundaries, extents)
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
