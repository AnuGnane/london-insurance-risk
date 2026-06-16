"""Tests for the relative-index calibration pieces."""
import pandas as pd

from src.calibrate.calibrate import (
    COMPOSITION_COLS,
    PLACE_COLS,
    to_relative_index,
)


def test_relative_index_falls_back_to_quarter_mean():
    panel = pd.DataFrame({"quarter": ["2024-Q1", "2024-Q1"], "avg_premium_gbp": [1500, 500]})
    out = to_relative_index(panel)
    # no national-grain row -> national avg = mean(1500, 500) = 1000
    assert abs(out.loc[0, "premium_index"] - 1.5) < 1e-9
    assert abs(out.loc[1, "premium_index"] - 0.5) < 1e-9


def test_relative_index_uses_national_grain_row():
    panel = pd.DataFrame({
        "quarter": ["2024-Q1", "2024-Q1", "2024-Q1"],
        "grain": ["national", "region", "region"],
        "avg_premium_gbp": [800, 1600, 400],
    })
    out = to_relative_index(panel)
    # national avg taken from the 'national' row (800), not the mean of all rows
    region = out[out["grain"] == "region"]
    assert abs(region["national_avg"].iloc[0] - 800) < 1e-9
    assert abs(region["premium_index"].iloc[0] - 2.0) < 1e-9


def test_feature_buckets_split():
    assert "vehicle_crime_pct" in PLACE_COLS
    assert "young_driver_share_pct" in COMPOSITION_COLS
    assert "cars_per_household_pct" in COMPOSITION_COLS
    assert not set(PLACE_COLS) & set(COMPOSITION_COLS)
