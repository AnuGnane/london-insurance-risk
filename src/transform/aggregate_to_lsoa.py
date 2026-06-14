"""M2: combine all ingested sources into one LSOA feature table.

In  : data/interim/{vehicle_crime,collisions,imd,lsoa_boundaries}.parquet
Out : data/interim/lsoa_features.parquet
      columns (one row per LSOA):
        lsoa11cd,
        vehicle_crime  — vehicle-crime incidents per 1k population per year
        road_casualties — severity-weighted collisions per 1k population per year
        deprivation — IMD overall score (higher = more deprived)
        population_density — persons per km²

Approach:
  - Counts that already carry `lsoa11cd` (crime via spatial snap, collisions via
    lsoa_of_accident_location) → group-by.
  - Rates need denominators (population from IMD, area from boundaries).
  - Use duckdb for the group-by joins where beneficial.
"""
from __future__ import annotations

import logging

import duckdb
import pandas as pd

from src.common.config import settings
from src.common.io import LSOA_FEATURES, interim, write_parquet

log = logging.getLogger(__name__)


def _load_parquet(name: str) -> pd.DataFrame:
    """Load an interim parquet file, raising clearly if missing."""
    path = interim(name)
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path} — run the relevant ingest step first."
        )
    return pd.read_parquet(path)


def _load_boundaries() -> pd.DataFrame:
    """Load LSOA boundaries (tabular columns only, no geometry)."""
    import geopandas as gpd

    path = interim("lsoa_boundaries.parquet")
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path} — run `python -m src.ingest.boundaries` first."
        )
    gdf = gpd.read_parquet(path)
    return gdf[["lsoa11cd", "area_km2"]].copy()


def compute_vehicle_crime_rate(
    crime: pd.DataFrame,
    population: pd.DataFrame,
    months_back: int,
) -> pd.DataFrame:
    """Compute vehicle-crime rate per 1k population per year.

    Pure function for testability.

    Parameters
    ----------
    crime : DataFrame with lsoa11cd column (one row per incident)
    population : DataFrame with lsoa11cd, population columns
    months_back : number of months of crime data
    """
    # Count incidents per LSOA
    counts = (
        crime.groupby("lsoa11cd", as_index=False)
        .size()
        .rename(columns={"size": "vehicle_crime_count"})
    )

    # Join population
    merged = counts.merge(population, on="lsoa11cd", how="left")

    # Rate per 1k per year
    years_covered = months_back / 12
    merged["vehicle_crime"] = (
        merged["vehicle_crime_count"]
        / merged["population"].clip(lower=1)
        * 1000
        / years_covered
    )
    return merged[["lsoa11cd", "vehicle_crime_count", "vehicle_crime"]]


def compute_casualty_rate(
    collisions: pd.DataFrame,
    population: pd.DataFrame,
    years: list[int],
) -> pd.DataFrame:
    """Compute severity-weighted casualty rate per 1k population per year.

    Pure function for testability.
    """
    # Weighted sum per LSOA
    weighted = (
        collisions.groupby("lsoa11cd", as_index=False)
        .agg(
            casualty_weighted=("severity_weight", "sum"),
            collision_count=("severity_weight", "count"),
        )
    )

    # Join population
    merged = weighted.merge(population, on="lsoa11cd", how="left")

    # Rate per 1k per year
    n_years = len(years)
    merged["road_casualties"] = (
        merged["casualty_weighted"]
        / merged["population"].clip(lower=1)
        * 1000
        / max(n_years, 1)
    )
    return merged[["lsoa11cd", "casualty_weighted", "collision_count", "road_casualties"]]


def compute_population_density(
    population: pd.DataFrame,
    boundaries: pd.DataFrame,
) -> pd.DataFrame:
    """Compute population density (persons per km²).

    Pure function for testability.
    """
    merged = population.merge(boundaries, on="lsoa11cd", how="left")
    merged["population_density"] = (
        merged["population"] / merged["area_km2"].clip(lower=0.001)
    )
    return merged[["lsoa11cd", "population_density"]]


def run() -> None:
    log.info("Aggregating sources → %s", interim(LSOA_FEATURES))

    # Load sources
    boundaries = _load_boundaries()
    imd = _load_parquet("imd.parquet")
    crime = _load_parquet("vehicle_crime.parquet")
    collisions = _load_parquet("collisions.parquet")

    # Population from IMD File 7
    pop = imd[["lsoa11cd", "population"]].copy()

    # 1. Vehicle crime rate
    months_back = settings["data_years"]["crime_months_back"]
    crime_rate = compute_vehicle_crime_rate(crime, pop, months_back)

    # 2. Casualty rate
    years = settings["data_years"]["stats19_years"]
    casualty_rate = compute_casualty_rate(collisions, pop, years)

    # 3. Deprivation (already at LSOA grain)
    deprivation = imd[["lsoa11cd", "imd_score"]].rename(
        columns={"imd_score": "deprivation"}
    )

    # 4. Population density
    pop_density = compute_population_density(pop, boundaries)

    # Join all features on lsoa11cd using duckdb for speed
    conn = duckdb.connect()
    conn.register("crime_rate", crime_rate)
    conn.register("casualty_rate", casualty_rate)
    conn.register("deprivation", deprivation)
    conn.register("pop_density", pop_density)
    conn.register("pop", pop)

    features = conn.execute("""
        SELECT
            p.lsoa11cd,
            p.population,
            COALESCE(cr.vehicle_crime, 0) AS vehicle_crime,
            COALESCE(cr.vehicle_crime_count, 0) AS vehicle_crime_count,
            COALESCE(cas.road_casualties, 0) AS road_casualties,
            COALESCE(cas.casualty_weighted, 0) AS casualty_weighted,
            COALESCE(cas.collision_count, 0) AS collision_count,
            COALESCE(dep.deprivation, 0) AS deprivation,
            COALESCE(pd.population_density, 0) AS population_density
        FROM pop p
        LEFT JOIN crime_rate cr ON p.lsoa11cd = cr.lsoa11cd
        LEFT JOIN casualty_rate cas ON p.lsoa11cd = cas.lsoa11cd
        LEFT JOIN deprivation dep ON p.lsoa11cd = dep.lsoa11cd
        LEFT JOIN pop_density pd ON p.lsoa11cd = pd.lsoa11cd
        ORDER BY p.lsoa11cd
    """).df()

    conn.close()

    log.info("Feature table: %d rows × %d cols", *features.shape)
    log.info("Feature summary:\n%s", features.describe().to_string())

    dest = interim(LSOA_FEATURES)
    write_parquet(features, dest)
    log.info("Wrote feature table to %s", dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
