"""Tests for the Phase 4 flood overlay (pure transforms)."""
import geopandas as gpd
from shapely.geometry import box

from src.ingest.flood import (
    _at_risk_extent,
    _sepa_query_url,
    _wfs_page_params,
    flood_area_share,
    flood_shares_by_nation,
)

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


def test_flood_area_share_does_not_double_count_overlaps():
    # High and Medium layers overlap exactly (High ⊂ Medium, as SEPA publishes
    # them) — the union still covers only the left half of A.
    flood = gpd.GeoDataFrame(
        geometry=[box(0, 0, 50, 100), box(0, 0, 50, 100)], crs=CRS
    )
    out = flood_area_share(_areas(), flood).set_index("area_code")
    assert abs(out.loc["A", "flood_risk"] - 0.5) < 1e-9


def _areas_two_nations():
    return gpd.GeoDataFrame(
        {"area_code": ["A", "B"], "nation": ["scotland", "england"]},
        geometry=[box(0, 0, 100, 100), box(200, 0, 300, 100)],
        crs=CRS,
    )


def test_flood_shares_by_nation_skips_nations_without_extents():
    # Only Scotland has extent data: England must contribute NO row (NaN after
    # the aggregate merge) — not a silent 0.0.
    extents = {"scotland": gpd.GeoDataFrame(geometry=[box(0, 0, 50, 100)], crs=CRS)}
    out = flood_shares_by_nation(_areas_two_nations(), extents)
    assert list(out["area_code"]) == ["A"]
    assert abs(out.set_index("area_code").loc["A", "flood_risk"] - 0.5) < 1e-9


def test_flood_shares_by_nation_empty_extents():
    out = flood_shares_by_nation(_areas_two_nations(), {})
    assert list(out.columns) == ["area_code", "flood_risk"]
    assert len(out) == 0


def test_sepa_query_url_builds_service_and_layer():
    url = _sepa_query_url("https://example/rest/Open", "River_Flooding_High_Likelihood", 1)
    assert url == "https://example/rest/Open/River_Flooding_High_Likelihood/FeatureServer/1/query"


def test_wfs_page_params():
    p = _wfs_page_params("inspire-nrw:X", start=5000, count=5000)
    assert p["typeNames"] == "inspire-nrw:X"
    assert p["startIndex"] == 5000 and p["count"] == 5000
    assert p["outputFormat"] == "application/json"
    assert p["srsName"] == "EPSG:27700"
