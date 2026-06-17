"""Tests for the Phase 4 flood overlay (pure transforms)."""
import geopandas as gpd
from shapely.geometry import box

from src.ingest.flood import _at_risk_extent, flood_area_share

CRS = "EPSG:27700"


def _areas():
    # Two 100m × 100m areas (10,000 m² each), side by side.
    return gpd.GeoDataFrame(
        {"area_code": ["A", "B"]},
        geometry=[box(0, 0, 100, 100), box(200, 0, 300, 100)],
        crs=CRS,
    )


def test_flood_area_share_is_intersection_fraction():
    # Flood covers the left half of A (x 0–50) and nothing in B.
    flood = gpd.GeoDataFrame(geometry=[box(0, 0, 50, 100)], crs=CRS)
    out = flood_area_share(_areas(), flood).set_index("area_code")
    assert abs(out.loc["A", "flood_risk"] - 0.5) < 1e-9
    assert out.loc["B", "flood_risk"] == 0.0


def test_at_risk_extent_keeps_high_and_medium_only():
    flood = gpd.GeoDataFrame(
        {"prob_4band": ["High", "Medium", "Low", "Very Low"]},
        geometry=[box(0, 0, 1, 1)] * 4,
        crs=CRS,
    )
    kept = _at_risk_extent(flood)
    assert sorted(kept["prob_4band"]) == ["High", "Medium"]


def test_at_risk_extent_passthrough_when_no_band_column():
    flood = gpd.GeoDataFrame(geometry=[box(0, 0, 1, 1)], crs=CRS)
    assert len(_at_risk_extent(flood)) == 1
