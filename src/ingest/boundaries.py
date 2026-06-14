"""Ingest LSOA boundary polygons for the London region.

Source : ONS Open Geography Portal (settings['sources']['geoportal'])
Grain  : LSOA polygon (filter to region E12000007)
Out    : data/interim/lsoa_boundaries.parquet  (geometry in EPSG:27700)

TODO:
  - Download the LSOA (2011) Boundaries (BGC/BSC clipped) GeoJSON/GeoPackage.
  - Filter to London LSOAs (codes starting E01 within London LADs, or join the
    LSOA->LAD->region lookup and keep region == E12000007).
  - Reproject to EPSG:27700 and persist as parquet (geopandas .to_parquet).
"""
from __future__ import annotations

import logging

from src.common.config import settings

log = logging.getLogger(__name__)


def run() -> None:
    region = settings["geography"]["region_code"]
    log.info("Fetching LSOA boundaries for region %s", region)
    raise NotImplementedError("Wire up ONS boundary download + London filter.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
