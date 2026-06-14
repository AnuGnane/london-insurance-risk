"""Smoke tests that run without any downloaded data."""
from src.common.config import load_config
from src.common.geo import postcode_area, postcode_district
from src.transform.build_risk_index import composite, normalise
import pandas as pd


def test_config_loads():
    cfg = load_config()
    assert cfg["geography"]["region_code"] == "E12000007"
    assert abs(sum(cfg["risk_index"]["weights"].values()) - 1.0) < 1e-6


def test_postcode_helpers():
    assert postcode_area("EN1 4QR") == "EN"
    assert postcode_district("en1 4qr") == "EN1"


def test_normalise_percentile_bounds():
    s = pd.Series([1, 2, 3, 4])
    out = normalise(s, "percentile")
    assert out.min() > 0 and out.max() == 100


def test_composite_runs():
    feats = pd.DataFrame({
        "vehicle_crime": [1, 5, 9],
        "road_casualties": [2, 4, 8],
        "deprivation": [3, 6, 9],
        "vehicle_density": [1, 2, 3],
        "population_density": [4, 5, 6],
    })
    weights = load_config()["risk_index"]["weights"]
    score = composite(feats, weights)
    assert len(score) == 3 and score.is_monotonic_increasing
