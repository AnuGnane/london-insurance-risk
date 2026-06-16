"""Geometry helpers: CRS handling and postcode normalisation."""
from __future__ import annotations

from typing import TYPE_CHECKING

from src.common.config import settings

if TYPE_CHECKING:  # avoid importing geopandas (GDAL) just to use the string helpers
    import geopandas as gpd

WORKING_CRS = settings["project"]["crs_working"]   # EPSG:27700
DISPLAY_CRS = settings["project"]["crs_display"]    # EPSG:4326


def to_working(gdf: "gpd.GeoDataFrame") -> "gpd.GeoDataFrame":
    """Reproject to British National Grid for area/length maths."""
    return gdf.to_crs(WORKING_CRS)


def postcode_area(postcode: str) -> str:
    """'EN1 4QR' -> 'EN', 'L1 8JQ' -> 'L'. The grain the WTW index publishes at.

    The postcode area is the leading letters of the OUTWARD code (before the
    first digit) — taking all alpha chars of the whole postcode breaks
    single-letter areas like 'L'/'M'/'E' (the inward code adds stray letters).
    """
    outward = postcode.upper().strip().split(" ")[0]
    area = ""
    for ch in outward:
        if ch.isalpha():
            area += ch
        else:
            break
    return area


def postcode_district(postcode: str) -> str:
    """'EN1 4QR' -> 'EN1' (the outward code)."""
    return postcode.upper().strip().split(" ")[0]
