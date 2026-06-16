# GB Car-Insurance Risk Map

Estimate an **expected annual motor-insurance premium** for every small area (LSOA / Data Zone) in
Great Britain from open data, render it as an interactive choropleth, and look it up by postcode. The
premium is **calibrated** against the published WTW / Confused.com Car Insurance Price Index, and the
0–100 "risk index" is simply that premium on a percentile scale — one reconciled model, not two.

This is a **territorial risk proxy**, not a quote engine: it uses no individual driver or vehicle
details. See `AGENTS.md` for the coding agent's working agreement, `MODEL_REVIEW.md` for the model
audit + design decisions, and `implementation_plan.md` for the original design.

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
| England | 32,844 | ✓ data.police.uk | ✓ | IoD 2019 | ✓ |
| Wales | 1,909 | ✓ data.police.uk | ✓ | WIMD 2019 | ✓ |
| Scotland | 6,976 | ✓ Recorded Crime in Scotland † | ✓ | SIMD 2020v2 | ✓ |

† Scotland publishes vehicle crime only at council grain; it's disaggregated to Data Zone by
population and ranked **within Scotland** (the E+W and Scottish crime measures aren't comparable on
an absolute scale). All 41,729 GB areas now carry a calibrated premium — there are no null premiums.

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
- **Vehicle crime (Scotland)** — "Recorded Crime in Scotland" (Theft of/from a motor vehicle) by
  council area, https://statistics.gov.scot/data/recorded-crime (OGL), queried over SPARQL and
  disaggregated to Data Zone by population.
- **Price index (calibration anchor)** — https://www.confused.com/car-insurance/price-index
  (WTW/Confused.com; transcribed quarterly figures, cited per row in the panel).

> Contains public sector information licensed under the Open Government Licence v3.0.

## Calibration results

The premium is fit on **percentile-normalised** features (which bounds per-LSOA extrapolation — see
MODEL_REVIEW.md §3.2), via panel OLS with quarter fixed-effects, area-clustered SEs, ridge CV,
leave-one-area-out, and a temporal back-test against the WTW index (94 matched obs / 22 areas, E+W).
`road_casualties` is excluded from the premium (insignificant + wrong-signed at panel grain) but
stays an ingested, displayed map layer.

| Metric | Value |
|--------|------:|
| Panel R² | 0.889 |
| CV-R² (ridge, 5-fold) | 0.872 |
| Leave-one-area-out MAE | £112 |
| Spearman (predicted vs actual premium) | 0.892 |
| Premium range (all GB) | ~£113 – £1,687 |

Feature importance (standardised): population density ≈ 0.76, deprivation ≈ 0.13, vehicle crime ≈
0.11 — the premium is, by construction, heavily an urban-density signal.

## What's deferred

- **Northern Ireland** — data.police.uk and STATS19 both exclude NI, so an NI area would carry
  only 2 of 4 features. NI is deferred to a later phase.
- **PMTiles frontend** — serving ~42k areas as a vector tileset rather than a single GeoJSON
  (currently ~15 MB gzipped) is Phase D, not yet implemented.
