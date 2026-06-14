"""M4b: calibrate the risk index against real published premiums.

In  : data/processed/lsoa_risk.parquet  (+ features)
      data/interim/wtw_anchors.csv
      postcode_lookup.parquet  (for LSOA -> postcode_area roll-up)
Out : reports/calibration.md  (+ optional fitted weights for build_risk_index)

Steps:
  1. Roll LSOA features up to postcode_area (mean), join to WTW avg premium.
  2. Fit interpretable regression premium ~ features (OLS / Ridge).
     Report coefficients, signs, R². Sanity check: crime ↑ -> premium ↑ etc.
  3. (Optional) derive back-fit weights from standardised coefficients; write
     them out so M3 can re-score with market-aligned weights.
  4. Be explicit in the report: WTW's London grain is coarse, so this is a
     directional sanity check + weight aid, NOT a per-LSOA price model.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def run() -> None:
    log.info("Calibrating risk index against WTW anchors")
    raise NotImplementedError("Roll up to postcode area, join WTW, fit regression, report.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
