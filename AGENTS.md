# AGENTS.md — working agreement for AI coding agents

You are building a UK/GB car-insurance risk model - read the README.md for more context.

## Golden rules
1. **Never commit data.** Everything under `data/` is git-ignored. Ingest scripts download into `data/raw`.
2. **Respect source terms.** police.uk is rate-limited — throttle and cache responses; do not hammer it.
   Document every source's licence in `README.md` if you add one.
3. **One spatial vintage.** Default LSOA = 2011 (matches IMD 2019). If you bridge to 2021, use the official
   ONS lookup and say so in code comments.
4. **Config over constants.** Years, weights, region code, paths, normalisation method all live in
   `config/config.yaml` and are read via `src/common/config.py`. Don't hard-code them in modules.
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
