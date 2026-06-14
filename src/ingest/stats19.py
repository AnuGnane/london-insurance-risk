"""Ingest DfT STATS19 road collision data.

Source : settings['sources']['stats19_landing']  (data.gov.uk Road Safety Data)
Grain  : collision points; the collision table includes
         `lsoa_of_accident_location` so you can aggregate to LSOA WITHOUT a
         spatial join (fall back to point-in-polygon if a row lacks it).
Out    : data/interim/collisions.parquet
         columns: collision_ref, lsoa11cd, severity, year, lat, long

Notes:
  - Download the collision CSV(s) for settings['data_years']['stats19_years'].
  - Map severity codes -> {fatal, serious, slight}; keep numeric for weighting.
  - Pure pandas is enough; the R 'stats19' package is NOT required.
"""
from __future__ import annotations

import logging

from src.common.config import settings

log = logging.getLogger(__name__)


def run() -> None:
    years = settings["data_years"]["stats19_years"]
    log.info("Fetching STATS19 collisions for %s", years)
    raise NotImplementedError("Wire up STATS19 CSV download + severity mapping.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
