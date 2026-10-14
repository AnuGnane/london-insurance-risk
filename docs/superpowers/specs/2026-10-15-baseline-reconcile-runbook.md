# Runbook: reconcile the waterfall baseline (R-17, needs-mac)

R-7's ruling 2 (PR #22) found two values for the waterfall baseline. `README.md:81`,
`AUDIT.md:33` and `AUDIT.md:46` give **£537**, while the `premium_baseline` baked into
`frontend/public/data/areas.geojson` reads **£541** (the panel shows "Typical GB area £541").
Only a run against the real data can say which is current, and the cloud never guesses a
premium figure. So this runbook is for the Mac, and no cloud commit touches the figures.

The baseline is not a free parameter. `src/transform/build_risk_index.py` computes it as
`national_avg × exp(…)` with every factor at the median percentile (see the waterfall
docstring around line 133), so it moves whenever calibration does.

## On the Mac

From the repo root, with the project venv:

```sh
git fetch origin && git checkout holiday/R-17 && git pull
make calibrate              # re-fits, then re-runs `risk` and `showcase-data` (CLAUDE.md)

# The baseline as baked (it is one value for every area):
python - <<'PY'
import json, collections
fc = json.load(open("frontend/public/data/areas.geojson"))
print(collections.Counter(f["properties"]["premium_baseline"] for f in fc["features"]).most_common(3))
PY
python - <<'PY'
import pandas as pd
df = pd.read_parquet("data/processed/lsoa_risk.parquet")
print(df["premium_baseline"].value_counts().head(3))
PY
```

Then:

1. Set `README.md:81`, `AUDIT.md:33` and `AUDIT.md:46` to that baked figure, each with
   the calibration date (the mtime of `reports/calibration.json`, or its timestamp field
   if it has one).
2. If the figure or any premium changed, the model changed. Follow `CLAUDE.md`'s rules:
   - `make showcase-tiles`, so `frontend/public/data/lsoa-risk.pmtiles` matches the new
     `areas.geojson`. The live map now paints from it first (R-15).
   - Rebuild the Vouched district pack: `../Car Marketplace/vouched/packages/tco-data/build_area_premiums.py`
     with this repo's venv, then `validate_contract.py` there, then Vouched's
     `build_map_meta.py`.
3. Run the gate: `uv run pytest -q` (with `reports/` present, `tests/test_serve_consistency.py`
   runs instead of skipping), `uv run ruff check`, then in `frontend/` `npm ci && npm run lint && npm test && GITHUB_PAGES=1 npm run build`.
   `serveConsistency.test.ts` checks baseline + Σ contributions == premium on the
   re-baked GeoJSON.
4. Commit only `README.md`, `AUDIT.md` and the re-baked `frontend/public/data/*` (never
   `data/` or `reports/`). Push to `holiday/R-17`, tick R-17 in `HOLIDAY.md`, and merge.

If the baked figure is still £541 and nothing else moved, step 2 is not needed: it is a
docs fix only.
