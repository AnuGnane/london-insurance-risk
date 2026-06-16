"""M2: combine all ingested sources into one small-area feature table.

In  : data/interim/{vehicle_crime,collisions,deprivation,area_boundaries}.parquet
Out : data/interim/lsoa_features.parquet
      columns (one row per area):
        area_code, lsoa11cd (alias), nation, population,
        vehicle_crime  — vehicle-crime incidents per 1k population per year
                         (NaN for Scotland: data.police.uk has no Scottish crime)
        road_casualties — severity-weighted collisions per 1k population per year
        deprivation — within-nation deprivation percentile (0–1, higher = worse)
        population_density — persons per km²

Missing-feature handling:
  vehicle_crime is genuinely 0 for an E+W area with no recorded crime, but
  MISSING (NaN) for Scotland where the source has no coverage. We distinguish the
  two by nation so build_risk_index can reweight Scotland around the gap rather
  than treating it as a crime-free area.
"""
from __future__ import annotations

import logging

import geopandas as gpd
import pandas as pd

from src.common.config import settings
from src.common.io import LSOA_FEATURES, interim, write_parquet

log = logging.getLogger(__name__)

# Nations with a vehicle-crime source: England+Wales via data.police.uk, Scotland
# via the Recorded-Crime-in-Scotland cube (src/ingest/scotland_crime.py). A
# covered nation's areas with no recorded crime are a true 0; uncovered nations
# (e.g. NI, if ever added) stay NaN so the index reweights around the gap.
CRIME_NATIONS = {"england", "wales", "scotland"}


def _load_parquet(name: str) -> pd.DataFrame:
    path = interim(name)
    if not path.exists():
        raise FileNotFoundError(f"Missing {path} — run the relevant ingest step first.")
    return pd.read_parquet(path)


def _load_boundaries() -> pd.DataFrame:
    """Area code, nation and area_km2 (tabular only, no geometry)."""
    path = interim("area_boundaries.parquet")
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path} — run `python -m src.ingest.boundaries` first."
        )
    gdf = gpd.read_parquet(path)
    return pd.DataFrame(gdf[["area_code", "nation", "area_km2"]])


def compute_vehicle_crime_rate(crime: pd.DataFrame, population: pd.DataFrame,
                               months_back: int) -> pd.DataFrame:
    """Vehicle-crime incidents per 1k population per year. Pure function."""
    counts = (
        crime.groupby("area_code", as_index=False).size()
        .rename(columns={"size": "vehicle_crime_count"})
    )
    merged = counts.merge(population, on="area_code", how="left")
    years_covered = months_back / 12
    merged["vehicle_crime"] = (
        merged["vehicle_crime_count"] / merged["population"].clip(lower=1)
        * 1000 / years_covered
    )
    return merged[["area_code", "vehicle_crime_count", "vehicle_crime"]]


def compute_casualty_rate(collisions: pd.DataFrame, population: pd.DataFrame,
                          years: list[int]) -> pd.DataFrame:
    """Severity-weighted casualties per 1k population per year. Pure function."""
    weighted = collisions.groupby("area_code", as_index=False).agg(
        casualty_weighted=("severity_weight", "sum"),
        collision_count=("severity_weight", "count"),
    )
    merged = weighted.merge(population, on="area_code", how="left")
    merged["road_casualties"] = (
        merged["casualty_weighted"] / merged["population"].clip(lower=1)
        * 1000 / max(len(years), 1)
    )
    return merged[["area_code", "casualty_weighted", "collision_count", "road_casualties"]]


def merge_demographics(features: pd.DataFrame, demographics: pd.DataFrame) -> pd.DataFrame:
    """Left-merge the demographic CONTROLS (young_driver_share, cars_per_household)
    onto the feature table by area_code. Pure function.

    Demographics are on Census 2021 (E+W) boundaries; the ~7% of 2011 codes that
    changed in 2021 don't match and are left NaN (the premium reconstruction holds
    missing controls at the national mean — see build_risk_index)."""
    cols = ["area_code", "young_driver_share", "cars_per_household"]
    present = [c for c in cols if c in demographics.columns]
    return features.merge(demographics[present], on="area_code", how="left")


