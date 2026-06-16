"""Ingest DfT STATS19 road collision data for Great Britain.

Source : DfT Road Safety Data (data.gov.uk)
         https://data.dft.gov.uk/road-accidents-safety-data/
Grain  : collision points. The collision table's `lsoa_of_accident_location` is
         populated for England & Wales only; Scotland rows carry '-1'. We assign
         those (and any other unassigned rows) an area_code via a point-in-polygon
         spatial join to area_boundaries, so Scotland Data Zones get casualties.
         (STATS19 excludes Northern Ireland — deferred.)
Out    : data/interim/collisions.parquet
         columns: accident_index, area_code, lsoa11cd, severity_label,
                  severity_weight, year, latitude, longitude
Vintage: Years per config.data_years.stats19_years.

Notes:
  - DfT severity codes: 1 = fatal, 2 = serious, 3 = slight.
  - Severity weights from config: slight=1, serious=3, fatal=8.
"""
from __future__ import annotations

import io
import logging

import geopandas as gpd
import pandas as pd
import requests

from src.common.config import settings
from src.common.geo import WORKING_CRS
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

# Plausible GB lat/long bounds — used to drop protected/placeholder coordinates
# (DfT uses -1 for missing) before the spatial join.
GB_BOUNDS = {"lat": (49.0, 61.5), "long": (-9.0, 2.5)}

# DfT publishes collision CSVs at predictable URLs per year.
# The URL pattern changed over the years; these are the current ones.
STATS19_BASE = "https://data.dft.gov.uk/road-accidents-safety-data"

# DfT severity code → label
SEVERITY_LABELS = {1: "fatal", 2: "serious", 3: "slight"}


def _collision_url(year: int) -> str:
    """Construct the download URL for a STATS19 collision CSV.

    DfT uses varying URL patterns depending on the year. We try the most
    common patterns.
    """
    # Post-2016 pattern
    return f"{STATS19_BASE}/dft-road-casualty-statistics-collision-{year}.csv"


def _download_year(year: int) -> pd.DataFrame | None:
    """Download collision CSV for a single year, with caching."""
    cache_dir = raw("stats19")
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"collisions_{year}.csv"

    if cache_file.exists():
        log.info("Using cached STATS19 %d from %s", year, cache_file)
        return pd.read_csv(cache_file, low_memory=False)

    url = _collision_url(year)
    log.info("Downloading STATS19 %d from %s", year, url)

    try:
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
    except requests.RequestException:
        # Try alternate URL patterns
        alt_urls = [
            f"{STATS19_BASE}/dft-road-casualty-statistics-collisions-{year}.csv",
            f"{STATS19_BASE}/dft-road-casualty-statistics-accident-{year}.csv",
        ]
        for alt in alt_urls:
            try:
                log.info("Trying alternate URL: %s", alt)
                resp = requests.get(alt, timeout=120)
                resp.raise_for_status()
                break
            except requests.RequestException:
                continue
        else:
            log.error("Failed to download STATS19 for %d", year)
            return None

    cache_file.write_bytes(resp.content)
    log.info("Cached STATS19 %d to %s", year, cache_file)

    return pd.read_csv(io.BytesIO(resp.content), low_memory=False)


def _find_column(df: pd.DataFrame, patterns: list[str]) -> str | None:
    """Find a column matching one of the patterns (case-insensitive)."""
    for col in df.columns:
        lower = col.lower().replace(" ", "_").replace("-", "_")
        for pat in patterns:
            if pat in lower:
                return col
    return None


def parse_collisions(df: pd.DataFrame, year: int) -> pd.DataFrame:
    """Select and standardise columns from raw STATS19 collision DataFrame.

    Pure function for testability.
    """
    severity_weights = settings["risk_index"]["severity_weights"]

    # Find the key columns — DfT naming varies across years
    lsoa_col = _find_column(df, ["lsoa_of_accident", "lsoa_of_collision"])
    severity_col = _find_column(df, ["accident_severity", "collision_severity"])
    ref_col = _find_column(df, ["accident_index", "collision_index", "accident_reference"])
    lat_col = _find_column(df, ["latitude"])
    lng_col = _find_column(df, ["longitude"])

    if severity_col is None:
        log.error("Cannot find severity column in %d data", year)
        return pd.DataFrame()

    result = pd.DataFrame()

    if ref_col:
        result["accident_index"] = df[ref_col].astype(str)
    else:
        result["accident_index"] = range(len(df))

    if lsoa_col:
        result["lsoa11cd"] = df[lsoa_col].astype(str)
    else:
        result["lsoa11cd"] = None

    # Map severity
    result["severity_code"] = pd.to_numeric(df[severity_col], errors="coerce")
    result["severity_label"] = result["severity_code"].map(SEVERITY_LABELS)
    result["severity_weight"] = result["severity_label"].map(severity_weights)

    result["year"] = year

    if lat_col:
        result["latitude"] = pd.to_numeric(df[lat_col], errors="coerce")
    if lng_col:
        result["longitude"] = pd.to_numeric(df[lng_col], errors="coerce")

    return result


def _assign_area_codes(df: pd.DataFrame) -> pd.DataFrame:
    """Resolve each collision to an area_code in the configured footprint.

    E+W rows use the DfT LSOA directly; rows without a valid E/W LSOA (Scotland,
    or E+W with a missing code) are matched by point-in-polygon to area_boundaries.
    """
    boundaries = gpd.read_parquet(interim("area_boundaries.parquet"))[
        ["area_code", "geometry"]
    ]
    valid_areas = set(boundaries["area_code"])

    has_lsoa = df["lsoa11cd"].str.startswith(("E", "W"), na=False)
    ew = df[has_lsoa].copy()
    ew["area_code"] = ew["lsoa11cd"]
    ew = ew[ew["area_code"].isin(valid_areas)]  # restrict E+W to footprint

    rest = df[~has_lsoa].copy()
    rest = rest[
        rest["latitude"].between(*GB_BOUNDS["lat"])
        & rest["longitude"].between(*GB_BOUNDS["long"])
    ]
    joined = pd.DataFrame()
    if not rest.empty:
        pts = gpd.GeoDataFrame(
            rest,
            geometry=gpd.points_from_xy(rest["longitude"], rest["latitude"]),
            crs="EPSG:4326",
        ).to_crs(WORKING_CRS)
        joined = gpd.sjoin(pts, boundaries, how="inner", predicate="within")
        joined = pd.DataFrame(joined.drop(columns=["geometry", "index_right"]))
        log.info("Spatial-joined %d unassigned collisions to areas", len(joined))

    out = pd.concat([ew, joined], ignore_index=True)
    out["lsoa11cd"] = out["area_code"]  # unified alias (Scotland gets its DZ code)
    return out


def run() -> None:
    years = settings["data_years"]["stats19_years"]
    log.info("Fetching STATS19 collisions for %s", years)

    frames = []
    for year in years:
        df_raw = _download_year(year)
        if df_raw is None:
            continue
        df = parse_collisions(df_raw, year)
        if not df.empty:
            frames.append(df)

    if not frames:
        log.error("No STATS19 data fetched — aborting")
        return

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.dropna(subset=["severity_weight"])
    combined = _assign_area_codes(combined)

    dest = interim("collisions.parquet")
    write_parquet(combined, dest)
    log.info("Wrote %d collision rows to %s", len(combined), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
