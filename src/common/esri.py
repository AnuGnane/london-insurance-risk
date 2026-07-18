"""Shared Esri JSON geometry helpers.

`esri_rings_to_geom` is the arcgis2geojson winding-order algorithm vendored to
avoid an extra dependency (moved here from src/ingest/boundaries.py so flood.py
can reuse it). `fetch_arcgis_polygons` is the geometry-carrying sibling of
src/common/http.py:fetch_arcgis_attributes.
"""
from __future__ import annotations

import logging
import time

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon

from src.common.http import get_json_with_retry

log = logging.getLogger(__name__)


def _ring_is_clockwise(ring: list[list[float]]) -> bool:
    """Esri convention: clockwise rings are exteriors, counter-clockwise are holes."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += (x2 - x1) * (y2 + y1)
    return s > 0


def esri_rings_to_geom(rings: list[list[list[float]]]):
    """Convert an Esri polygon ``rings`` array to a shapely (Multi)Polygon.

    Esri packs all exterior rings and holes into one flat list; we split by
    winding order and assign each hole to the exterior that contains it. This is
    what arcgis2geojson does — vendored here to avoid an extra dependency and
    because the gov.scot geojson endpoint mis-serialises multi-island zones.
    """
    exteriors = [r for r in rings if len(r) >= 4 and _ring_is_clockwise(r)]
    holes = [r for r in rings if len(r) >= 4 and not _ring_is_clockwise(r)]
    if not exteriors:  # all CCW — treat each as its own polygon
        exteriors, holes = rings, []

    ext_polys = [Polygon(r) for r in exteriors]
    hole_assignment: list[list] = [[] for _ in ext_polys]
    if holes and ext_polys:
        from shapely import STRtree
        tree = STRtree(ext_polys)
        for h in holes:
            rep = Polygon(h).representative_point()
            for i in tree.query(rep):
                if ext_polys[i].contains(rep):
                    hole_assignment[i].append(h)
                    break

    polys = [Polygon(ext, hl) for ext, hl in zip(exteriors, hole_assignment)]
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def esri_features_to_gdf(pages: list[dict]) -> gpd.GeoDataFrame:
    """Esri JSON query pages → GeoDataFrame of polygons (pure).

    Features without polygon rings are skipped. CRS comes from the first page's
    spatialReference (defaults to EPSG:27700, this project's working CRS).
    """
    geoms = [
        esri_rings_to_geom(feat["geometry"]["rings"])
        for page in pages
        for feat in page.get("features", [])
        if feat.get("geometry", {}).get("rings")
    ]
    wkid = (pages[0].get("spatialReference") or {}).get("wkid", 27700) if pages else 27700
    return gpd.GeoDataFrame(geometry=geoms, crs=f"EPSG:{wkid}")


def fetch_arcgis_polygons(query_url: str, *, page_size: int = 2000) -> gpd.GeoDataFrame:
    """Page through an ArcGIS query endpoint returning polygon geometry.

    ``page_size`` must be <= the endpoint's maxRecordCount, or a capped first
    page looks like the final page (same caveat as fetch_arcgis_attributes).
    If a page query fails (e.g. ArcGIS 500 error due to complex geometry reprojection),
    falls back to fetching by Object IDs with simplification fallback.
    """
    pages, offset = [], 0
    while True:
        try:
            page = get_json_with_retry(query_url, {
                "where": "1=1", "outFields": "", "returnGeometry": "true",
                "outSR": 27700, "f": "json",
                "resultOffset": offset, "resultRecordCount": page_size,
            })
            n = len(page.get("features", []))
            if n:
                pages.append(page)
            offset += n
            if n < page_size and not page.get("exceededTransferLimit"):
                break
            time.sleep(0.3)
        except Exception as exc:
            log.warning("Page query failed at offset %d (%s); falling back to per-ObjectID fetch", offset, exc)
            try:
                ids_page = get_json_with_retry(query_url, {
                    "where": "1=1", "returnIdsOnly": "true", "f": "json",
                })
                oids = ids_page.get("objectIds", [])[offset:]
            except Exception as ids_exc:
                log.error("Failed to fetch Object IDs during fallback: %s", ids_exc)
                raise exc from ids_exc

            log.info("Falling back to fetching %d Object IDs in batches/individually", len(oids))
            batch_size = 50
            for i in range(0, len(oids), batch_size):
                batch = oids[i:i + batch_size]
                try:
                    p = get_json_with_retry(query_url, {
                        "objectIds": ",".join(map(str, batch)), "returnGeometry": "true",
                        "outSR": 27700, "f": "json",
                    })
                    if p.get("features"):
                        pages.append(p)
                except Exception as batch_exc:
                    log.warning("Batch of %d Object IDs failed (%s); retrying individually", len(batch), batch_exc)
                    for oid in batch:
                        try:
                            p = get_json_with_retry(query_url, {
                                "objectIds": str(oid), "returnGeometry": "true",
                                "outSR": 27700, "f": "json",
                            })
                            if p.get("features"):
                                pages.append(p)
                        except Exception as exc_oid:
                            log.warning("ObjectID %s failed (%s); retrying with maxAllowableOffset=1", oid, exc_oid)
                            p = get_json_with_retry(query_url, {
                                "objectIds": str(oid), "returnGeometry": "true",
                                "outSR": 27700, "maxAllowableOffset": 1, "f": "json",
                            })
                            if p.get("features"):
                                pages.append(p)
                        time.sleep(0.1)
                time.sleep(0.2)
            break
    return esri_features_to_gdf(pages)
