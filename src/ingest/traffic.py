"""Ingest DfT road traffic exposure at local-authority grain.

Source : DfT Road traffic statistics downloads
         https://roadtraffic.dft.gov.uk/downloads
Grain  : local authority annual traffic volume (million vehicle miles), allocated
         to 2011 LSOA / Data Zone by population share within each authority.
Out    : data/interim/traffic.parquet
         columns: area_code, local_authority_code, traffic_million_vehicle_miles,
                  traffic_per_capita
Vintage: Years per config.data_years.traffic_years.

Phase 3 starts with local-authority traffic rather than sparse count-point AADF:
DfT warns that road-link and small-area estimates are less robust than regional
and local-authority totals. The output is therefore a stable exposure denominator
for the first collision revisit; point-level refinement can follow if it adds
signal in calibration.
"""
from __future__ import annotations

import io
import logging
import re
from html import unescape
from urllib.parse import urljoin

import pandas as pd

from src.common.config import settings
from src.common.http import get_with_retry
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

DOWNLOAD_LABEL = "Local authority traffic by vehicle class"
DOWNLOADS_URL = "https://roadtraffic.dft.gov.uk/downloads"


def discover_download_url(html: str, label: str) -> str:
    """Return the first CSV href after ``label`` in the DfT downloads page."""
    start = html.lower().find(label.lower())
    if start == -1:
        raise ValueError(f"Could not find traffic download label {label!r}")
    snippet = html[start : start + 4000]
    match = re.search(r'href=["\']([^"\']+\.csv[^"\']*)["\']', snippet, re.I)
    if not match:
        raise ValueError(f"Could not find CSV link after {label!r}")
    return urljoin(DOWNLOADS_URL, unescape(match.group(1)))


def _norm_col(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def _find_col(columns: list[str], candidates: list[str]) -> str:
    for candidate in candidates:
        for col in columns:
            if candidate in col:
                return col
    raise KeyError(f"Could not find any of {candidates!r} in {columns!r}")


def normalise_local_authority_traffic(
    raw_df: pd.DataFrame, years: list[int]
) -> pd.DataFrame:
    """Standardise DfT LA traffic rows to mean annual million vehicle miles.

    Supports the current wide download (one ``all_motor_vehicles`` column) and a
    long variant with vehicle class rows. Pure function for testability.
    """
    df = raw_df.copy()
    df.columns = [_norm_col(c) for c in df.columns]
    year_col = _find_col(list(df.columns), ["year"])
    la_col = _find_col(
        list(df.columns),
        ["local_authority_id", "local_authority_code", "ons_code", "lad_code"],
    )
    df[year_col] = pd.to_numeric(df[year_col], errors="coerce")
    if years:
        df = df[df[year_col].isin(years)].copy()

    if "all_motor_vehicles" in df.columns:
        value_col = "all_motor_vehicles"
    else:
        vehicle_col = _find_col(list(df.columns), ["vehicle"])
        value_col = _find_col(
            list(df.columns),
            ["traffic_million_vehicle_miles", "million_vehicle_miles", "traffic"],
        )
        df = df[
            df[vehicle_col].astype(str).str.lower().str.contains("all motor")
        ].copy()

    df[value_col] = pd.to_numeric(df[value_col], errors="coerce")
    if df[value_col].median(skipna=True) > 1_000_000:
        df[value_col] = df[value_col] / 1_000_000
    out = (
        df.dropna(subset=[la_col, value_col])
        .groupby(la_col, as_index=False)[value_col]
        .mean()
        .rename(
            columns={
                la_col: "local_authority_code",
                value_col: "traffic_million_vehicle_miles",
            }
        )
    )
    out["local_authority_code"] = out["local_authority_code"].astype(str)
    return out[["local_authority_code", "traffic_million_vehicle_miles"]]


def area_authority_lookup(postcodes: pd.DataFrame) -> pd.DataFrame:
    """Choose the modal local-authority code for each small area from ONSPD rows."""
    required = {"area_code", "local_authority_code"}
    missing = required - set(postcodes.columns)
    if missing:
        raise KeyError(f"postcode lookup missing columns: {sorted(missing)}")
    clean = postcodes.dropna(subset=["area_code", "local_authority_code"]).copy()
    lookup = (
        clean.groupby("area_code")["local_authority_code"]
        .agg(lambda s: s.mode().iloc[0])
        .reset_index()
    )
    return lookup


def allocate_traffic_to_areas(
    la_traffic: pd.DataFrame, area_authority: pd.DataFrame, population: pd.DataFrame
) -> pd.DataFrame:
    """Allocate LA traffic to areas by their share of LA population.

    This produces an annual traffic exposure in million vehicle miles and a
    local-authority traffic-per-resident signal for each area.
    """
    area_pop = area_authority.merge(population, on="area_code", how="inner")
    area_pop["population"] = pd.to_numeric(area_pop["population"], errors="coerce")
    la_pop = (
        area_pop.groupby("local_authority_code")["population"]
        .sum()
        .rename("la_population")
    )
    merged = area_pop.merge(la_pop, on="local_authority_code", how="left").merge(
        la_traffic, on="local_authority_code", how="inner"
    )
    share = merged["population"] / merged["la_population"].where(
        merged["la_population"] > 0
    )
    merged["traffic_million_vehicle_miles"] = (
        merged["traffic_million_vehicle_miles"] * share
    )
    merged["traffic_per_capita"] = (
        merged["traffic_million_vehicle_miles"] * 1_000_000
        / merged["population"].where(merged["population"] > 0)
    )
    return merged[
        [
            "area_code",
            "local_authority_code",
            "traffic_million_vehicle_miles",
            "traffic_per_capita",
        ]
    ]


def _download_local_authority_traffic() -> pd.DataFrame:
    """Fetch/cache the DfT local-authority traffic CSV."""
    cache_dir = raw("traffic")
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / "local_authority_traffic.csv"
    if cache_file.exists():
        log.info("Using cached DfT traffic CSV at %s", cache_file)
        return pd.read_csv(cache_file, low_memory=False)

    downloads_url = settings["sources"].get("road_traffic_downloads", DOWNLOADS_URL)
    html = get_with_retry(downloads_url, timeout=120).text
    csv_url = discover_download_url(html, DOWNLOAD_LABEL)
    log.info("Downloading DfT local-authority traffic from %s", csv_url)
    resp = get_with_retry(csv_url, timeout=180)
    cache_file.write_bytes(resp.content)
    return pd.read_csv(io.BytesIO(resp.content), low_memory=False)


def run() -> None:
    log.info("Ingesting DfT traffic exposure")
    years = settings["data_years"].get("traffic_years", [])
    raw_traffic = _download_local_authority_traffic()
    la_traffic = normalise_local_authority_traffic(raw_traffic, years)

    postcodes = pd.read_parquet(interim("postcode_lookup.parquet"))
    area_authority = area_authority_lookup(postcodes)
    population = pd.read_parquet(interim("deprivation.parquet"))[
        ["area_code", "population"]
    ]
    traffic = allocate_traffic_to_areas(la_traffic, area_authority, population)
    dest = interim("traffic.parquet")
    write_parquet(traffic, dest)
    log.info("Wrote traffic exposure for %d areas to %s", len(traffic), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
