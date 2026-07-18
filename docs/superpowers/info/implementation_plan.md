# UK-Wide Expansion — Implementation Plan

## Summary

Expanding the London Territory Risk Map to a **full-UK model** (~42k small areas). The existing 137-row multi-quarter WTW panel data is ready. Sprint 1 (model credibility) improvements are folded into the calibration upgrade.

**Key design principle:** The London-only path remains selectable via config. Nothing that currently works breaks.

---

## Phase A — Parameterise Config & Remove London Hard-Coding

### [MODIFY] [config.yaml](file:///Users/anugnana/Library/Projects/london-insurance-risk/config/config.yaml)

Replace the single `geography.region_code` with a `footprint` concept:

```yaml
geography:
  footprint: "uk"            # "uk" | "england" | "london" | list of region codes
  unit: "LSOA"               # LSOA (E+W), Data Zone (Scotland), SOA (NI)
  lsoa_vintage: "2011"
  nations: [england, wales, scotland, northern_ireland]
```

Add calibration section:
```yaml
calibration:
  panel_csv: "data/manual/wtw_anchors_panel.csv"
  method: "ols"              # ols | ridge | lasso
  holdout: true
```

---

## Phase B — Expand Ingest (4 Nations)

### [MODIFY] [boundaries.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/boundaries.py)
- Remove the `LONDON_BOROUGHS` filter and `_is_london_lsoa()` check
- Fetch **all** England+Wales LSOAs from the existing ArcGIS endpoint (it already serves E+W)
- Add Scotland Data Zones (6,976) from the NRS Data Zone 2011 boundaries (ONS/NRS ArcGIS)
- Add NI SOAs (890) from NISRA boundaries
- Produce a unified `area_boundaries.parquet` with columns: `area_code, area_name, nation, area_type, geometry, area_km2`
- Keep `lsoa11cd` as an alias for `area_code` in E+W for backward compatibility
- Still write `london_lsoa_list.csv` for backward compatibility when `footprint=london`

### [MODIFY] [onspd.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/onspd.py)
- ONSPD is already UK-wide — just remove the `_filter_to_london()` call when `footprint != london`
- The postcode lookup is the largest file (~2.5M rows) but the existing code already handles it

### [MODIFY] [imd.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/imd.py)
- Keep England IMD 2019 (already working)
- Add Wales WIMD 2019 download + parse
- Add Scotland SIMD 2020v2 download + parse
- Add NI NIMDM 2017 download + parse
- Each nation's deprivation score is **percentile-ranked within its own nation** before combining — this is the honest fix for cross-border incomparability (per AGENTS.md rule 4, comment explicitly)
- Output: unified `deprivation.parquet` with `area_code, nation, deprivation_score, deprivation_rank, deprivation_pct, population`

### [MODIFY] [police_crime.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/police_crime.py)
- data.police.uk covers **England + Wales** (all 43 forces), not Scotland/NI
- Remove the `FORCES = ["metropolitan", "city-of-london"]` restriction
- Download bulk ZIPs for **all** forces (the archive URL pattern is the same)
- Scotland/NI crime: documented as missing. The feature is set to NaN for those areas and the risk index reweights around the remaining features

### [MODIFY] [stats19.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/stats19.py)
- STATS19 covers Great Britain (E+W+S), not NI
- Remove `_filter_to_london()` — keep all GB collisions
- NI collisions: PSNI publishes separately; defer to a later phase or document as missing

---

## Phase C — Calibration Upgrade (Sprint 1 folded in)

### [MODIFY] [wtw_index.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/calibrate/wtw_index.py)
- Point at `data/manual/wtw_anchors_panel.csv` (137 rows, already built by previous agent)
- The existing SEED data becomes a fallback; the panel CSV is the primary source
- Normalise area name variants (e.g. "Outer London" vs "London - Outer")

### [MODIFY] [calibrate.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/calibrate/calibrate.py)
Major upgrade:

1. **Panel regression with quarter fixed effects** — `avg_premium ~ features + C(quarter)`, controlling for the national premium trend
2. **Clustered standard errors** — cluster by area (since same areas repeat across quarters)
3. **Ridge/Lasso with CV** — report CV-R² alongside in-sample R²
4. **Leave-one-area-out hold-out** — predict each area's premium from all others, report MAE (£)
5. **Temporal back-test** — fit on quarters ≤T, predict T+1
6. **Spearman rank correlation** — rank-order validation
7. **Multi-grain matching** — match panel rows to model features at region, postcode_area, and town grain (not just postcode_area)

### [MODIFY] [aggregate_to_lsoa.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/transform/aggregate_to_lsoa.py)
- Generalise from `lsoa11cd` to `area_code`
- Handle missing features (NaN for Scotland/NI crime) with documented reweighting

### [MODIFY] [build_risk_index.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/transform/build_risk_index.py)
- Handle `area_code` instead of hardcoded `lsoa11cd`
- Missing-feature reweighting: if `vehicle_crime` is NaN (Scotland/NI), redistribute its weight across the available features

---

## Phase D — Frontend Scaling (deferred to after pipeline works)

> [!NOTE]
> The current architecture loads the entire GeoJSON (~2MB for London) into the browser. At ~42k areas that's ~14MB+ — too big. This phase is deferred until the pipeline produces the national dataset, but the solution is known: **PMTiles** (tippecanoe → `.pmtiles`, served statically, MapLibre streams them).

---

## Execution Order

1. **Config** — update `config.yaml` with footprint/nations
2. **Boundaries** — UK-wide fetch (this is the foundation everything else joins to)
3. **ONSPD** — remove London filter
4. **IMD** — add WIMD/SIMD/NIMDM with within-nation percentile ranking
5. **Police crime** — all-force E+W bulk download
6. **STATS19** — remove London filter
7. **Aggregation** — generalise to `area_code`, handle missing features
8. **Risk index** — missing-feature reweighting
9. **WTW panel** — point calibration at the 137-row panel
10. **Calibration** — panel regression + full testing ladder
11. **Verify** — run full pipeline, compare London subset to previous results

---

## Verification

- Run `make ingest → features → risk → calibrate` for UK footprint
- London subset of the national model should produce similar (not identical) risk scores to the London-only model
- Calibration should show improved stability (n=137 vs n=16)
- All 4 coefficient signs should remain positive
- Hold-out MAE should be reported in £
