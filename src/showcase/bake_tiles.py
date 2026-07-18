"""Bake the served LSOA GeoJSON into a PMTiles archive for the Vouched map.

Input is the already-baked frontend/public/data/areas.geojson (bake_static runs
first — geometry there is final, make_valid applied last per repo convention).
tippecanoe handles per-zoom simplification; we never re-touch geometry here.
Requires tippecanoe on PATH (`brew install tippecanoe`).
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend" / "public" / "data" / "areas.geojson"
DEST = ROOT / "frontend" / "public" / "data" / "lsoa-risk.pmtiles"
TILES_NAME = "GB insurance risk (LSOA)"


def build_tippecanoe_args(src: Path, dest: Path) -> list[str]:
    return [
        "tippecanoe",
        "-o", str(dest),
        f"--name={TILES_NAME}",
        "--layer=lsoa",
        "--minimum-zoom=4",
        "--maximum-zoom=12",
        "--coalesce-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        "--simplification=10",
        "--force",
        str(src),
    ]


def run(src: Path = SRC, dest: Path = DEST) -> None:
    if not src.exists():
        raise FileNotFoundError(f"{src} missing — run `make showcase-data` first (areas.geojson)")
    if shutil.which("tippecanoe") is None:
        raise RuntimeError("tippecanoe not on PATH — `brew install tippecanoe`")
    subprocess.run(build_tippecanoe_args(src, dest), check=True)
    size_mb = dest.stat().st_size / 1e6
    print(f"wrote {dest} ({size_mb:.1f} MB)")
    if size_mb > 95:
        raise RuntimeError(f"pmtiles {size_mb:.1f} MB exceeds GH Pages 100 MB file limit")


if __name__ == "__main__":
    run()
