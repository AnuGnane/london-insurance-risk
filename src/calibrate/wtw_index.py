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
Seed a couple of rows here, then top up from the latest quarterly release at
settings['sources']['wtw_index'].
"""
from __future__ import annotations

import csv
import logging

from src.common.io import WTW_ANCHORS, interim

log = logging.getLogger(__name__)

# Seed rows — REPLACE/EXTEND from the latest published index before relying on these.
SEED = [
    # area_label, grain, postcode_area, avg_premium_gbp, index_period
    ("West Central London", "postcode_area", "WC", 1350, "2026-Q1"),
    ("Inner London", "region", None, 1093, "2026-Q1"),
    ("Outer London", "region", None, 900, "2026-Q1"),
]


def run() -> None:
    dest = interim(WTW_ANCHORS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["area_label", "grain", "postcode_area", "avg_premium_gbp", "index_period"])
        w.writerows(SEED)
    log.info("Wrote %s seed anchor rows to %s", len(SEED), dest)
    log.warning("These are SEED values — refresh from the latest WTW/Confused index.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
