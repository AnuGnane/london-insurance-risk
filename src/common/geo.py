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
    """'EN1 4QR' -> 'EN'. The grain the WTW index publishes at."""
    return "".join(c for c in postcode.upper().strip() if c.isalpha())[:2].rstrip()


def postcode_district(postcode: str) -> str:
    """'EN1 4QR' -> 'EN1' (the outward code)."""
    return postcode.upper().strip().split(" ")[0]
