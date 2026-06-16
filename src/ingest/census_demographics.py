"""Ingest Census demographic CONTROLS: young-driver share + cars per household.

These are *composition* controls, not place features. Including them in the premium
model lets the place features (crime, traffic, density, flood) be estimated *net of*
who lives in an area — the statistically correct way to isolate the territorial
effect "independent of age" (see NEXT_PHASE_DESIGN.md §2).

Sources (England & Wales, Census 2021, via Nomis bulk CSV):
  - TS007A "Age by five-year age bands"   (NM_2020_1)  -> young_driver_share
  - TS045  "Car or van availability"      (NM_2063_1)  -> cars_per_household
Scotland (Census 2022) is added in a follow-up (see _fetch_scotland).

Grain : LSOA 2021 (E+W). NOTE the boundary vintage: Census 2021 is on 2021 LSOAs,
        while the model keys on 2011 LSOAs (area_code). The ~93% of codes that are
        unchanged merge directly; the remainder are left NaN and the index reweights
        (a 2011<->2021 best-fit lookup is a documented refinement).
Out   : data/interim/demographics.parquet
        columns: area_code, nation, young_driver_share, cars_per_household
Approx: 17-24 share uses a uniform-within-band split of the 15-19 band
        (ages 17,18,19 ≈ 3/5 of 15-19). Robust enough for a percentile-ranked control.
"""
from __future__ import annotations

import io
import logging

import pandas as pd

from src.common.http import get_with_retry
from src.common.io import interim, write_parquet

log = logging.getLogger(__name__)

NOMIS_BULK = "https://www.nomisweb.co.uk/api/v01/dataset/{ds}.bulk.csv"
TS045_CARS = "NM_2063_1"
TS007A_AGE = "NM_2020_1"

YOUNG_FRACTION_OF_15_19 = 0.6   # ages 17,18,19 of the 15-19 band, uniform-within-band


def bands_to_age_groups(df: pd.DataFrame, older_cols: list[str]) -> pd.DataFrame:
    """From five-year age-band columns derive age_17_24 and age_17_plus (pure)."""
    out = df.copy()
    young_15_19 = YOUNG_FRACTION_OF_15_19 * out["age_15_19"]
    out["age_17_24"] = young_15_19 + out["age_20_24"]
    out["age_17_plus"] = out["age_17_24"] + out[older_cols].sum(axis=1)
    return out


def derive_young_driver_share(df: pd.DataFrame) -> pd.DataFrame:
    """young_driver_share = age_17_24 / age_17_plus (pure)."""
    out = df.copy()
    out["young_driver_share"] = out["age_17_24"] / out["age_17_plus"].where(out["age_17_plus"] > 0)
    return out


def cars_to_per_household(df: pd.DataFrame) -> pd.DataFrame:
    """Mean cars/vans per household from the four count bands (3+ weighted 3, pure)."""
    out = df.copy()
    total_cars = out["hh_1"] + 2 * out["hh_2"] + 3 * out["hh_3plus"]
    households = out["hh_0"] + out["hh_1"] + out["hh_2"] + out["hh_3plus"]
    out["cars_per_household"] = total_cars / households.where(households > 0)
    return out


def _fetch_nomis_bulk(dataset_id: str) -> pd.DataFrame:
    """Download a Nomis bulk CSV at LSOA 2021 (geography TYPE151)."""
    resp = get_with_retry(
        NOMIS_BULK.format(ds=dataset_id),
        params={"time": "latest", "measures": "20100", "geography": "TYPE151"},
        timeout=180,
    )
    return pd.read_csv(io.StringIO(resp.text))


def _col(df: pd.DataFrame, needle: str) -> str:
    """Find the one column whose header contains `needle` (case-insensitive)."""
    hits = [c for c in df.columns if needle.lower() in c.lower()]
    if not hits:
        raise KeyError(f"no column containing {needle!r} in {list(df.columns)[:6]}…")
    return hits[0]


def _ew_age() -> pd.DataFrame:
    raw = _fetch_nomis_bulk(TS007A_AGE)
    band_map = {
        "Aged 15 to 19": "age_15_19", "Aged 20 to 24": "age_20_24",
        "Aged 25 to 29": "age_25_29", "Aged 30 to 34": "age_30_34",
        "Aged 35 to 39": "age_35_39", "Aged 40 to 44": "age_40_44",
        "Aged 45 to 49": "age_45_49", "Aged 50 to 54": "age_50_54",
        "Aged 55 to 59": "age_55_59", "Aged 60 to 64": "age_60_64",
        "Aged 65 to 69": "age_65_69", "Aged 70 to 74": "age_70_74",
        "Aged 75 to 79": "age_75_79", "Aged 80 to 84": "age_80_84",
        "Aged 85 years and over": "age_85_plus",
    }
    df = pd.DataFrame({"area_code": raw[_col(raw, "geography code")]})
    for needle, short in band_map.items():
        df[short] = raw[_col(raw, needle)]
    older = [v for v in band_map.values() if v not in ("age_15_19", "age_20_24")]
    df = derive_young_driver_share(bands_to_age_groups(df, older))
    return df[["area_code", "young_driver_share"]]


def _ew_cars() -> pd.DataFrame:
    raw = _fetch_nomis_bulk(TS045_CARS)
    df = pd.DataFrame({
        "area_code": raw[_col(raw, "geography code")],
        "hh_0": raw[_col(raw, "No cars or vans")],
        "hh_1": raw[_col(raw, "1 car or van")],
        "hh_2": raw[_col(raw, "2 cars or vans")],
        "hh_3plus": raw[_col(raw, "3 or more cars or vans")],
    })
    return cars_to_per_household(df)[["area_code", "cars_per_household"]]


def _nation_of(area_code: str) -> str:
    return {"E": "england", "W": "wales", "S": "scotland"}.get(area_code[:1], "other")


def run() -> None:
    log.info("Ingesting Census demographic controls (E+W)")
    age = _ew_age()
    cars = _ew_cars()
    df = age.merge(cars, on="area_code", how="outer")
    df["nation"] = df["area_code"].map(_nation_of)
    df = df[df["nation"].isin(["england", "wales"])].reset_index(drop=True)
    log.info("Demographics: %d E+W areas | young_driver_share median=%.3f | cars/hh median=%.2f",
             len(df), df["young_driver_share"].median(), df["cars_per_household"].median())
    write_parquet(df[["area_code", "nation", "young_driver_share", "cars_per_household"]],
                  interim("demographics.parquet"))
    log.info("Wrote %s", interim("demographics.parquet"))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
