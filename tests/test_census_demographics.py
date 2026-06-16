"""Tests for the Census demographic-controls ingest (pure transforms)."""
import pandas as pd

from src.ingest.census_demographics import (
    bands_to_age_groups,
    cars_to_per_household,
    derive_young_driver_share,
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
