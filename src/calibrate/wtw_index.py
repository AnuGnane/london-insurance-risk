"""M4a: load the WTW/Confused.com Car Insurance Price Index anchor panel.

Primary source is the manually-built multi-quarter panel at
config calibration.panel_csv (137 rows, 10 quarters, grains: national / region /
postcode_area / town). The old hand-typed SEED is kept as a fallback only.

Out : data/interim/wtw_anchors.csv
      columns: area_name, grain, postcode_area, quarter, avg_premium_gbp,
               source_type
"""
from __future__ import annotations

import logging

import pandas as pd

from src.common.config import ROOT, settings
from src.common.io import WTW_ANCHORS, interim

log = logging.getLogger(__name__)

# Fallback only — used if the panel CSV is missing. (area_name, grain,
# postcode_area, avg_premium_gbp, quarter)
SEED = [
    ("West Central London", "postcode_area", "WC", 1350, "2026-Q1"),
    ("Inner London", "region", None, 1093, "2026-Q1"),
    ("Outer London", "region", None, 900, "2026-Q1"),
    ("East Central London", "postcode_area", "EC", 1280, "2026-Q1"),
]

# Normalise published area-name variants to one canonical label per geography so
# the same place across quarters joins together (see wtw_anchors_notes.md).
NAME_ALIASES = {
    "London - Outer": "Outer London",
    "Leeds and Sheffield": "Leeds / Sheffield",
    "Midlands - West": "West Midlands",
    "London City": "Central London",
}


def _from_panel() -> pd.DataFrame | None:
    csv = ROOT / settings["calibration"]["panel_csv"]  # panel_csv is repo-relative
    if not csv.exists():
        log.warning("Panel CSV %s not found — falling back to SEED", csv)
        return None
    df = pd.read_csv(csv)
    df["area_name"] = df["area_name"].replace(NAME_ALIASES)
    keep = ["area_name", "grain", "postcode_area", "quarter", "avg_premium_gbp"]
    if "source_type" in df.columns:
        keep.append("source_type")
    log.info("Loaded %d panel rows across %d quarters",
             len(df), df["quarter"].nunique())
    return df[keep]


def run() -> None:
    df = _from_panel()
    if df is None:
        df = pd.DataFrame(
            SEED, columns=["area_name", "grain", "postcode_area", "avg_premium_gbp", "quarter"]
        )
        log.warning("Wrote %d SEED anchor rows — refresh the panel CSV", len(df))

    dest = interim(WTW_ANCHORS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(dest, index=False)
    log.info("Wrote %d WTW anchor rows to %s", len(df), dest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
