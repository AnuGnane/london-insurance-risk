# Phase 3 Implementation Plan — Traffic Exposure + Collision Revisit

> Status: **COMPLETE.** v1 (LA-grain traffic + KSI) gated out as diagnostics; v2
> (point-level AADF intensity) became a premium driver and replaced population
> density. Follows `NEXT_PHASE_DESIGN.md` §3 and §6.

## Phase 3 v2 — point-level AADF intensity (the rescue)

v1's traffic feature failed because LA-traffic / residents is an inverse-density
proxy. v2 measures **local road-traffic intensity** instead: the mean AADF (all
motor vehicles) of DfT count points within 2 km of each area's centroid
(`src/ingest/aadf.py`; count points and boundaries are both EPSG:27700, so it's a
straight KD-tree radius query; 90% of areas have ≥1 point within 2 km, the rest use
the nearest point). This separates "how busy are the roads near you" from "how many
people live here" — the distinction v1 couldn't make.

**Result — AADF is a genuine signal, and it replaced raw density:**

| | partial r | partial p | VIF | verdict |
|---|---|---|---|---|
| `aadf_intensity` (added) | +0.38 | 7e-05 | 2.3 | ✅ keep |

Adding AADF flipped `population_density` to a wrong sign at VIF 60 — they're
collinear urban-intensity proxies and AADF is the better-behaved one. **Dropping
density and keeping AADF** makes *every* premium feature an independent significant
keeper (all VIF 2–6), and is the cleanest the model has been:

| Metric | Before AADF | With AADF (density dropped) |
|---|---|---|
| Panel R² | 0.909 | **0.917** |
| CV-R² | 0.876 | **0.887** |
| Leave-one-area-out MAE | £104 | **£89** |
| Spearman(pred, actual) | 0.967 | 0.968 |
| MSM cross-source Spearman | 0.50 | **1.00** |
| Feature VIFs | density 13–60 | all 2–6 |

This directly answers the long-standing "the model is just an urban-density proxy"
critique: density is now a **map diagnostic** (still baked via `risk_index.weights`),
and the premium is driven by crime + deprivation + **direct traffic intensity** +
demographic controls. Config: `aadf_intensity` in `features.place`,
`population_density`/`traffic_per_capita`/KSI as diagnostics. Test: `tests/test_aadf.py`.

---

## Phase 3 v1 (LA-grain traffic + KSI) — gated out as diagnostics

## Outcome (the evidence gate fired)

Both Phase 3 candidates were ingested, percentile-ranked, and fed to calibration as
`features.place` candidates. `reports/feature_analysis.md` then **gated both out of
the premium model** — they are retained as **map diagnostics** (like the legacy
`road_casualties`), not premium drivers:

| Candidate | Univariate r | Partial r | Partial p | VIF | Verdict |
|---|---|---|---|---|---|
| `ksi_collisions_per_billion_vehicle_miles` | +0.68 | +0.08 | **0.44** | 4.8 | ⚠️ no independent signal |
| `traffic_per_capita` | **−0.92** | −0.26 | 0.007 | **16.2** | ⚠️ inverse-density proxy, wrong-signed |

- **KSI rate** adds nothing once crime/deprivation/density are controlled (p≈0.44).
- **traffic_per_capita** is *negatively* correlated with premium: high traffic per
  resident = rural through-roads/motorways (cheap), low = dense urban (dear). At
  LA/resident grain it's an inverse-density proxy, collinear with `population_density`
  (VIF 16), and wrong-signed for a "risk driver". This is the exact resident-
  denominator distortion the plan set out to test for — and it failed the test.

Decision (per the plan's evidence gate): keep both as ingested + mapped diagnostics;
the premium model stays on the 3 clean place features + 2 composition controls
(R²=0.909, LOAO £104). Separating genuine exposure from density needs **point-level
AADF** (deferred). Config: `features.diagnostics` (new) vs `features.place`.

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
| `src/ingest/onspd.py` | ✅ Done | Derives `local_authority_code` = the DfT **highway authority** (county E10 for two-tier shire areas, else unitary/met/London/Scottish-council). Fixes the original `oslaua` assumption (ONSPD now uses `cty25cd`/`lad25cd`). 100% populated, 207 authorities. |
| `src/ingest/traffic.py` | ✅ Done | Discovers the DfT CSV, caches under `data/raw/traffic`, writes `traffic.parquet` (41,237 areas). Fixed: join on the ONS `local_authority_code`, not DfT's internal `local_authority_id`. |
| `src/transform/aggregate_to_lsoa.py` | ✅ Done | Merges traffic and computes KSI per billion vehicle miles (count/yr ÷ million-veh-miles × 1000). |
| `config/config.yaml` | ✅ Done | `traffic_years`, DfT source URL; traffic + KSI moved from `features.place` to a new `features.diagnostics` after the evidence gate. |
| API/frontend component lists | ✅ Done | Traffic + KSI appear as GeoJSON click details and map filters (diagnostics); AboutPanel states they don't drive the premium. Not shown as £ premium contributions. |
| Tests | ✅ Done | `test_traffic.py` (discover/normalise/lookup/allocate) + `test_compute_ksi_collision_rate_per_billion_vehicle_miles`. 30 pass. |

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
