"""Tests for the shared Esri JSON geometry helpers."""
import geopandas as gpd

from src.common.esri import esri_features_to_gdf, esri_rings_to_geom

# Esri convention: clockwise = exterior, counter-clockwise = hole.
SQUARE_CW = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]
HOLE_CCW = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]


def test_esri_rings_to_geom_square_with_hole():
    geom = esri_rings_to_geom([SQUARE_CW, HOLE_CCW])
    assert abs(geom.area - (100 - 36)) < 1e-9


def test_esri_features_to_gdf_reads_pages_and_crs():
    page = {
        "spatialReference": {"wkid": 27700},
        "features": [
            {"geometry": {"rings": [SQUARE_CW]}},
            {"geometry": {"rings": []}},          # empty geometry → skipped
            {"attributes": {"x": 1}},              # no geometry → skipped
        ],
    }
    gdf = esri_features_to_gdf([page, page])
    assert isinstance(gdf, gpd.GeoDataFrame)
    assert len(gdf) == 2                            # one polygon per page
    assert gdf.crs.to_epsg() == 27700
