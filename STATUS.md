# Project Status

Last updated: 2026-06-16. Branch: `phase2-anchor-expansion`.

**Phase 2 (anchor expansion):** Scotland is now **validated, not extrapolated** — the
four Confused Scottish regions (Central Scotland, East & North East Scotland,
Highlands & Islands, Scottish Borders) are mapped to postcode-area geography and
enter the panel (matched obs 95→103, areas 23→27; LOAO MAE £108→£99.7; Scottish
anchors fit ~£39 mean abs error, below the £73 overall). A brand-level `source`
column + source fixed-effect path is in place for a future 2nd anchor. Deferred:
MoneySuperMarket/ABI 2nd source (needs real published figures) and Scotland
demographic controls (2011↔2022 Data Zone crosswalk). See `PHASE2_PLAN.md`.

**Model:** premium estimator. The calibrated **expected annual premium (£)** is the headline; the
0–100 `risk_index` is that premium on a percentile scale (one reconciled model). Premium fits on
percentile features (bounds extrapolation); `road_casualties` is excluded from the premium but kept
as a map layer. Scotland is fully priced (crime ingested from statistics.gov.scot). See
`MODEL_REVIEW.md` for the audit and the P0-a/b/c resolution log.

## What's complete

### Data pipeline (all nations)

| Module | Status | Notes |
|--------|--------|-------|
| `src/ingest/boundaries.py` | ✓ Done | 34,753 E+W LSOAs + 6,976 Scotland Data Zones via Esri JSON |
| `src/ingest/imd.py` | ✓ Done | England IoD2019 · Wales WIMD2019 · Scotland SIMD2020v2; within-nation percentile |
| `src/ingest/onspd.py` | ✓ Done | 2.64 M postcodes → `area_code`; postcode-area bug fixed |
| `src/ingest/police_crime.py` | ✓ Done | All E+W forces via S3 bulk download |
| `src/ingest/scotland_crime.py` | ✓ Done | Scotland vehicle crime via statistics.gov.scot SPARQL; council → Data Zone by population |
| `src/ingest/stats19.py` | ✓ Done | All GB collisions; Scotland assigned Data Zone by spatial join |
| `src/transform/aggregate_to_lsoa.py` | ✓ Done | `area_code` key; merges E+W (points) + Scotland (council) crime |
| `src/transform/build_risk_index.py` | ✓ Done | risk_index = premium percentile; £ contributions; within-nation crime ranking |

### Calibration

| Module | Status | Notes |
|--------|--------|-------|
| `src/calibrate/wtw_index.py` | ✓ Done | Loads 137-row WTW panel; name aliases for variant column names |
| `src/calibrate/calibrate.py` | ✓ Done | Relative-index model + place/composition split + ridge CV + LOAO + temporal |

**Results (Phase 1 — relative-index model):** n=95 (23 areas, E+W). Response = log(area premium ÷
national avg). Panel R²=0.909, CV-R²=0.889, LOAO MAE £108, Spearman(pred,actual)=0.974. Place-only
R²=0.87, composition-only R²=0.88 (heavily collinear). Per area: full premium, place-only (demographics
at national mean), composition uplift. New ingest `src/ingest/census_demographics.py` (Census 2021
age + car ownership, E+W; Scotland deferred to Phase 2). Significance: `reports/feature_analysis.md`
(young-driver share strongest independent predictor; density mostly collinear, VIF 13). **Caveat:**
validation holds at postcode-area grain; individual-LSOA predictions are noisier.
**Variance Decomposition:** Place-only R²=0.871, Composition-only R²=0.876 (heavily collinear).
Premium range all GB ≈ £113–£1,687, no nulls. Importance: density ≈0.76, deprivation ≈0.13, crime ≈0.11.

### API

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/health` | ✓ | Liveness probe |
| `GET /api/geojson` | ✓ | Serves gzipped GeoJSON (41,729 features) |
| `GET /api/risk?postcode=` | ✓ | Premium headline + per-driver £ contributions, quintile, risk index |
| `GET /api/rankings` | ✓ | Top-N areas by premium percentile |
| `GET /api/methodology` | ✓ | Feature basis, validation metrics, coefficients, data-driven importances |

All endpoints are NaN-safe; `estimate_premium` returns null (not a partial value) if a feature is missing.

### Frontend

- React + MapLibre GL choropleth over all 41,729 GB small areas
- Postcode search → detail panel with **£ premium as the headline** + per-driver £ contributions
- Filter map by: premium · vehicle crime · collisions · deprivation · density
- Quintile legend + deep-linkable URLs (`?area=<code>&filter=<mode>`)
- Initial view: Great Britain (zoomed out to show all nations)

### Infrastructure

- `Dockerfile` — two-stage build (Node frontend + Python backend)
- `docker-compose.yml` — mounts `./data` and `./reports` as volumes; `docker compose up --build` to run

## Known limitations / caveats

| Issue | Impact |
|-------|--------|
| Premium importance is ~76% population density | The model is largely an urban-density proxy (accepted for a premium estimator, but it's not strongly "crime/claims" driven) |
| Scotland crime is council-grain, disaggregated by population | No within-council variation in the crime feature; Scottish premium also rests on E+W-fit coefficients with no Scottish WTW anchor to validate against |
| WTW panel is quarterly at postcode-area grain (E+W only) | No sub-district calibration; all LSOAs in a postcode area share the same anchor; Scotland not represented in the panel |
| GeoJSON served as single ~15 MB file | Works fine in Docker; for production consider PMTiles (Phase D) |
| Population vintage differs (England mid-2015 vs Wales/Scotland 2011) | Per-capita rates/density slightly off across the border (P1: move to Census 2021/2022) |

## What's deferred

| Item | Phase | Reason |
|------|-------|--------|
| Northern Ireland | D+ | data.police.uk + STATS19 both exclude NI → only 2/4 features |
| PMTiles vector tiles | D | ~42k areas too heavy for a single GeoJSON at scale; needs tippecanoe |
| Sub-district calibration | D+ | WTW panel is postcode-area grain only |
| CI / automated re-ingest | D+ | Data sources update quarterly; no cron yet |

## How to run locally

```bash
# 1. install deps
uv sync

# 2. build data (takes ~20 min first time, downloads ~2 GB)
make ingest && make features && make risk

# 3. start API + frontend
uvicorn src.api.main:app --reload --port 8000
# visit http://localhost:8000

# OR via Docker (no re-ingest needed if data/ already exists)
docker compose up --build
```

## Test suite

```bash
pytest            # 10 tests, all passing
ruff check src    # lint clean
```
