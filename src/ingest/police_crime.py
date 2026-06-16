"""Ingest 'vehicle-crime' incidents from the data.police.uk bulk CSV archive.

Source   : https://policeuk-data.s3.amazonaws.com/archive/{latest}.zip
           One archive holds the last ~36 months for ALL England & Wales forces
           (plus BTP). data.police.uk does NOT cover Scotland or NI, so vehicle
           crime is an England+Wales feature only — Scotland is left missing and
           the risk index reweights around it (see build_risk_index).
Grain    : point (anonymised/snapped lat,long); each CSV row carries an LSOA code
Out      : data/interim/vehicle_crime.parquet
           columns: month, area_code, lsoa11cd, lsoa_name, latitude, longitude, outcome
Vintage  : latest `crime_months_back` months (config; default 36).

Notes:
  - Each per-month archive on S3 is itself a 36-month rolling window for every
    force, so we download ONE archive (the latest) rather than one per month.
  - Each CSV already has 'LSOA code'/'LSOA name' — no spatial join needed.
  - We keep only E/W LSOAs: BTP rows can reference other nations, but police.uk
    has no general Scottish/NI crime, so including stray transport-police rows
    would give those nations a misleadingly tiny crime count.
  - The raw archive ZIP is cached under data/raw/police/ so reruns don't redownload.
"""
from __future__ import annotations

import logging
import zipfile
from pathlib import Path

import pandas as pd

from src.common.config import settings
from src.common.http import get_with_retry
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

CATEGORY = "vehicle-crime"
POLICE_API = settings["sources"]["police_api"]
ARCHIVE_URL = "https://policeuk-data.s3.amazonaws.com/archive/{month}.zip"

CLEAN_RENAME = {
    "LSOA code": "area_code",
    "LSOA name": "lsoa_name",
    "Month": "month",
    "Latitude": "latitude",
    "Longitude": "longitude",
    "Last outcome category": "outcome",
}
OUT_COLS = ["month", "area_code", "lsoa11cd", "lsoa_name", "latitude", "longitude", "outcome"]


def _get_latest_date() -> str:
    """Latest available data month from the police.uk API, as 'YYYY-MM'."""
    resp = get_with_retry(f"{POLICE_API}/crime-last-updated", timeout=30)
    return resp.json()["date"][:7]


def _month_range(latest: str, months_back: int) -> list[str]:
    """List of YYYY-MM strings going back `months_back` months from `latest`."""
    parts = latest.split("-")
    year, month = int(parts[0]), int(parts[1])
    result = []
    for _ in range(months_back):
        result.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return result


def _load_archive(latest: str) -> Path:
    """Download (once) and cache the latest bulk archive ZIP; return its path."""
    cache_dir = raw("police")
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / f"{latest}.zip"
    if zip_path.exists():
        log.info("Using cached police archive %s", zip_path)
        return zip_path
    url = ARCHIVE_URL.format(month=latest)
    log.info("Downloading police archive %s", url)
    resp = get_with_retry(url, timeout=600, stream=True)
    zip_path.write_bytes(resp.content)
    log.info("Cached archive to %s (%.0f MB)", zip_path, zip_path.stat().st_size / 1e6)
    return zip_path


def _extract_vehicle_crime(zip_path: Path, months: set[str]) -> pd.DataFrame:
    """Read every force/month street CSV in `months` and keep vehicle crime."""
    frames: list[pd.DataFrame] = []
    with zipfile.ZipFile(zip_path) as zf:
        street_csvs = [
            n for n in zf.namelist()
            if n.endswith("-street.csv") and n.split("/")[0] in months
        ]
        log.info("Reading %d street CSVs across %d months", len(street_csvs), len(months))
        for name in street_csvs:
            with zf.open(name) as f:
                df = pd.read_csv(f, usecols=lambda c: c in CLEAN_RENAME or c == "Crime type")
            df = df[df["Crime type"] == "Vehicle crime"]
            if not df.empty:
                frames.append(df.drop(columns=["Crime type"]))
    if not frames:
        log.error("No vehicle-crime rows found in archive!")
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def clean_crime_data(df: pd.DataFrame) -> pd.DataFrame:
    """Standardise columns and keep E/W rows with an LSOA code. Pure function."""
    if df.empty:
        return df
    df = df.rename(columns=CLEAN_RENAME)
    df = df.dropna(subset=["area_code"])
    # police.uk covers England + Wales only; drop anything else (incl. BTP strays).
    df = df[df["area_code"].str.startswith(("E", "W"))].copy()
    df["lsoa11cd"] = df["area_code"]  # backward-compat alias
    return df[[c for c in OUT_COLS if c in df.columns]]


def run() -> None:
    months_back = settings["data_years"]["crime_months_back"]
    latest = _get_latest_date()
    months = set(_month_range(latest, months_back))
    log.info("Latest police.uk month %s; fetching %d months of %s",
             latest, len(months), CATEGORY)

    zip_path = _load_archive(latest)
    df = _extract_vehicle_crime(zip_path, months)
    if df.empty:
        log.error("No crime data — aborting")
        return

    df = clean_crime_data(df)
    dest = interim("vehicle_crime.parquet")
    write_parquet(df, dest)
    log.info("Wrote %d vehicle-crime rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
