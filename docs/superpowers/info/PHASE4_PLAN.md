# Phase 4 Implementation Plan — Flood Risk

> Status: **COMPLETE (2026-07-18).** All three nations ingested (England via Defra SFTP,
> Wales NRW WFS, Scotland SEPA REST) and the evidence gate ruled `flood_risk` a
> **diagnostic, not a premium driver** — wrong-signed for car insurance (univariate
> r=−0.94: flood exposure tracks rurality, which is cheap). Outcome + defence in
> `AUDIT.md` §10, provenance in `DATA_PROVENANCE_AND_TRANSFORMS.md` §2.10, and the
> gate table in `reports/feature_analysis.md`. Banked as prior evidence for the
> home-insurance line (roadmap 2.10). Historical plan below.

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
| England | EA **Risk of Flooding from Rivers and Sea (RoFRS)** — 50 m cells, 4 risk bands | environment.data.gov.uk (dataset `96ab4342-…`); **SFTP large-data request required** | OGL v3.0 |
| Wales | NRW **Flood Risk Assessment Wales (FRAW)** rivers/sea | **Automated** (WFS paged GeoJSON from datamap.gov.wales) | OGL |
| Scotland | SEPA **Flood Maps** (river/coastal, High/Med/Low return periods) | **Automated** (ArcGIS REST, 4 pre-split services) | OGL v3.0 |

## England runbook (manual download — SFTP required)

Verified 2026-07-15: the legacy EA ArcGIS service
(`EA/RiskOfFloodingFromRiversAndSea/MapServer`, last modified 2020) returns
HTTP 500 and the DSP WFS slugs 404 — England's current RoFRS (NaFRA2-based,
revised 2026-06-18) is only available through the interactive downloader.
The "Full dataset" download and smaller polygon tiles both redirect to a
**large-data request form** (SFTP). Submit the request and wait for access.

1. Open https://environment.data.gov.uk/explore/96ab4342-82c1-4095-87f1-0082e8d84ef1?download=true
2. Select **`rofrs_4band`** layer (NOT "All" — depth layers are not needed).
3. Choose **GeoPackage** format (or ESRI Shapefile as fallback).
4. If "Full dataset" triggers a large-data request form, submit it and wait
   for SFTP credentials. Download the file(s) when available.
5. Unzip into `data/raw/flood/england/` (any mix of .gpkg/.shp/.geojson/.parquet).
6. Re-run `uv run python -m src.ingest.flood`. The ingest reads every file in
   the folder, keeps High+Medium via the band column (`prob_4band`/`risk_band`/…)
   and logs exactly which band values were kept vs dropped — check that log line:
   if it reports no band column but the source has 4 bands, stop and add the
   column name to `_BAND_COL_CANDIDATES` in `src/ingest/flood.py`.

Scotland (SEPA) and Wales (NRW) need no manual step — `flood.py` fetches and
caches them automatically.

## Implementation steps

- [x] `PHASE4_PLAN.md` (this file) + `src/ingest/flood.py` scaffold (no-op-safe).
- [x] Config: `sources.flood_*` URLs; `flood_risk` wired as a place **candidate**.
- [x] `aggregate_to_lsoa.py`: merge `flood.parquet` when present; missing → NaN
      (reweighted / held at median, never silently zero outside covered nations).
- [x] Shared Esri helpers (`src/common/esri.py`) — ring converter + paged polygon fetch.
- [x] Fix 3 scaffold bugs (band-filter-before-strip, dissolve overlaps, per-nation NaN-not-zero).
- [x] Within-nation percentile ranking for `flood_risk` (`_feature_groups` in `build_risk_index.py`).
- [x] SEPA Scotland fetcher (ArcGIS REST, 4 services, cached GeoParquet).
- [x] NRW Wales fetcher (WFS paged GeoJSON, band-checked, cached GeoParquet).
- [x] England runbook documented (SFTP large-data request required).
- [ ] **BLOCKED**: England data download (Defra SFTP request submitted).
- [ ] Run ingest for real (Scotland + Wales now; England when data arrives).
- [ ] Re-run calibration; `feature_analysis.md` decides keep vs diagnostic.
- [ ] Frontend flood layer + about entry.
- [ ] Tests for full integration; docs (README/STATUS) refresh.

## Open scope question — resolved

**Outcome:** SEPA + NRW automated; England is a manual SFTP download. Proceeding
with Scotland + Wales. England slots in when the Defra SFTP request is fulfilled.
This mirrors how Scotland demographics were sequenced in Phase 2.

## Deferred

- Surface-water ("pluvial") flood maps — separate EA/SEPA layers; rivers+sea first.
- Climate-change projected extents (EA RoFRS Climate Change) — a future scenario layer.
- Flood-defence condition weighting beyond what the source bands already embed.