def compute_population_density(population: pd.DataFrame,
                              boundaries: pd.DataFrame) -> pd.DataFrame:
    """Persons per km². Pure function."""
    merged = population.merge(boundaries, on="area_code", how="left")
    merged["population_density"] = (
        merged["population"] / merged["area_km2"].clip(lower=0.001)
    )
    return merged[["area_code", "population_density"]]


def run() -> None:
    log.info("Aggregating sources → %s", interim(LSOA_FEATURES))

    boundaries = _load_boundaries()
    dep = _load_parquet("deprivation.parquet")
    crime = _load_parquet("vehicle_crime.parquet")
    collisions = _load_parquet("collisions.parquet")

    pop = dep[["area_code", "population"]].copy()

    months_back = settings["data_years"]["crime_months_back"]
    crime_rate = compute_vehicle_crime_rate(crime, pop, months_back)
    # Scotland's vehicle crime comes pre-aggregated (council-level, annual rate)
    # from a different source; append it so all of GB carries the feature.
    scot_path = interim("scotland_vehicle_crime.parquet")
    if scot_path.exists():
        scot = pd.read_parquet(scot_path)[["area_code", "vehicle_crime_count", "vehicle_crime"]]
        crime_rate = pd.concat([crime_rate, scot], ignore_index=True)
        log.info("Added %d Scottish Data Zones to vehicle-crime table", len(scot))
    else:
        log.warning("No %s — Scotland vehicle_crime will be NaN. Run "
                    "`python -m src.ingest.scotland_crime` first.", scot_path)
    casualty_rate = compute_casualty_rate(collisions, pop, settings["data_years"]["stats19_years"])
    pop_density = compute_population_density(pop, boundaries)
    deprivation = dep[["area_code", "deprivation_pct"]].rename(
        columns={"deprivation_pct": "deprivation"}
    )

    # Master area list (one row per area, carries nation for the crime fill).
    features = (
        boundaries.merge(pop, on="area_code", how="left")
        .merge(crime_rate, on="area_code", how="left")
        .merge(casualty_rate, on="area_code", how="left")
        .merge(deprivation, on="area_code", how="left")
        .merge(pop_density, on="area_code", how="left")
    )

    # Collisions cover all GB, so a missing rate is a true zero everywhere.
    for col in ("road_casualties", "casualty_weighted", "collision_count"):
        features[col] = features[col].fillna(0)
    # Vehicle crime: 0 for E+W areas with no recorded crime, but NaN (missing)
    # for nations the source doesn't cover (Scotland) so they get reweighted.
    covered = features["nation"].isin(CRIME_NATIONS)
    features.loc[covered, "vehicle_crime"] = features.loc[covered, "vehicle_crime"].fillna(0)
    features.loc[covered, "vehicle_crime_count"] = (
        features.loc[covered, "vehicle_crime_count"].fillna(0)
    )

    # Demographic CONTROLS (young-driver share, cars/household) if ingested.
    demo_path = interim("demographics.parquet")
    if demo_path.exists():
        demo = pd.read_parquet(demo_path)
        features = merge_demographics(features, demo)
        matched = features["young_driver_share"].notna().sum()
        log.info("Merged demographic controls: %d/%d areas matched (%.0f%%)",
                 matched, len(features), 100 * matched / len(features))
    else:
        log.warning("No %s — demographic controls absent. Run "
                    "`python -m src.ingest.census_demographics` first.", demo_path)

    features["lsoa11cd"] = features["area_code"]  # backward-compat alias
    features = features.sort_values("area_code").reset_index(drop=True)

    log.info("Feature table: %d rows × %d cols", *features.shape)
    log.info("vehicle_crime NaN (expected = Scotland): %d",
             int(features["vehicle_crime"].isna().sum()))
    log.info("Feature summary:\n%s",
             features[["vehicle_crime", "road_casualties", "deprivation",
                       "population_density"]].describe().to_string())

    write_parquet(features, interim(LSOA_FEATURES))
    log.info("Wrote feature table to %s", interim(LSOA_FEATURES))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
