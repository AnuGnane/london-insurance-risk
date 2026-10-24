"""Bake the outcode → small-area fallback table the postcode search uses when
postcodes.io does not answer.

Source : data/interim/postcode_lookup.parquet (src.ingest.onspd, from ONSPD)
Grain  : one row per postcode in → one entry per outcode (postcode_district) out
Out    : frontend/public/data/outcodes.json, {"<outcode>": "<lsoa11cd>"}, keys sorted
Vintage: the lookup's lsoa11cd (2011 LSOA / Scottish Data Zone), the map's vintage.

Each outcode maps to the small area of its postcode nearest the outcode's mean
lat/long, so every value is a real area from the lookup. The outcode is the
lookup's own postcode_district, passed once more through postcode_district: the
ingest cut it from pcd7, which writes seven-character postcodes without a space,
so a lookup built before that fix carries "AB101AA" where it means AB10. Nearest is measured on lat and
cos(lat)-scaled long: good enough to rank points inside one outcode, and it needs
no geopandas.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from src.common.geo import postcode_district
from src.common.io import interim

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
SRC = interim("postcode_lookup.parquet")
DEST = ROOT / "frontend" / "public" / "data" / "outcodes.json"
COLUMNS = ["postcode_district", "lsoa11cd", "lat", "long"]


def build_outcode_table(df: pd.DataFrame) -> dict[str, str]:
    """Map each outcode to the area of the postcode nearest its mean position.

    Rows without an outcode, an area or a position are dropped first. Ties go to
    the smaller area code, so the table is the same at every bake.
    """
    d = df[COLUMNS].dropna().copy()
    d["postcode_district"] = d["postcode_district"].map(postcode_district)
    centre = d.groupby("postcode_district")[["lat", "long"]].transform("mean")
    dy = d["lat"] - centre["lat"]
    dx = (d["long"] - centre["long"]) * np.cos(np.radians(centre["lat"]))
    # Rounded so float noise cannot break a true tie before the code does.
    d["dist"] = (dx**2 + dy**2).round(12)
    best = d.sort_values(["postcode_district", "dist", "lsoa11cd"]).drop_duplicates(
        "postcode_district"
    )
    return dict(sorted(zip(best["postcode_district"], best["lsoa11cd"])))


def run(src: Path = SRC, dest: Path = DEST) -> None:
    if not src.exists():
        raise FileNotFoundError(
            f"{src} missing — run the ONSPD ingest first (postcode_lookup.parquet)"
        )
    table = build_outcode_table(pd.read_parquet(src, columns=COLUMNS))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(table, separators=(",", ":")) + "\n")
    log.info("wrote %s (%d outcodes, %.0f KB)", dest, len(table), dest.stat().st_size / 1e3)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
