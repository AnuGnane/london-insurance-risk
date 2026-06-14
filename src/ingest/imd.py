"""Ingest English Indices of Deprivation 2019 (LSOA-level).

Source : MHCLG — File 7: All IoD2019 Scores, Ranks, Deciles and Population
         https://assets.publishing.service.gov.uk/media/
         5d8b387a40f0b604d4a32ad3/
         File_7_-_All_IoD2019_Scores__Ranks__Deciles_and_Population_Denominators_3.csv
Grain  : LSOA (2011)
Out    : data/interim/imd.parquet
         columns: lsoa11cd, imd_score, imd_rank, imd_decile,
                  income_score, crime_score, population
Vintage: IMD 2019 on 2011 LSOA boundaries.
"""
from __future__ import annotations

import io
import logging

import pandas as pd
import requests

from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

# Direct URL for File 7 — all IoD2019 scores, ranks, deciles, population
IMD_FILE7_URL = (
    "https://assets.publishing.service.gov.uk/media/"
    "5dc407b440f0b6379a7acc8d/"
    "File_7_-_All_IoD2019_Scores__Ranks__Deciles_and_"
    "Population_Denominators_3.csv"
)

# Column mapping: original File 7 names → clean names
COLUMNS = {
    "LSOA code (2011)": "lsoa11cd",
    "LSOA name (2011)": "lsoa11nm",
    "Index of Multiple Deprivation (IMD) Score": "imd_score",
    "Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)": "imd_rank",
    "Index of Multiple Deprivation (IMD) Decile (where 1 is most deprived 10% of LSOAs)": "imd_decile",
    "Income Score (rate)": "income_score",
    "Crime Score": "crime_score",
    "Total population: mid 2015 (excluding prisoners)": "population",
}


def _download_imd(cache_path=None) -> pd.DataFrame:
    """Download the IMD File 7 CSV and return as DataFrame."""
    cache = raw("imd_file7.csv") if cache_path is None else cache_path

    if cache.exists():
        log.info("Using cached IMD file at %s", cache)
        return pd.read_csv(cache)

    log.info("Downloading IMD File 7 from %s", IMD_FILE7_URL)
    resp = requests.get(IMD_FILE7_URL, timeout=60)
    resp.raise_for_status()

    # Cache the raw download
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(resp.content)
    log.info("Cached raw IMD CSV to %s", cache)

    return pd.read_csv(io.BytesIO(resp.content))


def _filter_to_london(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only London LSOAs using the list from boundaries ingest."""
    london_list_path = interim("london_lsoa_list.csv")
    if london_list_path.exists():
        london_lsoas = set(pd.read_csv(london_list_path)["lsoa11cd"])
        df = df[df["lsoa11cd"].isin(london_lsoas)].copy()
        log.info("Filtered to %d London LSOAs", len(df))
    else:
        # Fallback: London LSOAs start with E01 and belong to E09 LADs
        # IMD File 7 only has LSOA codes, so we keep all E01 for now
        log.warning(
            "london_lsoa_list.csv not found — run boundaries ingest first. "
            "Keeping ALL English LSOAs."
        )
    return df


def parse_imd(df: pd.DataFrame) -> pd.DataFrame:
    """Select and rename relevant columns from the raw IMD DataFrame.

    Pure function for testability.
    """
    available = {c: v for c, v in COLUMNS.items() if c in df.columns}
    missing = set(COLUMNS) - set(available)
    if missing:
        log.warning("Missing expected columns: %s", missing)

    df = df[list(available.keys())].rename(columns=available)
    return df


def run() -> None:
    log.info("Fetching IMD 2019")
    df_raw = _download_imd()
    df = parse_imd(df_raw)
    df = _filter_to_london(df)

    dest = interim("imd.parquet")
    write_parquet(df, dest)
    log.info("Wrote %d rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
