# Phase 3 Implementation Plan — Traffic Exposure + Collision Revisit

> Status: **in progress**. This phase starts after Phase 2 anchor expansion
> (`phase2-anchor-expansion`) and follows `NEXT_PHASE_DESIGN.md` §3 and §6.

**Goal:** add a defensible traffic exposure denominator and re-test collisions as
a premium driver. The old `road_casualties` resident-denominator feature stays as
a map diagnostic; fatal/serious collisions only re-enter the premium model if the
calibration report shows independent signal.

---

## Scope

Phase 3 is deliberately backend-first:

1. Ingest DfT Road traffic statistics at local-authority grain.
2. Allocate local-authority vehicle miles to LSOA/Data Zone by population share.
3. Derive `ksi_collisions_per_billion_vehicle_miles` from STATS19 fatal/serious
   collisions and the traffic exposure denominator.
4. Add `traffic_per_capita` and the KSI rate as `features.place` candidates.
5. Re-run calibration and let `reports/feature_analysis.md` decide whether the
   collision feature is a keeper or weak/collinear.

This phase does **not** implement point-level count-point AADF yet. DfT cautions
that road-link and small-area estimates are less robust than regional and
local-authority totals, so the first version uses the more stable LA aggregate.

## Data Source

- **DfT Road traffic statistics** — https://roadtraffic.dft.gov.uk/downloads
  (Open Government Licence v3.0). The local-authority download covers annual
  traffic volume by vehicle class; Phase 3 uses all motor vehicles, averaged over
  `config.data_years.traffic_years`.
- **DfT STATS19 collisions** — already ingested by `src/ingest/stats19.py`.
  Phase 3 filters to fatal/serious collisions for the traffic-denominator rate.

## Implementation

| Component | Status | Notes |
|-----------|--------|-------|
| `src/ingest/onspd.py` | Started | Keeps `local_authority_code` from ONSPD so areas can be assigned to authorities. |
| `src/ingest/traffic.py` | Started | Discovers the DfT CSV from the downloads page, caches it under `data/raw/traffic`, and writes `data/interim/traffic.parquet`. |
| `src/transform/aggregate_to_lsoa.py` | Started | Merges traffic exposure when present and computes KSI collisions per billion vehicle miles. |
| `config/config.yaml` | Started | Adds `traffic_years`, the DfT traffic source URL, and Phase 3 place features. |
| API/frontend component lists | Started | New fields can appear in `/api/risk`, GeoJSON click details, and map filters after data is rebuilt. |

## Acceptance Criteria

- `make ingest && make features && make risk && make calibrate` runs without
  committing anything under `data/`.
- `reports/feature_analysis.md` includes `traffic_per_capita` and
  `ksi_collisions_per_billion_vehicle_miles` with partial correlation, p-value,
  VIF, and keep/weak verdict.
- README and STATUS state that Phase 3 traffic is in progress and that collision
  premium inclusion is evidence-gated.
- Smoke tests cover the pure traffic and KSI-rate transforms.

## Deferred

- Point-level AADF spatial join / radius-to-centroid exposure.
- Road-network length denominator.
- Flood risk overlay (Phase 4).
