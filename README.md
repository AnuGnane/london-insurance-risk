# London Car-Insurance Risk Map

Build a composite **territory-risk score** for every LSOA in London from open data, render it as an
interactive choropleth, and look it up by postcode — then **calibrate** the score against the published
WTW / Confused.com Car Insurance Price Index so it's anchored to real market premiums.

This is a **risk proxy**, not a quote engine. See `PLAN.md` for the full design and `AGENTS.md` for the
coding agent's working agreement.

## Quickstart
```bash
uv sync            # or: python -m venv .venv && source .venv/bin/activate && pip install -e .
cp .env.example .env
make ingest && make features && make risk     # produces data/processed/lsoa_risk.geojson
```

## Layout
```
config/config.yaml      weights, years, region code, normalisation — single source of truth
src/common/             config, io paths, geo helpers
src/ingest/             one module per data source -> data/interim/*.parquet
src/transform/          aggregate_to_lsoa, build_risk_index
src/calibrate/          wtw_index ingest + regression calibration
src/api/                FastAPI (Phase 5)
src/viz/                MapLibre map stub (Phase 5)
data/{raw,interim,processed}/   git-ignored
tests/                  smoke tests
```

## Data sources & licences (fill in licence column as you wire each up)
- **Crime** — https://data.police.uk/  (Open Government Licence)
- **Road collisions (STATS19)** — https://www.data.gov.uk/dataset/cb7ae6f0-4be6-4935-9277-47e5ce24a11f/road-accidents-safety-data
- **Deprivation (IMD 2019)** — https://www.gov.uk/government/statistics/english-indices-of-deprivation-2019
- **Boundaries + ONSPD** — https://geoportal.statistics.gov.uk/
- **Price index (calibration anchor)** — https://www.confused.com/car-insurance/price-index
- **Vehicle licensing (optional)** — DfT table VEH0125

> Contains public sector information licensed under the Open Government Licence v3.0.
