"""Ingest LSOA boundary polygons for the London region.

Source : ONS Open Geography Portal — LSOA (2011) Boundaries (BGC, Clipped)
         ArcGIS REST FeatureServer
Grain  : LSOA polygon (filtered to region E12000007 — London)
Out    : data/interim/lsoa_boundaries.parquet  (geometry in EPSG:27700)
         data/interim/london_lsoa_list.csv      (lsoa11cd only — for filtering)
Vintage: 2011 (matches IMD 2019)

Strategy:
  We fetch LSOA boundaries from the ONS ArcGIS service, then identify London
  LSOAs by matching the LSOA name prefix to known London borough names.
  This avoids needing a separate LSOA→LAD lookup service (which has unreliable
  endpoint URLs on the ONS portal).
"""
from __future__ import annotations

import logging
import time

import geopandas as gpd
import pandas as pd
import requests

from src.common.config import settings
from src.common.geo import WORKING_CRS
from src.common.io import interim, write_parquet

log = logging.getLogger(__name__)

# ONS ArcGIS FeatureServer for LSOA 2011 boundaries (BGC — clipped)
LSOA_BOUNDARY_URL = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"
    "/LSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3"
    "/FeatureServer/0/query"
)

# All 33 London boroughs (32 boroughs + City of London)
# These are the name prefixes used in LSOA names (e.g. "Hackney 001A")
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


def _fetch_features_paginated(
    url: str,
    where: str = "1=1",
    out_fields: str = "*",
    page_size: int = 2000,
) -> gpd.GeoDataFrame:
    """Page through an ArcGIS REST FeatureServer and return a GeoDataFrame.

    The API limits results per request; we paginate using resultOffset.
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
        log.info(
            "Fetching LSOA boundaries offset=%d (have %d so far)",
            offset, len(all_features),
        )
        resp = requests.get(url, params=params, timeout=120)
        resp.raise_for_status()
        data = resp.json()

        features = data.get("features", [])
        if not features:
            break

        all_features.extend(features)
        offset += len(features)

        # ArcGIS signals "no more pages" by returning fewer than page_size
        if len(features) < page_size:
            break

        # Be polite to the ONS service
        time.sleep(0.5)

    log.info("Fetched %d total features", len(all_features))
    geojson_collection = {"type": "FeatureCollection", "features": all_features}
    return gpd.GeoDataFrame.from_features(geojson_collection, crs="EPSG:4326")


def _is_london_lsoa(lsoa_name: str) -> bool:
    """Check if an LSOA name belongs to a London borough.

    LSOA names follow the pattern 'Borough Name 001A'.
    """
    if not isinstance(lsoa_name, str):
        return False
    for borough in LONDON_BOROUGHS:
        if lsoa_name.startswith(borough):
            return True
    return False


def _extract_borough(lsoa_name: str) -> str | None:
    """Extract the borough name from an LSOA name."""
    if not isinstance(lsoa_name, str):
        return None
    for borough in LONDON_BOROUGHS:
        if lsoa_name.startswith(borough):
            return borough
    return None


def run() -> None:
    """Download LSOA boundaries, filter to London, persist."""
    region = settings["geography"]["region_code"]
    log.info("Fetching LSOA boundaries for region %s (London)", region)

    # Fetch all England LSOAs starting with E01
    gdf = _fetch_features_paginated(
        LSOA_BOUNDARY_URL,
        where="LSOA11CD LIKE 'E01%'",
        out_fields="LSOA11CD,LSOA11NM",
    )

    # Normalise column names
    gdf.columns = [c.lower() for c in gdf.columns]
    log.info("Fetched %d England LSOAs", len(gdf))

    # Filter to London by matching LSOA name to borough names
    gdf["is_london"] = gdf["lsoa11nm"].apply(_is_london_lsoa)
    gdf = gdf[gdf["is_london"]].drop(columns=["is_london"]).copy()
    log.info("Filtered to %d London LSOAs", len(gdf))

    # Add borough column
    gdf["borough"] = gdf["lsoa11nm"].apply(_extract_borough)

    # Reproject to British National Grid for area calculations
    gdf = gdf.to_crs(WORKING_CRS)
    gdf["area_km2"] = gdf.geometry.area / 1e6

    # Persist as geoparquet
    dest = interim("lsoa_boundaries.parquet")
    dest.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_parquet(dest)
    log.info("Wrote %d LSOA boundaries to %s", len(gdf), dest)

    # Write a simple LSOA list for downstream modules to filter with
    lsoa_list = gdf[["lsoa11cd"]].drop_duplicates()
    list_dest = interim("london_lsoa_list.csv")
    lsoa_list.to_csv(list_dest, index=False)
    log.info("Wrote London LSOA list (%d rows) to %s", len(lsoa_list), list_dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
