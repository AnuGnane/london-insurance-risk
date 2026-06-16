"""Ingest small-area deprivation for Great Britain (England, Wales, Scotland).

Each nation publishes its own index on its own methodology and scale, so the
indices are NOT directly comparable across borders. The honest fix (AGENTS.md
rule 4) is to rank each area WITHIN its own nation and expose that as a
0–1 percentile (deprivation_pct, higher = more deprived) — that percentile is
the cross-nation-comparable feature the risk model consumes.

Sources:
  England  : MHCLG IoD2019 File 7 (score, rank, population mid-2015)   — direct CSV
  Wales    : WIMD 2019 Overall ranks (1–1,909)                          — Welsh Gov ArcGIS
             population: 2011 Census usual residents                    — NOMIS KS101EW
  Scotland : SIMD 2020v2 ranks (1–6,976)                                — NHS Scotland open data
             population: Data Zone totpop2011 (2011 Census)             — gov.scot service

Grain  : small area (LSOA in E+W, Data Zone in Scotland)
Out    : data/interim/deprivation.parquet
         columns: area_code, nation, deprivation_score, deprivation_rank,
                  deprivation_pct, population
Vintage: England IoD2019 / Wales WIMD2019 / Scotland SIMD2020v2 (all on 2011 areas).
NI deferred (NIMDM 2017) — see implementation_plan.md.
"""
from __future__ import annotations

import io
import logging

import pandas as pd

from src.common.config import active_nations
from src.common.http import fetch_arcgis_attributes, get_with_retry
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

# --- England: MHCLG IoD2019 File 7 -----------------------------------------
IMD_FILE7_URL = (
    "https://assets.publishing.service.gov.uk/media/"
    "5dc407b440f0b6379a7acc8d/"
    "File_7_-_All_IoD2019_Scores__Ranks__Deciles_and_"
    "Population_Denominators_3.csv"
)
ENGLAND_COLUMNS = {
    "LSOA code (2011)": "area_code",
    "Index of Multiple Deprivation (IMD) Score": "deprivation_score",
    "Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)": "deprivation_rank",
    "Total population: mid 2015 (excluding prisoners)": "population",
}

# --- Wales: WIMD 2019 Overall (Welsh Government ArcGIS) ---------------------
WIMD_OVERALL_URL = (
    "https://services9.arcgis.com/3DS2hBWXSllJ5p3H/arcgis/rest/services"
    "/Welsh_Index_of_Multiple_Deprivation_WIMD_2019_Overall/FeatureServer/0/query"
)
# NOMIS KS101EW usual-resident population, restricted to LSOAs within Wales.
WALES_POP_URL = (
    "https://www.nomisweb.co.uk/api/v01/dataset/NM_144_1.data.csv"
    "?geography=2092957700TYPE298&measures=20100&RURAL_URBAN=0"
)

# --- Scotland: SIMD 2020v2 (NHS open data) + Data Zone population -----------
SIMD_CSV_URL = (
    "https://www.opendata.nhs.scot/dataset/78d41fa9-1a62-4f7b-9edb-3e8522a93378"
    "/resource/acade396-8430-4b34-895a-b3e757fa346e/download/simd2020v2_22062020.csv"
)
SCOTLAND_DZ_URL = (
    "https://maps.gov.scot/server/rest/services"
    "/ScotGov/StatisticalUnits/MapServer/2/query"
)


def _cached_csv(url: str, name: str) -> pd.DataFrame:
    """Download a CSV to data/raw/<name> once, then read from cache."""
    cache = raw(name)
    if cache.exists():
        log.info("Using cached %s", cache)
        return pd.read_csv(cache, low_memory=False)
    log.info("Downloading %s -> %s", url, cache)
    resp = get_with_retry(url, timeout=300)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(resp.content)
    return pd.read_csv(io.BytesIO(resp.content), low_memory=False)


