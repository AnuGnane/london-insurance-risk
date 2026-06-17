# Phase 4 Implementation Plan — Flood Risk

> Status: **started** (scaffold + plan). Follows `NEXT_PHASE_DESIGN.md` §3 and §6.
> This is the largest data lift in the project: national flood extents are big
> geospatial layers and there are three separate regulators.

**Goal:** add a per-area **flood-risk exposure** feature and let the calibration
evidence gate (`reports/feature_analysis.md`) decide whether it's a premium driver
or a diagnostic — exactly as Phase 3 did for traffic/KSI.

---

## Feature definition

`flood_risk` = **share of each LSOA/Data Zone's land area in a High-or-Medium flood
risk zone** (rivers + sea), 0–1, then percentile-ranked **within nation** (the three
sources are not comparable on an absolute scale — same pattern as deprivation and
vehicle crime). Areal overlay (intersection area ÷ area_km2) is the cleanest,
boundary-vintage-robust metric and reuses the EPSG:27700 geometries already loaded.

## Sources (within-nation, like deprivation/crime)

| Nation | Source | Access | Licence |
|---|---|---|---|
| England | EA **Risk of Flooding from Rivers and Sea (RoFRS)** — 50 m cells, 4 risk bands | environment.data.gov.uk (dataset `96ab4342-…`); downloadable extent + WMS/feature service | OGL v3.0 |
| Wales | NRW **Flood Risk Assessment Wales (FRAW)** rivers/sea | NRW DataMap Wales / Lle | OGL |
| Scotland | SEPA **Flood Maps** (river/coastal, High/Med/Low return periods) | www2.sepa.scot/flooddata + spatialdata.gov.scot (ESRI REST / WMS) | OGL v3.0 |

High = ≥1/30 (3.3%) annual chance; Medium = 1/30–1/100. We take **High+Medium** as
the "at risk" mask (matches EA's public banding and the SEPA High/Medium scenarios).

## Why it's heavy (and the chosen approach)

The national RoFRS is hundreds of MB as a raster/polygon at 50 m. Overlaying it
against ~42k areas is the expensive step. Two viable routes:

1. **Areal overlay (preferred for the model):** download each nation's flood-extent
   polygons (or a dissolved High+Medium polygon), `gpd.overlay`/`sjoin` with the
   area boundaries, sum intersection area per `area_code`. Heavy but exact.
2. **Pre-aggregated property counts (fast fallback):** EA "Properties in Areas at
   Risk" gives counts of properties at flood risk — if joinable to a small-area
   geography, that's a quick England proxy without the overlay. Useful as a cross-
   check, but England-only and property- not area-based.

v1 implements route 1, nation by nation, reading pre-downloaded extents from
`data/raw/flood/{england,wales,scotland}/`. Because the files are large and some
sit behind ESRI REST / WMS rather than a single static CSV, the ingest is **drop-in
friendly**: `src/ingest/flood.py` looks for the extent files locally and no-ops
gracefully (logging what to fetch) if they're absent — so the pipeline keeps running
and flood simply stays unset until the data is present (same pattern as
`scotland_crime.py` / `aadf.py`).

## Implementation steps

- [x] `PHASE4_PLAN.md` (this file) + `src/ingest/flood.py` scaffold (no-op-safe).
- [x] Config: `sources.flood_*` URLs; `flood_risk` wired as a place **candidate**.
- [x] `aggregate_to_lsoa.py`: merge `flood.parquet` when present; missing → NaN
      (reweighted / held at median, never silently zero outside covered nations).
- [ ] Implement the areal-overlay transform per nation + the download/cache helpers.
- [ ] Re-run calibration; `feature_analysis.md` decides keep vs diagnostic.
- [ ] Tests for the pure overlay/share transform; docs (README/STATUS) refresh.

## Open scope question

England-first (EA only, clearly caveated) vs full GB (EA+NRW+SEPA) in v1. Full GB is
the honest target but triples the ingest surface. Recommend: **EA + SEPA first**
(England + Scotland, the two with clean OGL bulk downloads), add Wales/NRW once its
download path is confirmed — mirroring how Scotland demographics were sequenced.

## Deferred

- Surface-water ("pluvial") flood maps — separate EA/SEPA layers; rivers+sea first.
- Climate-change projected extents (EA RoFRS Climate Change) — a future scenario layer.
- Flood-defence condition weighting beyond what the source bands already embed.
