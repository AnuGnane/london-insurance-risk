"""Ingest small-area boundary polygons for the configured footprint.

Sources:
  E+W LSOAs   : ONS Open Geography Portal — LSOA (2011) Boundaries (BGC, Clipped)
                ArcGIS REST FeatureServer (England + Wales, 34,753 areas)
  Scotland DZ : Scottish Government maps.gov.scot — Data Zone Boundaries 2011
                (6,976 areas). NRS/ScotGov authoritative service.
Grain  : one polygon per small area (LSOA in E+W, Data Zone in Scotland)
Out    : data/interim/area_boundaries.parquet  (geometry in EPSG:27700)
         data/interim/lsoa_boundaries.parquet  (transitional alias — same content)
         data/interim/london_lsoa_list.csv     (only when footprint=london)
Vintage: 2011 throughout (matches IMD 2019; Scotland DZ is also 2011).

Unified schema (area_boundaries.parquet):
  area_code   small-area code (LSOA11CD in E+W, DataZone 'S01...' in Scotland)
  area_name   human-readable name
  nation      england | wales | scotland
  area_type   LSOA | DataZone
  area_km2    polygon area in km² (computed in EPSG:27700)
  lsoa11cd    alias of area_code for E+W (NaN for Scotland) — backward compat
  geometry    polygon in EPSG:27700 (British National Grid)

NI deferred (see config.yaml / implementation_plan.md): no SOA fetch yet.
"""
from __future__ import annotations

import logging
import time

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import MultiPolygon, Polygon

from src.common.config import active_nations, is_london_footprint
from src.common.geo import WORKING_CRS
from src.common.io import interim

log = logging.getLogger(__name__)

# ONS ArcGIS FeatureServer for LSOA 2011 boundaries (BGC — clipped), England+Wales.
EW_LSOA_URL = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"
    "/LSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3"
    "/FeatureServer/0/query"
)
EW_PAGE_SIZE = 2000  # = the endpoint's maxRecordCount

# Scottish Government statistical units — Data Zone Boundaries 2011 (MapServer).
SCOTLAND_DZ_URL = (
    "https://maps.gov.scot/server/rest/services"
    "/ScotGov/StatisticalUnits/MapServer/2/query"
)
# Well below the endpoint's maxRecordCount (1000): the island-heavy zones around
# the Highlands/Western Isles make a 1000- (even 500-) row geometry page time out
# server-side with a 500. 200 fetches those pages reliably.
SCOTLAND_PAGE_SIZE = 200

# All 33 London boroughs (32 boroughs + City of London). Name prefixes used in
# LSOA names (e.g. "Hackney 001A"). Only used for the legacy footprint=london path.
LONDON_BOROUGHS = {
    "Barking and Dagenham",
    "Barnet",
    "Bexley",
    "Brent",
    "Bromley",
    "Camden",
    "City of London",
    "Croydon",
    "Ealing",
    "Enfield",
    "Greenwich",
    "Hackney",
    "Hammersmith and Fulham",
    "Haringey",
    "Harrow",
    "Havering",
    "Hillingdon",
    "Hounslow",
    "Islington",
    "Kensington and Chelsea",
    "Kingston upon Thames",
    "Lambeth",
    "Lewisham",
    "Merton",
    "Newham",
    "Redbridge",
    "Richmond upon Thames",
    "Southwark",
    "Sutton",
    "Tower Hamlets",
    "Waltham Forest",
    "Wandsworth",
    "Westminster",
}


