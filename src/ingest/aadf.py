"""Ingest point-level DfT AADF traffic intensity near each small area (Phase 3 v2).

Phase 3 v1 used local-authority traffic / residents, which turned out to be an
inverse-density proxy (rural through-roads score highest) and was gated out of the
premium. This module measures **local road-traffic intensity** instead: the mean
Annual Average Daily Flow (AADF, all motor vehicles) of DfT count points within a
radius of each area's centroid. That separates "how busy are the roads where you
live" from "how many people live here" — the signal v1 couldn't isolate.

Source : DfT Road traffic statistics — count-point AADF
         https://roadtraffic.dft.gov.uk/downloads (dft_traffic_counts_aadf.zip, OGL v3.0)
Grain  : count point (lat/long + easting/northing) → nearest small-area centroid.
Out    : data/interim/aadf.parquet
         columns: area_code, aadf_intensity, aadf_points_within, aadf_nearest_m
Vintage: mean over config.data_years.traffic_years (latest available per point).

Note: DfT counts only a subset of points each year (the rest are modelled), so we
pool the configured years and take each count point's mean AADF for coverage. Both
the count points (easting/northing) and the boundaries are in EPSG:27700, so the
radius search is a straight metric KD-tree query — no reprojection needed.
"""
from __future__ import annotations

import io
import logging
import zipfile

import geopandas as gpd
import pandas as pd
from scipy.spatial import cKDTree

from src.common.config import settings
from src.common.http import get_with_retry
from src.common.io import interim, raw, write_parquet

log = logging.getLogger(__name__)

AADF_URL = (
    "https://storage.googleapis.com/dft-statistics/road-traffic/downloads/"
    "data-gov-uk/dft_traffic_counts_aadf.zip"
)
# Radius around each area centroid within which count points inform its traffic
# intensity. ~22k GB count points ≈ 3 km mean spacing, so 2 km captures the local
# road network in towns/cities; rural areas with none fall back to the nearest point.
AADF_RADIUS_M = 2000.0


def aadf_per_point(raw_df: pd.DataFrame, years: list[int]) -> pd.DataFrame:
    """Mean all-motor-vehicle AADF per count point over the configured years.

    Pure function. Keeps the point's easting/northing (EPSG:27700) for the spatial
    join and drops points without coordinates or a flow value.
    """
    df = raw_df.copy()
    if years:
        df = df[df["year"].isin(years)]
    df = df.dropna(subset=["easting", "northing", "all_motor_vehicles"])
    out = (
        df.groupby("count_point_id", as_index=False)
        .agg(
            easting=("easting", "mean"),
            northing=("northing", "mean"),
            aadf=("all_motor_vehicles", "mean"),
        )
    )
    return out


def area_centroids(boundaries: gpd.GeoDataFrame) -> pd.DataFrame:
    """Population-agnostic geometric centroid (easting/northing) per area. Pure-ish."""
    cent = boundaries.geometry.centroid
    return pd.DataFrame(
        {
            "area_code": boundaries["area_code"].values,
            "cx": cent.x.values,
            "cy": cent.y.values,
        }
    )


def nearest_aadf(
    centroids: pd.DataFrame, points: pd.DataFrame, radius_m: float
) -> pd.DataFrame:
    """Mean AADF of count points within ``radius_m`` of each area centroid.

    Pure function. Areas with no point in range fall back to their single nearest
    count point (so coverage is complete); ``aadf_points_within`` records how many
    points informed the estimate (0 = nearest-point fallback) and ``aadf_nearest_m``
    the distance to the closest point.
    """
    pts_xy = points[["easting", "northing"]].to_numpy()
    cent_xy = centroids[["cx", "cy"]].to_numpy()
    aadf = points["aadf"].to_numpy()
    tree = cKDTree(pts_xy)

    within = tree.query_ball_point(cent_xy, r=radius_m)
    nearest_d, nearest_i = tree.query(cent_xy, k=1)

    intensity, n_within = [], []
    for ids, ni in zip(within, nearest_i):
        if ids:
            intensity.append(float(aadf[ids].mean()))
            n_within.append(len(ids))
        else:
            intensity.append(float(aadf[ni]))
            n_within.append(0)
    return pd.DataFrame(
        {
            "area_code": centroids["area_code"].values,
            "aadf_intensity": intensity,
            "aadf_points_within": n_within,
            "aadf_nearest_m": nearest_d.round(0),
        }
    )


def _download_aadf() -> pd.DataFrame:
    """Fetch/cache the DfT count-point AADF zip and read its CSV."""
    cache_dir = raw("traffic")
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / "dft_traffic_counts_aadf.zip"
    if not zip_path.exists():
        url = settings["sources"].get("road_traffic_aadf", AADF_URL)
        log.info("Downloading DfT count-point AADF from %s", url)
        zip_path.write_bytes(get_with_retry(url, timeout=300).content)
    with zipfile.ZipFile(zip_path) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(name) as f:
            return pd.read_csv(io.BytesIO(f.read()), low_memory=False)


def run() -> None:
    log.info("Ingesting point-level DfT AADF traffic intensity")
    years = settings["data_years"].get("traffic_years", [])
    points = aadf_per_point(_download_aadf(), years)
    log.info("AADF count points (pooled over %s): %d", years, len(points))

    boundaries = gpd.read_parquet(interim("area_boundaries.parquet"))
    centroids = area_centroids(boundaries)
    out = nearest_aadf(centroids, points, AADF_RADIUS_M)

    covered = (out["aadf_points_within"] > 0).mean()
    log.info(
        "AADF intensity for %d areas | %.0f%% have ≥1 count point within %.0fm "
        "| intensity median=%.0f",
        len(out), covered * 100, AADF_RADIUS_M, out["aadf_intensity"].median(),
    )
    write_parquet(out, interim("aadf.parquet"))
    log.info("Wrote %s", interim("aadf.parquet"))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