def parse_imd(df: pd.DataFrame) -> pd.DataFrame:
    """Select/rename England IoD2019 columns. Pure function for testability."""
    available = {c: v for c, v in ENGLAND_COLUMNS.items() if c in df.columns}
    missing = set(ENGLAND_COLUMNS) - set(available)
    if missing:
        log.warning("England IMD missing expected columns: %s", missing)
    return df[list(available.keys())].rename(columns=available)


def _england() -> pd.DataFrame:
    df = parse_imd(_cached_csv(IMD_FILE7_URL, "imd_file7.csv"))
    df["nation"] = "england"
    log.info("England: %d LSOAs", len(df))
    return df


def _wales() -> pd.DataFrame:
    ranks = pd.DataFrame(
        fetch_arcgis_attributes(
            WIMD_OVERALL_URL, out_fields="lsoa_code,rank", page_size=2000
        )
    ).rename(columns={"lsoa_code": "area_code", "rank": "deprivation_rank"})

    pop_raw = _cached_csv(WALES_POP_URL, "wales_population.csv")
    pop = pop_raw[pop_raw["CELL_NAME"] == "All usual residents"]
    pop = pop[["GEOGRAPHY_CODE", "OBS_VALUE"]].rename(
        columns={"GEOGRAPHY_CODE": "area_code", "OBS_VALUE": "population"}
    )

    df = ranks.merge(pop, on="area_code", how="left")
    df["deprivation_score"] = pd.NA  # WIMD publishes ranks, not a comparable score
    df["nation"] = "wales"
    log.info("Wales: %d LSOAs (%d missing population)",
             len(df), int(df["population"].isna().sum()))
    return df


def _scotland() -> pd.DataFrame:
    simd = _cached_csv(SIMD_CSV_URL, "simd2020v2.csv")
    simd = simd[["DataZone", "SIMD2020V2Rank"]].rename(
        columns={"DataZone": "area_code", "SIMD2020V2Rank": "deprivation_rank"}
    )

    pop = pd.DataFrame(
        fetch_arcgis_attributes(
            SCOTLAND_DZ_URL, out_fields="datazone,totpop2011", page_size=1000
        )
    ).rename(columns={"datazone": "area_code", "totpop2011": "population"})

    df = simd.merge(pop, on="area_code", how="left")
    df["deprivation_score"] = pd.NA  # SIMD publishes ranks, not a comparable score
    df["nation"] = "scotland"
    log.info("Scotland: %d Data Zones (%d missing population)",
             len(df), int(df["population"].isna().sum()))
    return df


def _within_nation_percentile(df: pd.DataFrame) -> pd.DataFrame:
    """Add deprivation_pct: rank within own nation, 0–1, higher = more deprived.

    Ranks are nation-specific (1 = most deprived). Converting to a within-nation
    percentile is what makes the three indices comparable across borders.
    """
    df = df.copy()
    n = df["deprivation_rank"].max()
    df["deprivation_pct"] = (n - df["deprivation_rank"]) / (n - 1)
    return df


_FETCHERS = {"england": _england, "wales": _wales, "scotland": _scotland}


def run() -> None:
    nations = active_nations()
    log.info("Building GB deprivation for nations=%s", nations)

    parts = [
        _within_nation_percentile(_FETCHERS[n]())
        for n in nations
        if n in _FETCHERS
    ]
    cols = ["area_code", "nation", "deprivation_score", "deprivation_rank",
            "deprivation_pct", "population"]
    df = pd.concat([p[cols] for p in parts], ignore_index=True)

    # Keep only areas in the current footprint (mirrors area_boundaries).
    bpath = interim("area_boundaries.parquet")
    if bpath.exists():
        areas = set(pd.read_parquet(bpath, columns=["area_code"])["area_code"])
        before = len(df)
        df = df[df["area_code"].isin(areas)].copy()
        log.info("Filtered %d → %d areas within footprint", before, len(df))

    dest = interim("deprivation.parquet")
    write_parquet(df, dest)
    log.info("Wrote %d deprivation rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
