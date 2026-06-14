"""M2: combine all ingested sources into one LSOA feature table.

In  : data/interim/{vehicle_crime,collisions,imd,lsoa_boundaries}.parquet
Out : data/interim/lsoa_features.parquet
      columns (one row per LSOA):
        lsoa11cd,
        vehicle_crime_count, households (or vehicles) -> vehicle_crime_rate,
        casualty_weighted (slight/serious/fatal weighting), road_km|pop -> casualty_rate,
        imd_score,
        population, area_km2 -> population_density
        (vehicle_density if VEH0125 wired in)

Approach:
  - Counts that already carry `lsoa11cd` (crime via spatial snap, collisions via
    lsoa_of_accident_location) -> group-by in duckdb.
  - Rates need denominators (households/population/area) from boundaries + ONS.
  - Use src.common.geo.to_working() before any area/length calculation.
"""
from __future__ import annotations

import logging

from src.common.io import LSOA_FEATURES, interim

log = logging.getLogger(__name__)


def run() -> None:
    log.info("Aggregating sources -> %s", interim(LSOA_FEATURES))
    raise NotImplementedError("Join + group sources into the LSOA feature table.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
