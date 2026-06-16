"""Tests for the Census demographic-controls ingest (pure transforms)."""
import pandas as pd

from src.ingest.census_demographics import (
    _age_label_to_year,
    bands_to_age_groups,
    cars_to_per_household,
    derive_young_driver_share,
    scotland_cars_per_household,
    scotland_young_driver_share,
)


def test_bands_to_age_groups_uniform_within_band():
    # 15-19 band = 50 -> ages 17,18,19 ≈ 0.6*50 = 30 counted as "young".
    # 20-24 = 40. older bands sum = 100. 17+ = 30 + 40 + 100 = 170.
    df = pd.DataFrame({
        "area_code": ["E01000001"],
        "age_15_19": [50], "age_20_24": [40],
        "age_25_29": [60], "age_85_plus": [40],
    })
    out = bands_to_age_groups(df, older_cols=["age_25_29", "age_85_plus"])
    assert abs(out.loc[0, "age_17_24"] - 70.0) < 1e-9        # 30 + 40
    assert abs(out.loc[0, "age_17_plus"] - 170.0) < 1e-9     # 30 + 40 + 100


def test_derive_young_driver_share():
    df = pd.DataFrame({"area_code": ["E01000001"], "age_17_24": [200], "age_17_plus": [1000]})
    out = derive_young_driver_share(df)
    assert abs(out.loc[0, "young_driver_share"] - 0.20) < 1e-9


def test_cars_to_per_household():
    # 10 hh with 0, 20 with 1, 5 with 2, 1 with 3+ => (0 + 20 + 10 + 3) / 36
    df = pd.DataFrame({"area_code": ["E01000001"],
                       "hh_0": [10], "hh_1": [20], "hh_2": [5], "hh_3plus": [1]})
    out = cars_to_per_household(df)
    assert abs(out.loc[0, "cars_per_household"] - (33 / 36)) < 1e-9


# --- Scotland (Census 2022, single-year age + grouped cars) -------------------

def test_age_label_to_year():
    assert _age_label_to_year("Under 1") == 0
    assert _age_label_to_year("17") == 17
    assert _age_label_to_year("100 and over") == 100
    assert _age_label_to_year("All people") is None


def test_scotland_young_driver_share_exact_17_24():
    # One Data Zone: ages 16 (10), 17 (5), 24 (5), 30 (80), 'All people' ignored.
    # young (17-24) = 10; adult (>=17) = 5+5+80 = 90 -> 10/90.
    age_long = pd.DataFrame({
        "dz": ["S01"] * 5,
        "age": ["All people", "16", "17", "24", "30"],
        "count": [999, 10, 5, 5, 80],
    })
    out = scotland_young_driver_share(age_long)
    assert out.loc[0, "area_code"] == "S01"
    assert abs(out.loc[0, "young_driver_share"] - (10 / 90)) < 1e-9


def test_scotland_cars_per_household_caps_at_3():
    # 'Four or more' is capped at weight 3 to match the E+W TS045 '3 or more'.
    # hh: 0->10, 1->20, 2->5, 3->1, 4+->1  => cars = 0+20+10+3+3 = 36 over 37 hh.
    car_long = pd.DataFrame({
        "dz": ["S01"] * 6,
        "cars": [
            "Number of cars or vans in household: All occupied households",
            "Number of cars or vans in household: No cars or vans",
            "Number of cars or vans in household: One car or van",
            "Number of cars or vans in household: Two cars or vans",
            "Number of cars or vans in household: Three cars or vans",
            "Number of cars or vans in household: Four or more cars or vans",
        ],
        "count": [37, 10, 20, 5, 1, 1],
    })
    out = scotland_cars_per_household(car_long)
    assert out.loc[0, "area_code"] == "S01"
    assert abs(out.loc[0, "cars_per_household"] - (36 / 37)) < 1e-9
