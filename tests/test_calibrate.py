"""Tests for the relative-index calibration pieces."""
import pandas as pd

from src.calibrate.calibrate import (
    COMPOSITION_COLS,
    PLACE_COLS,
    REGION_POSTCODE_AREAS,
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


# Phase 2: Scottish anchor regions are now mapped so Scotland is validated, not
# extrapolation-only. Lock in that the four Confused Scottish regions exist and
# that no postcode area is assigned to two different regions (a clean partition).
SCOTTISH_REGIONS = [
    "Central Scotland",
    "East & North East Scotland",
    "Highlands & Islands",
    "Scottish Borders",
]


def test_scottish_regions_mapped():
    for region in SCOTTISH_REGIONS:
        assert region in REGION_POSTCODE_AREAS, region
        assert REGION_POSTCODE_AREAS[region], f"{region} has no postcode areas"


def test_region_postcode_areas_are_disjoint():
    seen: dict[str, str] = {}
    for region, areas in REGION_POSTCODE_AREAS.items():
        for code in areas:
            assert code not in seen, f"{code} in both {seen.get(code)} and {region}"
            seen[code] = region
