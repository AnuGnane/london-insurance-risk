"""Tests for aggregate_to_lsoa pure helpers."""
import pandas as pd

from src.transform.aggregate_to_lsoa import merge_demographics


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
