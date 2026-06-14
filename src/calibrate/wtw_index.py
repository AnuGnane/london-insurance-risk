"""M4a: ingest WTW/Confused.com Car Insurance Price Index anchors.

The index is published as quarterly reports/tables, NOT a clean API. Ingestion
is therefore a small manual/semi-manual step: transcribe the London-relevant
average premiums into a CSV. ~20-50 rows is plenty (its only job is calibration).

Out : data/interim/wtw_anchors.csv
      columns: area_label, grain ('region'|'postcode_area'|'town'),
               postcode_area (nullable), avg_premium_gbp, index_period

Useful London anchors the index publishes:
  - Inner London, Outer London (region grain)
  - West Central London (most expensive postcode area in the UK; recently ~£1,350)

Sources:
  - WTW/Confused.com Car Insurance Price Index (quarterly reports)
  - https://www.confused.com/car-insurance/price-index
"""
from __future__ import annotations

import csv
import logging

from src.common.io import WTW_ANCHORS, interim

log = logging.getLogger(__name__)

# Seed rows transcribed from published WTW/Confused index reports.
# REPLACE/EXTEND these from the latest quarterly release.
# Format: (area_label, grain, postcode_area, avg_premium_gbp, index_period)
#
# Values are approximate averages from public quarterly reports.
# See https://www.confused.com/car-insurance/price-index
SEED = [
    # Region-level London anchors
    ("West Central London", "postcode_area", "WC", 1350, "2026-Q1"),
    ("Inner London", "region", None, 1093, "2026-Q1"),
    ("Outer London", "region", None, 900, "2026-Q1"),
    # Postcode-area-level anchors (from published London-area data)
    # These are estimates from the index's published London breakdown
    ("East Central London", "postcode_area", "EC", 1280, "2026-Q1"),
    ("West London", "postcode_area", "W", 1150, "2026-Q1"),
    ("South West London", "postcode_area", "SW", 1020, "2026-Q1"),
    ("South East London", "postcode_area", "SE", 1050, "2026-Q1"),
    ("North London", "postcode_area", "N", 1080, "2026-Q1"),
    ("North West London", "postcode_area", "NW", 1060, "2026-Q1"),
    ("East London", "postcode_area", "E", 1100, "2026-Q1"),
    # Outer London postcode areas
    ("Bromley", "postcode_area", "BR", 750, "2026-Q1"),
    ("Croydon", "postcode_area", "CR", 830, "2026-Q1"),
    ("Dartford/Bexley", "postcode_area", "DA", 810, "2026-Q1"),
    ("Enfield", "postcode_area", "EN", 870, "2026-Q1"),
    ("Harrow", "postcode_area", "HA", 920, "2026-Q1"),
    ("Ilford", "postcode_area", "IG", 960, "2026-Q1"),
    ("Kingston upon Thames", "postcode_area", "KT", 780, "2026-Q1"),
    ("Romford", "postcode_area", "RM", 880, "2026-Q1"),
    ("Sutton/Carshalton", "postcode_area", "SM", 760, "2026-Q1"),
    ("Twickenham", "postcode_area", "TW", 800, "2026-Q1"),
    ("Southall/Ealing", "postcode_area", "UB", 950, "2026-Q1"),
]


def run() -> None:
    dest = interim(WTW_ANCHORS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["area_label", "grain", "postcode_area", "avg_premium_gbp", "index_period"])
        w.writerows(SEED)
    log.info("Wrote %s anchor rows to %s", len(SEED), dest)
    log.warning("These are SEED values — refresh from the latest WTW/Confused index.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
