# GB Car-Insurance Risk Map

Build a composite **territory-risk score** for every small area (LSOA / Data Zone) in Great Britain
from open data, render it as an interactive choropleth, and look it up by postcode — then
**calibrate** the score against the published WTW / Confused.com Car Insurance Price Index so it's
anchored to real market premiums.

This is a **risk proxy**, not a quote engine. See `AGENTS.md` for the coding agent's working
agreement and `implementation_plan.md` for the full design.

## Quickstart
```bash
uv sync            # or: python -m venv .venv && source .venv/bin/activate && pip install -e .
cp .env.example .env
make ingest && make features && make risk     # produces data/processed/lsoa_risk.geojson.gz
```

## Run the map (Docker)
```bash
docker compose up --build
# then open http://localhost:8000
```

The compose file mounts `./data` and `./reports` as volumes so the pre-built data is served
without baking it into the image. No re-ingest needed inside Docker.

## Layout
```
config/config.yaml      weights, years, region code, paths — single source of truth
src/common/             config, io, geo helpers, shared HTTP retry
src/ingest/             one module per data source → data/interim/*.parquet
  boundaries.py         E+W LSOAs + Scotland Data Zones (41,729 areas)
  imd.py                England IoD2019 · Wales WIMD2019 · Scotland SIMD2020v2
  onspd.py              ONSPD postcode → area_code lookup (2.6 M postcodes)
  police_crime.py       data.police.uk bulk download (E+W only; Scotland = NaN)
  stats19.py            DfT STATS19 GB collisions + Scotland spatial join
src/transform/
  aggregate_to_lsoa.py  roll-up to area_code grain; per-row missing-feature handling
  build_risk_index.py   composite index + calibrated premium
src/calibrate/
  wtw_index.py          WTW/Confused.com price panel (137 rows, quarterly)
  calibrate.py          OLS + ridge CV + leave-one-area-out + temporal back-test
src/api/main.py         FastAPI: /api/risk · /api/geojson · /api/rankings
frontend/               React + MapLibre GL choropleth
data/{raw,interim,processed}/   git-ignored — never commit
tests/                  smoke tests (pytest)
```

## Coverage

| Nation | Areas | Crime | Collisions | Deprivation | Calibrated premium |
|--------|------:|:-----:|:----------:|:-----------:|:-----------------:|
| England | 32,844 | ✓ | ✓ | IoD 2019 | ✓ |
| Wales | 1,909 | ✓ | ✓ | WIMD 2019 | ✓ |
| Scotland | 6,976 | — (NaN) | ✓ | SIMD 2020v2 | partial* |

\* Scotland areas have a risk index but `calibrated_premium` may be null where the vehicle-crime
feature is absent and the calibration intercept doesn't cover all postcode areas.

## Data sources & licences

Deprivation is incomparable across nations by construction, so each area is ranked **within its
own nation** (percentile 0–1) before combining. Scotland's vehicle-crime feature is absent (NaN)
and the index reweights over the remaining three features per row.

- **Vehicle crime (E+W only)** — https://data.police.uk/  (Open Government Licence).
  No Scottish/NI coverage; the feature is NaN there and the index reweights automatically.
- **Road collisions (STATS19, GB)** — https://www.data.gov.uk/dataset/cb7ae6f0-4be6-4935-9277-47e5ce24a11f/road-accidents-safety-data
  (OGL). Scotland's LSOA field is blank in STATS19, so Scottish collisions are assigned a
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

## Calibration results (Phase C)

Panel OLS with quarter fixed-effects, area-clustered SEs, ridge CV, leave-one-area-out, and
temporal back-test against the WTW index (94 matched obs / 22 postcode areas):

| Metric | Value |
|--------|------:|
| Panel R² | 0.917 |
| CV-R² (ridge, 5-fold) | 0.890 |
| Leave-one-area-out MAE | £113 |
| Temporal hold-out MAE | £149 |
| Spearman rank | 0.757 |

## What's deferred

- **Northern Ireland** — data.police.uk and STATS19 both exclude NI, so an NI area would carry
  only 2 of 4 features. NI is deferred to a later phase.
- **PMTiles frontend** — serving ~42k areas as a vector tileset rather than a single GeoJSON
  (currently ~15 MB gzipped) is Phase D, not yet implemented.
