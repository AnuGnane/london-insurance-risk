"""Tests for aggregate_to_lsoa pure helpers."""
import pandas as pd

from src.transform.aggregate_to_lsoa import (
    compute_ksi_collision_rate,
    merge_demographics,
)


def test_merge_demographics_adds_columns_and_nans_unmatched():
    feats = pd.DataFrame({"area_code": ["E01000001", "E01000002"], "vehicle_crime": [1.0, 2.0]})
    demo = pd.DataFrame({
        "area_code": ["E01000001"],
        "young_driver_share": [0.12],
        "cars_per_household": [1.3],
    })
    out = merge_demographics(feats, demo)
    assert {"young_driver_share", "cars_per_household"}.issubset(out.columns)
    # matched row keeps its values
    matched = out[out["area_code"] == "E01000001"].iloc[0]
    assert abs(matched["young_driver_share"] - 0.12) < 1e-9
    # unmatched 2011-only area is left NaN (the index reweights / holds at mean)
    unmatched = out[out["area_code"] == "E01000002"].iloc[0]
    assert pd.isna(unmatched["young_driver_share"])
    # row count is preserved (left merge)
    assert len(out) == 2


def test_compute_ksi_collision_rate_per_billion_vehicle_miles():
    # Area A: 2 fatal + 2 serious + 1 slight (slight ignored) = 4 KSI over 2 years
    #   => 2 KSI/yr; 10 million vehicle miles => 2/10*1000 = 200 per billion v-miles.
    # Area B: no KSI => rate 0.
    collisions = pd.DataFrame({
        "area_code": ["A", "A", "A", "A", "A"],
        "severity_label": ["fatal", "fatal", "serious", "serious", "slight"],
    })
    traffic = pd.DataFrame({
        "area_code": ["A", "B"],
        "traffic_million_vehicle_miles": [10.0, 5.0],
    })
    out = compute_ksi_collision_rate(collisions, traffic, years=[2021, 2022]).set_index("area_code")
    assert out.loc["A", "ksi_collision_count"] == 4
    assert abs(out.loc["A", "ksi_collisions_per_billion_vehicle_miles"] - 200.0) < 1e-9
    # area with no KSI collisions resolves to a 0 rate, not NaN
    assert out.loc["B", "ksi_collisions_per_billion_vehicle_miles"] == 0.0
