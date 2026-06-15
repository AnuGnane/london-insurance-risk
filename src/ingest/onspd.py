"""Ingest the ONS National Statistics Postcode Lookup (NSPL) → postcode → LSOA.

Source : ONS Open Geography Portal — NSPL (lighter than full ONSPD)
Grain  : one row per postcode
Out    : data/interim/postcode_lookup.parquet
         columns: pcd7, lsoa11cd, lat, long, postcode_district, postcode_area

Powers the postcode search in the API. Filtered to London LSOAs to keep it small.

Notes:
  - The NSPL is available as a ZIP (~70 MB) from the ONS geoportal.
  - We only need pcd7, lsoa11, lat, long from the main data CSV.
  - The NSPL ZIP may be very large; we download and extract only once.
"""
from __future__ import annotations

import logging
import zipfile
from io import BytesIO
from pathlib import Path

import pandas as pd
import requests

from src.common.geo import postcode_area, postcode_district
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

# The ONSPD contains lsoa11cd which we need. NSPL dropped it in 2026.
NSPL_URL = (
    "https://www.arcgis.com/sharing/rest/content/items"
    "/6fff67d204fd4f339591ed667a6e3642/data"
)

# Columns we need from the ONSPD
NSPL_KEEP_COLS = {
    "pcd7": "pcd7",       # 7-char postcode
    "pcd8": "pcd8",       # 8-char postcode (with space)
    "lsoa11": "lsoa11cd",  # LSOA 2011 code (sometimes lsoa11)
    "lsoa11cd": "lsoa11cd",
    "lat": "lat",
    "long": "long",
}


def _download_nspl() -> Path:
    """Download the ONSPD ZIP and return path to the extracted data CSV."""
    cache_dir = raw("onspd")
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / "onspd.zip"
    csv_sentinel = cache_dir / "onspd_extracted.csv"

    if csv_sentinel.exists():
        log.info("Using cached ONSPD CSV at %s", csv_sentinel)
        return csv_sentinel

    if not zip_path.exists():
        log.info("Downloading ONSPD from ONS (%s)...", NSPL_URL)
        resp = requests.get(NSPL_URL, timeout=300, stream=True)
        resp.raise_for_status()
        zip_path.write_bytes(resp.content)
        log.info("Downloaded ONSPD ZIP to %s (%.1f MB)", zip_path, zip_path.stat().st_size / 1e6)

    # Find the main data CSV inside the ZIP
    with zipfile.ZipFile(zip_path) as zf:
        data_csv = None
        for name in zf.namelist():
            lower = name.lower()
            if "data/" in lower and lower.endswith(".csv") and "onspd" in lower and "multi_csv" not in lower:
                data_csv = name
                break

        if data_csv is None:
            # Fallback: find any large CSV
            for name in zf.namelist():
                if name.lower().endswith(".csv") and "data" in name.lower():
                    data_csv = name
                    break

        if data_csv is None:
            raise FileNotFoundError(
                f"Could not find ONSPD data CSV in {zip_path}. "
                f"Contents: {zf.namelist()[:20]}"
            )

        log.info("Extracting %s from ZIP...", data_csv)
        with zf.open(data_csv) as src, csv_sentinel.open("wb") as dst:
            dst.write(src.read())

    log.info("Extracted NSPL CSV to %s", csv_sentinel)
    return csv_sentinel


def parse_nspl(csv_path: Path) -> pd.DataFrame:
    """Read the NSPL CSV, select key columns, and clean.

    Pure function for testability (operates on a file path).
    """
    # Read with low_memory=False to avoid mixed-type warnings
    df = pd.read_csv(csv_path, low_memory=False)

    # Normalise column names to lowercase
    df.columns = [c.strip().lower() for c in df.columns]

    # Select the columns we need
    available = {orig: new for orig, new in NSPL_KEEP_COLS.items() if orig in df.columns}
    if "lsoa11" not in available:
        # Try alternative column names
        for col in df.columns:
            if "lsoa11" in col:
                available[col] = "lsoa11cd"
                break

    df = df[list(available.keys())].rename(columns=available)

    # Drop rows without an LSOA code
    df = df.dropna(subset=["lsoa11cd"])

    # Convert lat/long to numeric
    if "lat" in df.columns:
        df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    if "long" in df.columns:
        df["long"] = pd.to_numeric(df["long"], errors="coerce")

    return df


def _filter_to_london(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only postcodes in London LSOAs."""
    london_path = interim("london_lsoa_list.csv")
    if london_path.exists():
        london_lsoas = set(pd.read_csv(london_path)["lsoa11cd"])
        before = len(df)
        df = df[df["lsoa11cd"].isin(london_lsoas)].copy()
        log.info("Filtered %d → %d London postcodes", before, len(df))
    else:
        log.warning(
            "london_lsoa_list.csv not found — run boundaries ingest first. "
            "Keeping all postcodes."
        )
    return df


def _add_postcode_helpers(df: pd.DataFrame) -> pd.DataFrame:
    """Add postcode_district and postcode_area columns."""
    pcd_col = "pcd7" if "pcd7" in df.columns else "pcd8"
    if pcd_col in df.columns:
        df["postcode_district"] = df[pcd_col].apply(postcode_district)
        df["postcode_area"] = df[pcd_col].apply(postcode_area)
    return df


def run() -> None:
    log.info("Building postcode → LSOA lookup")

    csv_path = _download_nspl()
    df = parse_nspl(csv_path)
    df = _filter_to_london(df)
    df = _add_postcode_helpers(df)

    dest = interim("postcode_lookup.parquet")
    write_parquet(df, dest)
    log.info("Wrote %d postcode rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
