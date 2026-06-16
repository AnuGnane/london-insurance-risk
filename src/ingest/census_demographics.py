"""Ingest Census demographic CONTROLS: young-driver share + cars per household.

These are *composition* controls, not place features. Including them in the premium
model lets the place features (crime, traffic, density, flood) be estimated *net of*
who lives in an area — the statistically correct way to isolate the territorial
effect "independent of age" (see NEXT_PHASE_DESIGN.md §2).

Sources (England & Wales, Census 2021, via Nomis bulk CSV):
  - TS007A "Age by five-year age bands"   (NM_2020_1)  -> young_driver_share
  - TS045  "Car or van availability"      (NM_2063_1)  -> cars_per_household
Sources (Scotland, Census 2022, via UK Data Service CSV — see _fetch_scotland):
  - UV103 "Age by single year"            -> young_driver_share (exact 17-24)
  - UV405 "Car or van availability"       -> cars_per_household
  Crucially these Scottish tables are published on **2011 Data Zones** (the model's
  keys), so NO 2022<->2011 crosswalk is needed; they merge directly.

Grain : LSOA 2021 (E+W) / Data Zone 2011 (Scotland). NOTE the E+W boundary vintage:
        Census 2021 is on 2021 LSOAs while the model keys on 2011 LSOAs (area_code);
        the ~93% of unchanged codes merge directly, the remainder are left NaN and
        the index reweights (a 2011<->2021 best-fit lookup is a documented refinement).
Out   : data/interim/demographics.parquet
        columns: area_code, nation, young_driver_share, cars_per_household
Approx: E+W 17-24 share uses a uniform-within-band split of the 15-19 band
        (ages 17,18,19 ≈ 3/5 of 15-19); Scotland uses exact single-year counts.
        Both robust for a percentile-ranked control. Cars cap at 3+ in both nations.
"""
from __future__ import annotations

import io
import logging

import pandas as pd

from src.common.config import settings
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


# --- Scotland (Census 2022, UK Data Service, on 2011 Data Zones) ---------------

def _age_label_to_year(label: str) -> int | None:
    """Parse a UV103 single-year age label to an int ('Under 1'->0, '100 and over'
    ->100, 'All people'->None). Pure."""
    s = str(label).strip()
    if s == "All people":
        return None
    low = s.lower()
    if low.startswith("under 1"):
        return 0
    if "100" in s:
        return 100
    try:
        return int(s)
    except ValueError:
        return None


# Scotland UV405 car-band labels -> car count, capped at 3+ to match the E+W TS045
# "3 or more" weighting (so cars_per_household is comparable across the border).
_SCOT_CAR_WEIGHT = {
    "No cars or vans": 0, "One car or van": 1, "Two cars or vans": 2,
    "Three cars or vans": 3, "Four or more cars or vans": 3,
}


def scotland_young_driver_share(age_long: pd.DataFrame) -> pd.DataFrame:
    """From the long UV103 table (dz, age, count) -> young_driver_share per Data Zone
    (exact ages 17-24 over the 17+ adult population). Pure."""
    df = age_long.copy()
    df["yr"] = df["age"].map(_age_label_to_year)
    df = df[df["yr"].notna()]
    g = df.groupby("dz").apply(
        lambda d: pd.Series({
            "young": d.loc[d["yr"].between(17, 24), "count"].sum(),
            "adult": d.loc[d["yr"] >= 17, "count"].sum(),
        }),
        include_groups=False,
    ).reset_index()
    g["young_driver_share"] = g["young"] / g["adult"].where(g["adult"] > 0)
    return g.rename(columns={"dz": "area_code"})[["area_code", "young_driver_share"]]


def scotland_cars_per_household(car_long: pd.DataFrame) -> pd.DataFrame:
    """From the long UV405 table (dz, cars, count) -> cars_per_household per Data
    Zone (3+ capped to match E+W). Pure."""
    df = car_long.copy()
    df["lab"] = df["cars"].str.replace(
        "Number of cars or vans in household: ", "", regex=False)
    df = df[df["lab"] != "All occupied households"].copy()
    df["w"] = df["lab"].map(_SCOT_CAR_WEIGHT)
    df = df.dropna(subset=["w"])
    g = df.groupby("dz").apply(
        lambda d: pd.Series({
            "cars": (d["w"] * d["count"]).sum(), "hh": d["count"].sum()}),
        include_groups=False,
    ).reset_index()
    g["cars_per_household"] = g["cars"] / g["hh"].where(g["hh"] > 0)
    return g.rename(columns={"dz": "area_code"})[["area_code", "cars_per_household"]]


def _load_superweb(url: str, value_name: str) -> pd.DataFrame:
    """Fetch a SuperWEB2 long-format census CSV and return a tidy frame with
    columns [counting, dz, value_name, count], keeping only Data Zone (S01) rows.

    These exports carry a title preamble, the data table (header starting with
    "Counting"), then a footer of INFO/copyright lines — so we slice from the
    header and keep only rows whose geography code is a 2011 Data Zone."""
    resp = get_with_retry(url, timeout=180)
    lines = resp.text.splitlines()
    hdr = next(i for i, ln in enumerate(lines) if ln.startswith('"Counting"'))
    df = pd.read_csv(io.StringIO("\n".join(lines[hdr:])))
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]   # drop trailing empty col
    df.columns = ["counting", "dz", value_name, "count"]
    df = df[df["dz"].astype(str).str.startswith("S01")].copy()
    df["count"] = pd.to_numeric(df["count"], errors="coerce")
    return df


def _fetch_scotland() -> pd.DataFrame:
    """Scotland demographic controls (Census 2022, on 2011 Data Zones)."""
    age = _load_superweb(settings["sources"]["scotland_census_age_csv"], "age")
    cars = _load_superweb(settings["sources"]["scotland_census_cars_csv"], "cars")
    young = scotland_young_driver_share(age)
    cph = scotland_cars_per_household(cars)
    return young.merge(cph, on="area_code", how="outer")


def run() -> None:
    log.info("Ingesting Census demographic controls (E+W Census 2021 + Scotland Census 2022)")
    ew = _ew_age().merge(_ew_cars(), on="area_code", how="outer")
    ew["nation"] = ew["area_code"].map(_nation_of)
    ew = ew[ew["nation"].isin(["england", "wales"])]

    try:
        scot = _fetch_scotland()
        scot["nation"] = "scotland"
        log.info("Scotland demographics: %d Data Zones (Census 2022 on 2011 DZ)", len(scot))
    except Exception as exc:  # noqa: BLE001 — Scotland is additive; never fail E+W on it
        log.warning("Scotland demographics unavailable (%s) — proceeding E+W only", exc)
        scot = pd.DataFrame(columns=["area_code", "young_driver_share",
                                     "cars_per_household", "nation"])

    df = pd.concat([ew, scot], ignore_index=True)
    cols = ["area_code", "nation", "young_driver_share", "cars_per_household"]
    for nation in ("england", "wales", "scotland"):
        sub = df[df["nation"] == nation]
        if len(sub):
            log.info("  %-8s %6d areas | young_driver_share median=%.3f | cars/hh median=%.2f",
                     nation, len(sub), sub["young_driver_share"].median(),
                     sub["cars_per_household"].median())
    write_parquet(df[cols].reset_index(drop=True), interim("demographics.parquet"))
    log.info("Wrote %d areas to %s", len(df), interim("demographics.parquet"))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
