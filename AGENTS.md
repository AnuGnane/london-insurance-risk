# AGENTS.md — working agreement for AI coding agents

You are building the London car-insurance risk map described in `PLAN.md`. Read `PLAN.md` first, then this.

## Golden rules
1. **Never commit data.** Everything under `data/` is git-ignored. Ingest scripts download into `data/raw`.
2. **Respect source terms.** police.uk is rate-limited — throttle and cache responses; do not hammer it.
   Document every source's licence in `README.md` if you add one.
3. **No quote scraping.** Do not add code that automates Compare the Market / MoneySuperMarket / Confused /
   GoCompare quote journeys. Out of scope by design (see PLAN §why this scope).
4. **One spatial vintage.** Default LSOA = 2011 (matches IMD 2019). If you bridge to 2021, use the official
   ONS lookup and say so in code comments.
5. **Config over constants.** Years, weights, region code, paths, normalisation method all live in
   `config/config.yaml` and are read via `src/common/config.py`. Don't hard-code them in modules.

## How to run
```bash
uv sync                 # or: pip install -e .
make ingest             # M1  -> data/interim/*.parquet
make features           # M2  -> data/interim/lsoa_features.parquet
make risk               # M3  -> data/processed/lsoa_risk.{parquet,geojson}
make calibrate          # M4  -> reports/calibration.md + fitted weights
make api                # M5  -> FastAPI on :8000 (after form factor chosen)
make test
```

## Definition of done (per module)
- Pure, testable functions; side effects (download / write) isolated in `main()` or `run()`.
- Reads inputs from the path conventions in `src/common/io.py`; writes Parquet (+ GeoJSON where geographic).
- Has at least one smoke test in `tests/`.
- Docstring states: source URL, grain in, grain out, and any vintage assumption.

## Code conventions
- Python 3.11+, type hints, `ruff` clean, ~88 col.
- Geometry in **EPSG:27700** (British National Grid) for area/length maths; reproject to **EPSG:4326** only
  for GeoJSON output / the map.
- Prefer `duckdb` for big tabular joins; `geopandas` for spatial joins.
- Log with `logging`, not `print`.

## Build order
Follow milestones M1 → M6 in `PLAN.md`. Don't start the API/map (M5) until the risk + calibration outputs
(M3/M4) exist and the form factor is confirmed.

## Imported Claude Cowork project instructions
