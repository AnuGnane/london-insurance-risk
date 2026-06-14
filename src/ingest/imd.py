"""Ingest English Indices of Deprivation 2019 (LSOA-level).

Source : settings['sources']['imd2019']
Grain  : LSOA (2011)
Out    : data/interim/imd.parquet  (lsoa11cd, imd_score, imd_rank, imd_decile)

TODO:
  - Download 'File 7: all ranks, deciles and scores' (or File 1 for the summary).
  - Keep overall IMD score + rank; optionally crime/living-environment domains.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def run() -> None:
    log.info("Fetching IMD 2019")
    raise NotImplementedError("Wire up IMD 2019 download + column selection.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
