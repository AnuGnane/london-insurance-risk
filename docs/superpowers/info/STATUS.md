# Project Status

Last updated: 2026-07-18. Branch: `docs-finalize-transparency`.

**2026-07 model wave — COMPLETE (Phase 4 flood + uncertainty bands + IMD sub-domains + Vouched bridge).**
One evidence-gate calibrate cycle tested three candidates against the n=106 anchor panel
(`reports/feature_analysis.md`, 4 calibrate runs). Outcomes:
- **`imd_crime` KEPT — and it replaced overall `deprivation`** (mirroring how AADF replaced
  density in Phase 3). Partial r +0.43, p=3.8e-6, VIF 3.5 — the strongest place driver.
  With it present, overall deprivation's partial collapses to +0.03 (p=0.78, VIF 2.4 — no
  collinearity excuse, simply no unique signal): the crime sub-domain IS the deprivation
  component that prices car risk. Deprivation stays a map diagnostic.
- **`flood_risk` EXCLUDED for car premiums** — wrong-signed (univariate r=−0.94: flood
  exposure tracks rurality, and rural is cheap to insure; partial p=0.18, VIF 22.7). All
  three nations ingested (England Defra-SFTP RoFRS 83 GDB tiles, Wales NRW WFS, Scotland
  SEPA ArcGIS) and shipped as a within-nation-ranked **map diagnostic**. A star candidate
  for the home-insurance line (roadmap 2.10) — this gate outcome is the evidence.
- **`imd_income` EXCLUDED** — redundant with the deprivation family (VIF 33, wrong-signed
  partial).
- **`aadf_intensity` kept on a LOAO head-to-head** (dropping it worsens out-of-sample MAE
  £76.51→£82.54) despite a marginal p=0.063 next to imd_crime — documented in config.
- **Uncertainty bands live**: 200-rep cluster bootstrap + LOAO residual-variance widening
  (bootstrap median width £241 → honest widened width **£373**); `premium_low/high` ship
  in the processed parquet, the served GeoJSON and the map's hero range.
- **Serve-consistency guard earned its keep**: it caught that `bake_static.py` hardcoded
  the driver list (imd_crime props missing from the served map) and that `premium_low/high`
  had never been baked into served props. Both fixed; driver/diagnostic props now derive
  from config.