def _get_json_with_retry(
    url: str, params: dict, *, retries: int = 5, backoff: float = 2.0
) -> dict:
    """GET + parse JSON with exponential backoff on transient failures.

    ArcGIS and police.uk both throw intermittent 503/429s under load, and these
    services occasionally return a 200 with a truncated/HTML body mid-pagination.
    Both cases are retried; without this a single blip aborts the national fetch.
    """
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=120)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise requests.exceptions.HTTPError(f"{resp.status_code}", response=resp)
            resp.raise_for_status()
            data = resp.json()  # may raise JSONDecodeError on a malformed body
            # ArcGIS returns errors as HTTP 200 with an {"error": {...}} body;
            # treat that as transient so we retry instead of silently truncating.
            if isinstance(data, dict) and "error" in data:
                raise requests.exceptions.HTTPError(f"ArcGIS error: {data['error']}")
            return data
        except (requests.exceptions.RequestException, ValueError) as exc:
            if attempt == retries - 1:
                raise
            wait = backoff * (2 ** attempt)
            log.warning("Request failed (%s); retry %d/%d in %.0fs",
                        exc, attempt + 1, retries - 1, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _fetch_features_paginated(
    url: str,
    where: str = "1=1",
    out_fields: str = "*",
    page_size: int = 2000,
) -> gpd.GeoDataFrame:
    """Page through an ArcGIS REST FeatureServer/MapServer and return a GeoDataFrame.

    The API caps results per request; we paginate using resultOffset. ``page_size``
    must be <= the endpoint's maxRecordCount, otherwise a capped first page looks
    like the final page and we'd silently truncate.
    """
    all_features: list[dict] = []
    offset = 0

    while True:
        params = {
            "where": where,
            "outFields": out_fields,
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "returnGeometry": "true",
        }
        log.info("Fetching %s offset=%d (have %d so far)", url, offset, len(all_features))
        data = _get_json_with_retry(url, params)

        features = data.get("features", [])
        if not features:
            break

        all_features.extend(features)
        offset += len(features)

        # ArcGIS signals "no more pages" by returning fewer than page_size
        if len(features) < page_size:
            break

        time.sleep(0.5)  # be polite to the service

    log.info("Fetched %d total features", len(all_features))
    geojson_collection = {"type": "FeatureCollection", "features": all_features}
    return gpd.GeoDataFrame.from_features(geojson_collection, crs="EPSG:4326")


def _is_london_lsoa(lsoa_name: str) -> bool:
    """Check if an LSOA name belongs to a London borough ('Borough Name 001A')."""
    if not isinstance(lsoa_name, str):
        return False
    return any(lsoa_name.startswith(b) for b in LONDON_BOROUGHS)


def _extract_borough(lsoa_name: str) -> str | None:
    """Extract the borough name from an LSOA name."""
    if not isinstance(lsoa_name, str):
        return None
    for borough in LONDON_BOROUGHS:
        if lsoa_name.startswith(borough):
            return borough
    return None


def _fetch_ew_lsoas(nations: list[str]) -> gpd.GeoDataFrame:
    """Fetch England and/or Wales LSOAs into the unified schema (EPSG:4326)."""
    clauses = []
    if "england" in nations:
        clauses.append("LSOA11CD LIKE 'E01%'")
    if "wales" in nations:
        clauses.append("LSOA11CD LIKE 'W01%'")
    where = " OR ".join(clauses) if clauses else "1=2"

    gdf = _fetch_features_paginated(
        EW_LSOA_URL,
        where=where,
        out_fields="LSOA11CD,LSOA11NM",
        page_size=EW_PAGE_SIZE,
    )
    gdf.columns = [c.lower() for c in gdf.columns]
    gdf = gdf.rename(columns={"lsoa11cd": "area_code", "lsoa11nm": "area_name"})
    # Nation from the GSS prefix (E01 = England, W01 = Wales)
    gdf["nation"] = gdf["area_code"].str[0].map({"E": "england", "W": "wales"})
    gdf["area_type"] = "LSOA"
    log.info("Fetched %d E+W LSOAs", len(gdf))
    return gdf


def _ring_is_clockwise(ring: list[list[float]]) -> bool:
    """Esri convention: clockwise rings are exteriors, counter-clockwise are holes."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += (x2 - x1) * (y2 + y1)
    return s > 0


def _esri_rings_to_geom(rings: list[list[list[float]]]):
    """Convert an Esri polygon ``rings`` array to a shapely (Multi)Polygon.

    Esri packs all exterior rings and holes into one flat list; we split by
    winding order and assign each hole to the exterior that contains it. This is
    what arcgis2geojson does — vendored here to avoid an extra dependency and
    because the gov.scot geojson endpoint mis-serialises multi-island zones.
    """
    exteriors = [r for r in rings if len(r) >= 4 and _ring_is_clockwise(r)]
    holes = [r for r in rings if len(r) >= 4 and not _ring_is_clockwise(r)]
    if not exteriors:  # all CCW — treat each as its own polygon
        exteriors, holes = rings, []

    ext_polys = [Polygon(r) for r in exteriors]
    hole_assignment: list[list] = [[] for _ in ext_polys]
    for h in holes:
        rep = Polygon(h).representative_point()
        for i, ext in enumerate(ext_polys):
            if ext.contains(rep):
                hole_assignment[i].append(h)
                break

    polys = [Polygon(ext, hl) for ext, hl in zip(exteriors, hole_assignment)]
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def _fetch_scotland_dz() -> gpd.GeoDataFrame:
    """Fetch Scotland Data Zones into the unified schema (EPSG:4326).

    Uses Esri JSON (``f=json``) rather than geojson: the gov.scot geojson endpoint
    returns an HTML error for the page containing multi-island zones (e.g.
    'Lochaber West - 03', 82 rings), whereas Esri JSON serialises them correctly.
    """
    rows: list[dict] = []
    geoms: list = []
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "outFields": "datazone,name",
            "f": "json",
            "outSR": 4326,
            "resultOffset": offset,
            "resultRecordCount": SCOTLAND_PAGE_SIZE,
            "returnGeometry": "true",
        }
        log.info("Fetching Scotland DZ offset=%d (have %d so far)", offset, len(rows))
        data = _get_json_with_retry(SCOTLAND_DZ_URL, params)
        features = data.get("features", [])
        if not features:
            break
        for feat in features:
            attrs = feat["attributes"]
            rows.append({"area_code": attrs["datazone"], "area_name": attrs["name"]})
            geoms.append(_esri_rings_to_geom(feat["geometry"]["rings"]))
        offset += len(features)
        if len(features) < SCOTLAND_PAGE_SIZE:
            break
        time.sleep(0.5)

    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:4326")
    gdf["nation"] = "scotland"
    gdf["area_type"] = "DataZone"
    log.info("Fetched %d Scotland Data Zones", len(gdf))
    return gdf


def run() -> None:
    """Download small-area boundaries for the configured footprint and persist."""
    nations = active_nations()
    london = is_london_footprint()
    log.info("Boundaries ingest: nations=%s london=%s", nations, london)

    parts: list[gpd.GeoDataFrame] = []
    if {"england", "wales"} & set(nations):
        parts.append(_fetch_ew_lsoas(nations))
    if "scotland" in nations:
        parts.append(_fetch_scotland_dz())
    if not parts:
        raise RuntimeError(f"No supported nations to fetch from {nations}")

    cols = ["area_code", "area_name", "nation", "area_type", "geometry"]
    gdf = gpd.GeoDataFrame(
        pd.concat([p[cols] for p in parts], ignore_index=True),
        crs="EPSG:4326",
    )

    if london:
        # Legacy path: keep only London-borough LSOAs by name prefix.
        gdf = gdf[gdf["area_name"].apply(_is_london_lsoa)].copy()
        gdf["borough"] = gdf["area_name"].apply(_extract_borough)
        log.info("Filtered to %d London LSOAs", len(gdf))

    # Reproject to British National Grid for area maths.
    gdf = gdf.to_crs(WORKING_CRS)

    # Repair self-intersections etc. in the source polygons — at GB scale a
    # handful are invalid, which would break downstream point-in-polygon joins.
    invalid = ~gdf.geometry.is_valid
    if invalid.any():
        log.warning("Repairing %d invalid geometries", int(invalid.sum()))
        gdf.loc[invalid, "geometry"] = gdf.loc[invalid, "geometry"].make_valid()

    gdf["area_km2"] = gdf.geometry.area / 1e6

    # Backward-compat alias: lsoa11cd == area_code for E+W, NaN for Scotland DZs.
    gdf["lsoa11cd"] = gdf["area_code"].where(gdf["nation"].isin(["england", "wales"]))

    dest = interim("area_boundaries.parquet")
    dest.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(dest)
    log.info("Wrote %d area boundaries to %s", len(gdf), dest)

    # Transitional alias so Phase-C transforms still find lsoa_boundaries.parquet
    # until they are migrated to area_boundaries.parquet.
    alias = interim("lsoa_boundaries.parquet")
    gdf.to_parquet(alias)
    log.info("Wrote transitional alias %s", alias)

    if london:
        lsoa_list = gdf[["lsoa11cd"]].dropna().drop_duplicates()
        list_dest = interim("london_lsoa_list.csv")
        lsoa_list.to_csv(list_dest, index=False)
        log.info("Wrote London LSOA list (%d rows) to %s", len(lsoa_list), list_dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
