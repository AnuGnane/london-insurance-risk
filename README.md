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
  scotland_crime.py     Recorded Crime in Scotland council data → Data Zone
  stats19.py            DfT STATS19 GB collisions + Scotland spatial join
  census_demographics.py  Census age + car ownership controls
  traffic.py            DfT local-authority traffic exposure (Phase 3 v1, diagnostic)
  aadf.py               DfT point-level AADF traffic intensity → centroid (Phase 3 v2, premium driver)
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
own nation** (percentile 0–1) before combining. Scotland's vehicle-crime data comes from a
different council-grain source, so vehicle crime is also ranked within source-comparable groups.

- **Vehicle crime (E+W)** — https://data.police.uk/  (Open Government Licence).
  data.police.uk has no Scottish/NI coverage.
- **Vehicle crime (Scotland)** — "Recorded Crime in Scotland" (Theft of/from a motor vehicle) by
  council area, https://statistics.gov.scot/data/recorded-crime (OGL), queried over SPARQL and
  disaggregated to Data Zone by population.
- **Road collisions (STATS19, GB)** — https://www.data.gov.uk/dataset/cb7ae6f0-4be6-4935-9277-47e5ce24a11f/road-accidents-safety-data
  (OGL). Scotland's LSOA field is blank in STATS19, so Scottish collisions are assigned a
  Data Zone by spatial join.
- **Traffic exposure (Phase 3)** — DfT Road traffic statistics https://roadtraffic.dft.gov.uk/downloads
  (OGL). v1 local-authority traffic / residents is a diagnostic; **v2 point-level AADF** (count-point
  Annual Average Daily Flow, `dft_traffic_counts_aadf.zip`) is averaged within 2 km of each area
  centroid and is the premium's traffic-intensity driver.
- **Deprivation** — England IoD2019 https://www.gov.uk/government/statistics/english-indices-of-deprivation-2019 ·
  Wales WIMD 2019 https://www.gov.wales/welsh-index-multiple-deprivation-full-index-update-ranks-2019 ·
  Scotland SIMD 2020v2 https://www.gov.scot/collections/scottish-index-of-multiple-deprivation-2020/
  (all OGL). SIMD ranks via NHS Scotland open data.
- **Boundaries** — E+W LSOAs + ONSPD https://geoportal.statistics.gov.uk/ ·
  Scotland Data Zones 2011 https://spatialdata.gov.scot/ (gov.scot, OGL).
- **Population** — England (IoD2019 mid-2015) · Scotland (Data Zone totpop2011) ·
  Wales (2011 Census KS101EW via NOMIS https://www.nomisweb.co.uk/).
- **Demographic controls** — E+W Census 2021 age/car availability via Nomis; Scotland Census 2022
  UV103/UV405 on 2011 Data Zones via UK Data Service CSV (OGL-compatible public statistics).
- **Price index (calibration anchor)** — https://www.confused.com/car-insurance/price-index
  (WTW/Confused.com; transcribed quarterly figures, cited per row in the panel) plus
  MoneySuperMarket published regional figures for London, Scotland and Wales (April 2026).

> Contains public sector information licensed under the Open Government Licence v3.0.

## Calibration results

The model predicts a **relative territorial index** — `log(area premium ÷ national average)` — on
**percentile** features (which bounds per-LSOA extrapolation, see MODEL_REVIEW.md §3.2), via panel OLS
with area-clustered SEs, ridge CV, leave-one-area-out, and a temporal back-test against the WTW index
(106 matched obs / 30 areas — including four Scottish regions and three MoneySuperMarket broad
regions; Phase 2). It separates **place** drivers (vehicle crime, deprivation, **traffic intensity**)
from **demographic-composition controls** (young-driver share, cars/household) so the place effect is
estimated *net of who lives there* (NEXT_PHASE_DESIGN.md §2). Phase 3 replaced raw population density
with **point-level AADF traffic intensity** (mean Annual Average Daily Flow of DfT count points within
2 km of each area) — a direct measure of local road business that, unlike density, is an independent
significant predictor. LA-traffic-per-resident, KSI-per-vehicle-mile, `road_casualties` and
`population_density` are retained as **map diagnostics**, not premium drivers (see `PHASE3_PLAN.md`).

| Metric | Value |
|--------|------:|
| Panel R² (log-index) | 0.917 |
| CV-R² (ridge, 5-fold) | 0.887 |
| Leave-one-area-out MAE | £89 |
| Spearman (predicted vs actual premium) | 0.968 |
| Spatial multiplier (WC London ÷ Rugby) | ≈ 1.9× |
| Matched anchor obs / areas | 106 / 30 (incl. MSM) |
| Feature VIFs (all premium features) | 2–6 (no collinearity) |

`reports/feature_analysis.md` reports per-feature partial correlation, VIF and a keep/drop verdict.
Headline finding: **young-driver share is the strongest independent predictor** (partial r +0.57),
followed by **traffic intensity** (+0.38). Replacing population density (always a collinear urban-
intensity proxy, VIF 13–60) with point-level AADF resolved the long-standing "it's just a density
model" critique — **every premium feature is now an independent significant keeper** (VIF 2–6). Per
area we expose three numbers: full premium, **place-only** (at national-average demographics), and the
**composition uplift**.

> **Grain caveat:** validation holds at postcode-area grain. At individual-LSOA grain predictions are
> noisier — e.g. wealthy-but-central LSOAs can be under-priced because deprivation (a dominant clean
> signal) is low there while real premiums are driven by factors not yet modelled (vehicle value,
> congestion, claims cost — Phases 3–4).

## Current and deferred work

- **Phase 3 done** — point-level **AADF traffic intensity** is now a premium driver and replaced
  population density (LOAO MAE £104→£89; all features VIF 2–6). LA-traffic-per-resident and the
  KSI-per-vehicle-mile rate were evidence-gated to **map diagnostics**. See `PHASE3_PLAN.md`.
- **Phase 4 started** — flood risk. Ingest scaffold (`src/ingest/flood.py`), areal-overlay
  transform and plumbing are in place; `flood_risk` activates as a place candidate once the
  EA/NRW/SEPA High+Medium extents are dropped under `data/raw/flood/`. See `PHASE4_PLAN.md`.

- **Northern Ireland** — data.police.uk and STATS19 both exclude NI, so an NI area would carry
  only 2 of 4 features. NI is deferred to a later phase.
- **PMTiles frontend** — serving ~42k areas as a vector tileset rather than a single GeoJSON
  (currently ~15 MB gzipped) is Phase D, not yet implemented.
