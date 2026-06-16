# Project Status

Last updated: 2026-06-16. Branch: `uk-expansion` (PR #1 open against `main`).

## What's complete

### Data pipeline (all nations)

| Module | Status | Notes |
|--------|--------|-------|
| `src/ingest/boundaries.py` | ✓ Done | 34,753 E+W LSOAs + 6,976 Scotland Data Zones via Esri JSON |
| `src/ingest/imd.py` | ✓ Done | England IoD2019 · Wales WIMD2019 · Scotland SIMD2020v2; within-nation percentile |
| `src/ingest/onspd.py` | ✓ Done | 2.64 M postcodes → `area_code`; postcode-area bug fixed |
| `src/ingest/police_crime.py` | ✓ Done | All E+W forces via S3 bulk download; Scotland = NaN by design |
| `src/ingest/stats19.py` | ✓ Done | All GB collisions; Scotland assigned Data Zone by spatial join |
| `src/transform/aggregate_to_lsoa.py` | ✓ Done | Per-row missing-feature handling; `area_code` key |
| `src/transform/build_risk_index.py` | ✓ Done | Missing-feature reweighting in `composite()`; bakes calibrated premium |

### Calibration

| Module | Status | Notes |
|--------|--------|-------|
| `src/calibrate/wtw_index.py` | ✓ Done | Loads 137-row WTW panel; name aliases for variant column names |
| `src/calibrate/calibrate.py` | ✓ Done | OLS + quarter FE + ridge CV + LOAO + temporal back-test + Spearman |

**Results:** n=94, Panel R²=0.917, CV-R²=0.890, LOAO MAE £113, temporal MAE £149, Spearman 0.757.

### API

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/health` | ✓ | Liveness probe |
| `GET /api/geojson` | ✓ | Serves gzipped GeoJSON (41,729 features) |
| `GET /api/risk?postcode=` | ✓ | Full breakdown incl. components, quintile, calibrated premium |
| `GET /api/rankings` | ✓ | Top-N areas by risk index |
| `GET /api/methodology` | ✓ | Weights, normalisation, calibration coefficients |

All endpoints are NaN-safe (Scotland's null `vehicle_crime` serialises as `null` not NaN).

### Frontend

- React + MapLibre GL choropleth over all 41,729 GB small areas
- Postcode search → LSOA/Data Zone detail panel
- Filter by: composite risk · vehicle crime · collisions · deprivation · density
- Quintile legend + per-area risk driver breakdown
- Deep-linkable URLs (`?area=<code>&filter=<mode>`)
- Initial view: Great Britain (zoomed out to show all nations)

### Infrastructure

- `Dockerfile` — two-stage build (Node frontend + Python backend)
- `docker-compose.yml` — mounts `./data` and `./reports` as volumes; `docker compose up --build` to run

## Known limitations / caveats

| Issue | Impact |
|-------|--------|
| Scotland `vehicle_crime` = NaN | Risk index present but reweighted (3 features); `calibrated_premium` may be null for some Scottish postcodes |
| `road_casualties` coefficient p≈0.45 | Statistically insignificant at postcode-area grain; still included per design |
| WTW panel is quarterly at postcode-area grain | No sub-district calibration; all LSOAs in a postcode area share the same anchor |
| GeoJSON served as single 15 MB file | Works fine in Docker; for production consider PMTiles (Phase D) |

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