- **Coverage prerequisites shipped**: Wales WIMD income + community-safety domain ranks
  (WIMD's crime analogue) — including migrating the whole Wales fetch to the official
  `data_WG` ArcGIS org after the previously hardcoded org was found decommissioned (the
  old `_wales()` was silently broken); Scotland income + crime domain ranks from the
  official SG "SIMD 2020v2 – ranks" workbook (the NHS CSV never carried domain columns —
  the earlier "SIMD crime domain" extraction had been a silent no-op).
- **Headline fit: R²=0.9304, LOAO MAE £76.51 (was £88.77), temporal backtest £69.76,
  Spearman 0.974, n=106; premium span £186–£1,578.** Place = vehicle_crime, aadf_intensity,
  imd_crime; composition unchanged.
- **Vouched bridge formalized + refreshed**: `area-premiums.json` regenerated from this
  model (2,773 districts, 100% live-postcode coverage, LONDON_BASE £806) with provenance
  stamps (`model_commit`, calibration date, n, R²) per the integrator-approved §3.1
  amendment; `validate_contract.py` enforces them and warns on staleness. Refresh rule:
  every model-changing ship here ⇒ regenerate the Vouched pack (see CLAUDE.md).
See `docs/superpowers/specs/2026-07-17-vouched-synergy-and-next-wave-design.md` and
`docs/superpowers/plans/2026-07-18-wave1-2-model-wave-and-vouched-bridge.md`.

**Transparency & verification — COMPLETE (2026-06-21, PR #9).** The premium is now fully
explainable per area: an exact, order-invariant **LMDI waterfall** bridges from a typical-GB-area
baseline (£537) to each estimate via signed per-factor £ steps (`baseline + Σ steps == premium`).
Driver percentiles ship at 1 dp so the served premium is exactly reproducible from the static data
(`tests/test_serve_consistency.py` guards baseline, reproducibility, exact reconciliation and signs).
Model verification written up in `AUDIT.md`; rankings confirmed not UI-desynced. See
`docs/superpowers/specs/2026-06-21-transparency-polish-finalize-design.md`.

**Phase 2 (anchor expansion) — COMPLETE.** Three things landed (see `PHASE2_PLAN.md`):
1. **Scotland validated, not extrapolated** — the four Confused Scottish regions are
   mapped to postcode-area geography and enter the panel (matched obs 95→106, areas
   23→30 incl. MSM).
2. **MoneySuperMarket second source** — real published broad-region figures (London
   £817, Scotland £451, Wales £407, April 2026) pooled with a source fixed effect +
   a cross-source agreement check (the Confused-trained model predicts MSM's
   Scotland nearly exactly). `to_relative_index` normalises per source×quarter.
3. **Scotland demographic controls** — Census 2022 ingested on **2011 Data Zones**
   (UK Data Service UV103 age + UV405 cars; no crosswalk needed). Scotland
   composition coverage 0%→99.9%; Scotland is now priced full place + composition
   like E+W (no longer place-only). Demographic merge overall 81%→97%.
Current fit: R²=0.909, CV-R²=0.876, LOAO MAE £104, Spearman 0.967.

**Phase 3 (traffic exposure + collision revisit) — COMPLETE.**
- **v1** (LA traffic / residents + KSI-per-vehicle-mile) was evidence-gated to **map
  diagnostics**: KSI has no independent signal (partial p≈0.44) and LA-traffic/resident
  is an inverse-density proxy (r≈−0.92, VIF≈16, wrong-signed).
- **v2 — the win:** point-level **AADF traffic intensity** (`src/ingest/aadf.py`: mean
  AADF of DfT count points within 2 km of each centroid) is a genuine premium driver
  (partial r +0.38, p<1e-4, VIF 2.3) and **replaced population density** (always a
  collinear urban-intensity proxy, VIF 13–60). With AADF in, every premium feature is an
  independent significant keeper (VIF 2–6); LOAO MAE £104→**£89**, R² 0.909→**0.917**,
  MSM cross-source Spearman 0.50→**1.00**. Density/traffic-per-capita/KSI/road_casualties
  remain diagnostics. ONSPD now derives `local_authority_code` at the DfT highway-
  authority grain. See `PHASE3_PLAN.md`.

**Phase 4 (flood risk) — COMPLETE (2026-07-18).** All three nations ingested and the
evidence gate ruled: **diagnostic, not driver** (wrong-signed for car premiums — see the
2026-07 wave summary above). Sources: England EA RoFRS via Defra SFTP (83 local GDB
tiles, 326k features, runbook in `DATA_PROVENANCE_AND_TRANSFORMS.md`), Wales NRW
rivers+sea via DataMapWales WFS, Scotland SEPA river+coastal via ArcGIS REST. Within-
nation percentile ranking (regulator bandings differ); `flood_risk` = share of area in a
High/Medium zone, dissolved to prevent double-counting.

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
| `src/ingest/traffic.py` | ◐ Started | DfT local-authority traffic volume → small-area exposure (Phase 3) |
| `src/transform/aggregate_to_lsoa.py` | ✓ Done | `area_code` key; merges E+W (points) + Scotland (council) crime |
| `src/transform/build_risk_index.py` | ✓ Done | risk_index = premium percentile; £ contributions; within-nation crime ranking; Phase 3 fields flow through when present |

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
- Postcode search → detail panel with **£ premium as the headline** + a **premium waterfall**
  (baseline → signed per-factor £ steps → estimate) that reconciles to the pound
- Filter map by: premium · vehicle crime · collisions · deprivation · density
- Quintile legend + deep-linkable URLs (`?area=<code>&filter=<mode>`)
- Initial view: Great Britain (zoomed out to show all nations)

### Infrastructure

- `Dockerfile` — two-stage build (Node frontend + Python backend)
- `docker-compose.yml` — mounts `./data` and `./reports` as volumes; `docker compose up --build` to run

## Known limitations / caveats

| Issue | Impact |
|-------|--------|
| Premium is weighted toward urban-intensity signals (AADF traffic + deprivation) | Phase 3 replaced raw population density with point-level AADF (independent, VIF 2.3), but the model still reads more "where it's busy/deprived" than "crime/claims" |
| Scotland crime is council-grain, disaggregated by population | No within-council variation in the crime feature, even though Scottish regions now validate at anchor grain |
| WTW/MSM panel is quarterly at postcode-area/region grain | No sub-district calibration; all LSOA-level values remain modelled predictions |
| Traffic exposure is point-level AADF within 2 km of each centroid | Genuine driver (partial r +0.38), but ~10% of areas fall back to the nearest count point where local coverage is sparse |
| GeoJSON served as single ~15 MB file | Works fine in Docker; for production consider PMTiles (Phase D) |
| Population vintage differs (England mid-2015 vs Wales/Scotland 2011) | Per-capita rates/density slightly off across the border (P1: move to Census 2021/2022) |

## What's deferred

| Item | Phase | Reason |
|------|-------|--------|
| Northern Ireland | D+ | data.police.uk + STATS19 both exclude NI → only 2/4 features |
| Flood overlay | 4 | EA/NRW/SEPA polygon overlay after traffic/collision revisit |
| PMTiles vector tiles | D | ~42k areas too heavy for a single GeoJSON at scale; needs tippecanoe |
| Sub-district calibration | D+ | WTW panel is postcode-area grain only |
| CI / automated re-ingest | D+ | Data sources update quarterly; no cron yet |

## How to run locally

```bash
# 1. install deps
uv sync

# 2. build data (takes ~20+ min first time, downloads multiple GB)
make ingest && make features && make risk

# 3. start API + frontend
uvicorn src.api.main:app --reload --port 8000
# visit http://localhost:8000

# OR via Docker (no re-ingest needed if data/ already exists)
docker compose up --build
```

## Test suite

```bash
UV_CACHE_DIR=.uv-cache uv run pytest
ruff check src    # lint clean
```
