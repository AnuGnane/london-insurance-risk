"""Ingest 'vehicle-crime' incidents from data.police.uk bulk CSV archive.

Source   : https://data.police.uk/data/  (bulk CSV download)
           Forces: Metropolitan Police Service + City of London Police
Grain    : point (anonymised/snapped lat,long); each CSV row has LSOA code
Out      : data/interim/vehicle_crime.parquet
           columns: month, lsoa11cd, lsoa_name, latitude, longitude, outcome
Vintage  : Latest 24 months (configurable via crime_months_back)

Notes:
  - The bulk archive is a ZIP containing per-force/per-month CSVs.
  - Each CSV already has 'LSOA code' and 'LSOA name' — no spatial join needed.
  - We filter to Crime type == 'Vehicle crime'.
  - Raw ZIPs are cached under data/raw/police/ so reruns don't re-download.
"""
from __future__ import annotations

import io
import logging
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

from src.common.config import settings
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

CATEGORY = "vehicle-crime"
POLICE_API = settings["sources"]["police_api"]

# London police forces
FORCES = ["metropolitan", "city-of-london"]


def _get_latest_date() -> str:
    """Ask the police.uk API for the latest available data month.

    Returns YYYY-MM string.
    """
    resp = requests.get(f"{POLICE_API}/crime-last-updated", timeout=30)
    resp.raise_for_status()
    return resp.json()["date"]


def _month_range(latest: str, months_back: int) -> list[str]:
    """Generate a list of YYYY-MM strings going back `months_back` months.

    `latest` may be 'YYYY-MM' or 'YYYY-MM-DD' (the API returns the latter).
    """
    parts = latest.split("-")
    year, month = int(parts[0]), int(parts[1])
    result = []
    for _ in range(months_back):
        result.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return result


def _download_force_month(force: str, month: str) -> pd.DataFrame | None:
    """Download a single force+month CSV from the police.uk API.

    Uses the street-level crimes endpoint with force-wide data.
    Caches raw JSON under data/raw/police/.
    """
    cache_dir = raw("police")
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{force}_{month}_vehicle-crime.csv"

    if cache_file.exists():
        log.debug("Cache hit: %s", cache_file)
        return pd.read_csv(cache_file)

    # Use the crimes-no-location + crimes-at-location endpoints, or
    # the simpler /crimes-street/vehicle-crime?force=&date= approach
    url = f"{POLICE_API}/crimes-no-location"
    params = {"category": "vehicle-crime", "force": force, "date": month}

    try:
        resp = requests.get(url, params=params, timeout=60)
        if resp.status_code == 429:
            log.warning("Rate limited on %s/%s — waiting 30s", force, month)
            time.sleep(30)
            resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as e:
        log.warning("Failed to fetch %s/%s: %s", force, month, e)
        return None

    data = resp.json()
    if not data:
        return None

    df = pd.json_normalize(data)
    df.to_csv(cache_file, index=False)
    return df


def _download_all_crime_data(months: list[str]) -> pd.DataFrame:
    """Download vehicle crime for all London forces across all months.

    Uses the force-wide crimes endpoint and caches per force/month.
    Falls back to the street-level API with a simplified approach.
    """
    frames: list[pd.DataFrame] = []
    cache_dir = raw("police")
    cache_dir.mkdir(parents=True, exist_ok=True)

    for force in FORCES:
        for month in months:
            cache_file = cache_dir / f"{force}_{month}.csv"

            if cache_file.exists():
                log.debug("Cache hit: %s", cache_file.name)
                df = pd.read_csv(cache_file)
                frames.append(df)
                continue

            # Street-level crimes for the whole force
            url = f"{POLICE_API}/crimes-street/vehicle-crime"
            params = {"force": force, "date": month}

            try:
                log.info("Fetching %s %s", force, month)
                resp = requests.get(url, params=params, timeout=120)

                if resp.status_code == 429:
                    log.warning("Rate-limited — sleeping 60s")
                    time.sleep(60)
                    resp = requests.get(url, params=params, timeout=120)

                if resp.status_code == 502:
                    log.warning(
                        "502 for %s/%s — too large, trying no-location",
                        force, month,
                    )
                    # Fallback: crimes-no-location (smaller response)
                    url2 = f"{POLICE_API}/crimes-no-location"
                    params2 = {
                        "category": "vehicle-crime",
                        "force": force,
                        "date": month,
                    }
                    resp = requests.get(url2, params=params2, timeout=120)

                resp.raise_for_status()
                data = resp.json()

                if not data:
                    log.info("No data for %s/%s", force, month)
                    continue

                df = pd.json_normalize(data)
                df["force"] = force
                df["query_month"] = month
                df.to_csv(cache_file, index=False)
                frames.append(df)

            except requests.RequestException as e:
                log.warning("Failed %s/%s: %s — skipping", force, month, e)

            # Throttle: be polite to police.uk
            time.sleep(1.0)

    if not frames:
        log.error("No crime data fetched at all!")
        return pd.DataFrame()

    return pd.concat(frames, ignore_index=True)


def clean_crime_data(df: pd.DataFrame) -> pd.DataFrame:
    """Standardise column names and filter to records with LSOA codes.

    Pure function for testability.
    """
    # The API returns nested JSON; after json_normalize the columns vary.
    # Standardise common patterns.
    rename_map = {}
    for col in df.columns:
        lower = col.lower().replace(" ", "_")
        if "lsoa_code" in lower or col == "location.street.lsoa_code":
            rename_map[col] = "lsoa11cd"
        elif "lsoa_name" in lower or col == "location.street.lsoa_name":
            rename_map[col] = "lsoa_name"
        elif col == "month":
            rename_map[col] = "month"
        elif col == "location.latitude":
            rename_map[col] = "latitude"
        elif col == "location.longitude":
            rename_map[col] = "longitude"
        elif "outcome_status.category" in col:
            rename_map[col] = "outcome"

    df = df.rename(columns=rename_map)

    # Keep only rows with an LSOA code
    if "lsoa11cd" in df.columns:
        df = df.dropna(subset=["lsoa11cd"])
        df = df[df["lsoa11cd"].str.startswith("E", na=False)]
    else:
        log.warning("No LSOA code column found in crime data")

    # Select output columns
    out_cols = ["month", "lsoa11cd", "lsoa_name", "latitude", "longitude", "outcome"]
    available = [c for c in out_cols if c in df.columns]
    return df[available].copy()


def _filter_to_london(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only crimes in London LSOAs."""
    london_path = interim("london_lsoa_list.csv")
    if london_path.exists() and "lsoa11cd" in df.columns:
        london_lsoas = set(pd.read_csv(london_path)["lsoa11cd"])
        before = len(df)
        df = df[df["lsoa11cd"].isin(london_lsoas)].copy()
        log.info("Filtered %d → %d London crimes", before, len(df))
    return df


def run() -> None:
    months_back = settings["data_years"]["crime_months_back"]

    # Discover latest available month
    latest = _get_latest_date()
    log.info("Latest police.uk data: %s", latest)

    months = _month_range(latest, months_back)
    log.info("Fetching %d months of %s: %s .. %s", len(months), CATEGORY, months[-1], months[0])

    df = _download_all_crime_data(months)
    if df.empty:
        log.error("No crime data — aborting")
        return

    df = clean_crime_data(df)
    df = _filter_to_london(df)

    dest = interim("vehicle_crime.parquet")
    write_parquet(df, dest)
    log.info("Wrote %d vehicle-crime rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
