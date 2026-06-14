"""Ingest 'vehicle-crime' incidents from the data.police.uk API.

Source   : settings['sources']['police_api']
Endpoint : /crimes-street/vehicle-crime?poly=<lat,lng:...>&date=YYYY-MM
Grain    : point (anonymised/snapped lat,long)
Out      : data/interim/vehicle_crime.parquet  (one row per incident)

Notes:
  - No API key. Be polite: throttle, retry with backoff, and CACHE each
    month's response under data/raw/police/ so reruns don't refetch.
  - Pull settings['data_years']['crime_months_back'] months from the latest
    available month (GET /crime-last-updated for the latest date).
  - Query by polygon of the London boundary, or tile the bbox if the polygon
    exceeds the API's vertex/size limits.

TODO:
  - Implement month discovery, polygon paging, caching, and concat to parquet.
"""
from __future__ import annotations

import logging

from src.common.config import settings

log = logging.getLogger(__name__)
CATEGORY = "vehicle-crime"


def run() -> None:
    months = settings["data_years"]["crime_months_back"]
    log.info("Fetching %s of %s from police.uk", f"{months} months", CATEGORY)
    raise NotImplementedError("Wire up police.uk polygon paging + caching.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
