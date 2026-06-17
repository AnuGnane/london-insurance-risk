"""Tests for the point-level AADF ingest (pure transforms)."""
import pandas as pd

from src.ingest.aadf import aadf_per_point, nearest_aadf


def test_aadf_per_point_averages_selected_years_and_drops_bad_rows():
    raw = pd.DataFrame({
        "count_point_id": [1, 1, 1, 2, 2],
        "year": [2021, 2022, 2019, 2021, 2021],
        "easting": [100.0, 100.0, 100.0, 500.0, None],   # last row has no coords
        "northing": [200.0, 200.0, 200.0, 600.0, 600.0],
        "all_motor_vehicles": [100.0, 200.0, 999.0, 50.0, 70.0],
    })
    out = aadf_per_point(raw, years=[2021, 2022]).set_index("count_point_id")
    # CP1: mean of 2021+2022 (the 2019 row is filtered out) = 150
    assert abs(out.loc[1, "aadf"] - 150.0) < 1e-9
    assert abs(out.loc[1, "easting"] - 100.0) < 1e-9
    # CP2: the coordinate-less row is dropped, leaving the single valid 50
    assert abs(out.loc[2, "aadf"] - 50.0) < 1e-9


def test_nearest_aadf_means_within_radius_and_falls_back_to_nearest():
    points = pd.DataFrame({
        "easting": [0.0, 1000.0],
        "northing": [0.0, 0.0],
        "aadf": [100.0, 200.0],
    })
    centroids = pd.DataFrame({
        "area_code": ["A", "B"],
        "cx": [100.0, 5000.0],   # A near both points; B far from both
        "cy": [0.0, 0.0],
    })
    out = nearest_aadf(centroids, points, radius_m=2000.0).set_index("area_code")
    # A: both points within 2km -> mean(100, 200) = 150, n=2
    assert abs(out.loc["A", "aadf_intensity"] - 150.0) < 1e-9
    assert out.loc["A", "aadf_points_within"] == 2
    # B: none within 2km -> nearest point (1000,0) aadf 200, n=0, distance 4000
    assert abs(out.loc["B", "aadf_intensity"] - 200.0) < 1e-9
    assert out.loc["B", "aadf_points_within"] == 0
    assert abs(out.loc["B", "aadf_nearest_m"] - 4000.0) < 1e-9
