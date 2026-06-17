"""Ingest the ONS Postcode Directory (ONSPD) → postcode → small area.

Source : ONS Open Geography Portal — ONSPD (carries the 2011 small-area code)
Grain  : one row per postcode
Out    : data/interim/postcode_lookup.parquet
         columns: pcd7, pcd8, area_code, lsoa11cd, lat, long,
                  local_authority_code, postcode_district, postcode_area

Powers the postcode search in the API. Filtered to the configured footprint by
keeping only postcodes whose small area appears in area_boundaries.parquet.

Notes:
  - The ONSPD `lsoa11cd` column is a UNIFIED GB small-area code: it holds the
    LSOA in England & Wales and the Data Zone ('S01…') in Scotland, so it maps
    directly to area_boundaries.area_code. (NI SOAs '9…', Channel Islands 'L…'
    and Isle of Man 'M…' also appear but fall outside GB and are dropped.)
  - The ONSPD ZIP is large (~235 MB) and the extracted CSV ~1.4 GB / 2.7M rows;
    we download/extract once and read only the columns we need.
"""
from __future__ import annotations

import logging
import zipfile
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
    # Local-authority codes for the DfT traffic join. DfT publishes traffic at the
    # *highway authority* grain: the county (E10…) for two-tier shire areas, else
    # the unitary / metropolitan district / London borough / Scottish council. We
    # read both tiers and derive the highway authority in _derive_highway_authority.
    "cty25cd": "_county_code",       # E10 county (E99 = "none" for single-tier)
    "lad25cd": "_district_code",     # E06/E07/E08 district · S12 Scottish council
    # Older ONSPD vintages used these names — kept as fallbacks.
    "oslaua": "_district_code",
    "oscty": "_county_code",
}

# A real (two-tier) county the DfT keys traffic on; E99/S99/W99 mean "no county".
_COUNTY_PREFIX = "E10"


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
    """Read the ONSPD CSV, select key columns, and clean.

    Reads only the needed columns (the full file is ~1.4 GB / 2.7M rows). Pure
    function for testability (operates on a file path).
    """
    # Discover which source columns are present (header only).
    header = pd.read_csv(csv_path, nrows=0)
    present = {c.strip().lower() for c in header.columns}
    wanted = [c for c in NSPL_KEEP_COLS if c in present]
    if "lsoa11cd" not in wanted and "lsoa11" not in wanted:
        # tolerate variant names like 'lsoa11nm'/'lsoa11_code'
        wanted += [c for c in present if "lsoa11" in c][:1]

    df = pd.read_csv(
        csv_path,
        usecols=lambda c: c.strip().lower() in set(wanted),
        low_memory=False,
    )
    df.columns = [c.strip().lower() for c in df.columns]
    df = df.rename(columns={k: v for k, v in NSPL_KEEP_COLS.items() if k in df.columns})

    # Drop rows without a small-area code, then expose it as area_code (the
    # unified GB key) while keeping lsoa11cd for backward compatibility.
    df = df.dropna(subset=["lsoa11cd"])
    df["area_code"] = df["lsoa11cd"]

    for col in ("lat", "long"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = _derive_highway_authority(df)
    return df


def _derive_highway_authority(df: pd.DataFrame) -> pd.DataFrame:
    """Add `local_authority_code` = the DfT highway authority for each postcode:
    the county (E10…) where the area is two-tier, otherwise the lower-tier
    unitary/metropolitan/London/Scottish-council code. Pure-ish (operates on df)."""
    county = df["_county_code"] if "_county_code" in df.columns else pd.Series(index=df.index, dtype=object)
    district = df["_district_code"] if "_district_code" in df.columns else pd.Series(index=df.index, dtype=object)
    is_county = county.astype(str).str.startswith(_COUNTY_PREFIX)
    df["local_authority_code"] = district.where(~is_county, county)
    return df.drop(columns=[c for c in ("_county_code", "_district_code") if c in df.columns])


def _filter_to_footprint(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only postcodes whose small area is in the configured footprint.

    Filters against area_boundaries.parquet (which already reflects the footprint),
    which also drops out-of-GB postcodes (NI, Channel Islands, Isle of Man).
    """
    bpath = interim("area_boundaries.parquet")
    if not bpath.exists():
        raise FileNotFoundError(
            "area_boundaries.parquet not found — run boundaries ingest first."
        )
    areas = set(pd.read_parquet(bpath, columns=["area_code"])["area_code"])
    before = len(df)
    df = df[df["area_code"].isin(areas)].copy()
    log.info("Filtered %d → %d postcodes within footprint", before, len(df))
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
    df = _filter_to_footprint(df)
    df = _add_postcode_helpers(df)

    dest = interim("postcode_lookup.parquet")
    write_parquet(df, dest)
    log.info("Wrote %d postcode rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
