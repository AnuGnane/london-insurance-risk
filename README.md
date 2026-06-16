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

## Data sources & licences

The model covers **Great Britain** (England, Wales, Scotland). Northern Ireland is
deferred — data.police.uk and STATS19 both exclude NI, so an NI area would carry
only 2 of 4 features. Deprivation is incomparable across nations by construction,
so each area is ranked **within its own nation** (percentile) before combining.

- **Vehicle crime (E+W only)** — https://data.police.uk/  (Open Government Licence).
  No Scottish/NI coverage; the feature is NaN there and the index reweights.
- **Road collisions (STATS19, GB)** — https://www.data.gov.uk/dataset/cb7ae6f0-4be6-4935-9277-47e5ce24a11f/road-accidents-safety-data
  (OGL). Scotland's LSOA field is blank, so Scottish collisions are assigned a
  Data Zone by spatial join.
- **Deprivation** — England IoD2019 https://www.gov.uk/government/statistics/english-indices-of-deprivation-2019 ·
  Wales WIMD 2019 https://www.gov.wales/welsh-index-multiple-deprivation-full-index-update-ranks-2019 ·
  Scotland SIMD 2020v2 https://www.gov.scot/collections/scottish-index-of-multiple-deprivation-2020/
  (all OGL). SIMD ranks via NHS Scotland open data.
- **Boundaries** — E+W LSOAs + ONSPD https://geoportal.statistics.gov.uk/ ·
  Scotland Data Zones 2011 https://spatialdata.gov.scot/ (gov.scot, OGL).
- **Population** — England (IoD2019 mid-2015) · Scotland (Data Zone totpop2011) ·
  Wales (2011 Census KS101EW via NOMIS https://www.nomisweb.co.uk/).
- **Price index (calibration anchor)** — https://www.confused.com/car-insurance/price-index
  (WTW/Confused.com; transcribed quarterly figures, cited per row in the panel).

> Contains public sector information licensed under the Open Government Licence v3.0.
