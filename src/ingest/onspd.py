"""Ingest the ONS Postcode Directory (ONSPD/NSPL) -> postcode->LSOA lookup.

Source : ONS Open Geography Portal
Grain  : one row per postcode (pcd, lsoa11, lat, long, ...)
Out    : data/interim/postcode_lookup.parquet  (London postcodes only)

Powers the postcode search in the API. Filter to London LSOAs to keep it small.

TODO:
  - Download ONSPD (or the lighter NSPL) CSV.
  - Keep columns: postcode, lsoa11cd, lat, long; filter to London LSOAs.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def run() -> None:
    log.info("Building postcode -> LSOA lookup")
    raise NotImplementedError("Wire up ONSPD/NSPL download + London filter.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
