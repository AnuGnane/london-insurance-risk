# London Car-Insurance Risk Map — Implementation Plan (M1–M4)

## Current State

**M0 (Scaffold + Config) is complete.** 
**M1 (Ingest) is almost complete.**
- Boundaries, IMD, and STATS19 have been successfully downloaded and processed.
- `police_crime.py` and `onspd.py` had minor bugs which have now been fixed. They are ready to run.

**Next step: Finish running M1 (Ingest) → M2 (Aggregate) → M3 (Risk Index) → M4 (Calibrate).**

---

## Open Questions

> [!NOTE]
> All open questions from the previous planning phase have already been resolved based on your earlier decisions:
> **1. ONSPD vs NSPL:** We are using **NSPL** for speed.
> **2. Police.uk API vs bulk download:** We are using **bulk CSVs** for speed and reliability.
> **3. VEH0125 vehicle density:** We are **skipping this for v1** and redistributing the weight.
> **4. Population data:** We are using **IMD File 7 population data**.

---

## Proposed Changes

### M1 — Ingest (5 modules)

Each module downloads its source into `data/raw/`, parses/filters to London LSOAs, and writes tidy Parquet to `data/interim/`.

---

#### [MODIFY] [boundaries.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/boundaries.py)

**Source:** ONS Open Geography Portal — LSOA (Dec 2011) Boundaries (BGC — clipped to coastline)
- **URL:** `https://open-geography-portalx-ons.hub.arcgis.com` → ArcGIS REST Feature Service for LSOA boundaries
- **Strategy:** Use the ArcGIS REST API to query features with `where` filter for London LADs, or download the full England GeoJSON/GeoPackage and filter to `region_code = E12000007` via an LSOA→LAD→Region lookup table
- **Filter:** Keep only LSOAs whose parent LAD is in the London region (32 boroughs + City of London)
- **Transform:** Reproject to EPSG:27700, compute `area_km2` from geometry
- **Output:** `data/interim/lsoa_boundaries.parquet` — columns: `lsoa11cd, lsoa11nm, lad11cd, geometry, area_km2`
- **Also fetch:** London LAD list (for filtering other datasets) and LSOA→LAD lookup

#### [MODIFY] [onspd.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/onspd.py)

**Source:** ONS NSPL (National Statistics Postcode Lookup) — lighter than full ONSPD
- **URL:** https://geoportal.statistics.gov.uk/datasets/national-statistics-postcode-lookup
- **Strategy:** Download the NSPL zip, extract the main CSV, filter to rows where `lsoa11` is in our London LSOA set (from boundaries ingest)
- **Output:** `data/interim/postcode_lookup.parquet` — columns: `pcd7, pcd8, lsoa11cd, lat, long, postcode_district, postcode_area`
- **Dependencies:** Runs after `boundaries.py` (needs the London LSOA list for filtering)

#### [MODIFY] [police_crime.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/police_crime.py)

**Source:** data.police.uk bulk CSV archive (or API, per user choice)
- **Bulk strategy:** Download monthly CSVs from `https://data.police.uk/data/` for Metropolitan Police + City of London Police. Filter to `Crime type == "Vehicle crime"`. Each CSV has `LSOA code` and `LSOA name` columns — no spatial join needed.
- **API fallback:** Paginate by grid tiles over the London bbox, throttle to ~15 req/s with exponential backoff, cache each month's JSON under `data/raw/police/`
- **Output:** `data/interim/vehicle_crime.parquet` — columns: `month, lsoa11cd, lsoa_name, latitude, longitude, outcome`
- **Caching:** Raw downloads cached under `data/raw/police/`; rerun skips months already cached

#### [MODIFY] [stats19.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/stats19.py)

**Source:** DfT Road Safety Data (STATS19) — collision-level CSVs
- **URL:** `https://data.dft.gov.uk/road-accidents-safety-data/` — direct CSV links per year
- **Strategy:** Download collision CSVs for each year in `config.data_years.stats19_years`. The collision table includes `lsoa_of_accident_location` — no spatial join needed for most rows. Fallback: point-in-polygon join for rows missing an LSOA.
- **Severity mapping:** `1 → fatal, 2 → serious, 3 → slight` (DfT coding)
- **Filter:** Keep only collisions in London LSOAs
- **Output:** `data/interim/collisions.parquet` — columns: `accident_index, lsoa11cd, severity_label, severity_weight, year, latitude, longitude`

#### [MODIFY] [imd.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/ingest/imd.py)

**Source:** English Indices of Deprivation 2019 — File 7 (all IoD2019 scores, ranks, deciles)
- **URL:** `https://assets.publishing.service.gov.uk/media/5d8b387a40f0b604d4a32ad3/File_7_-_All_IoD2019_Scores__Ranks__Deciles_and_Population_Denominators_3.csv`  (direct link to File 7)
- **Strategy:** Direct CSV download. Filter to London LSOAs. Keep overall IMD score, rank, decile, plus the Income + Crime domain scores (useful for calibration insight).
- **Output:** `data/interim/imd.parquet` — columns: `lsoa11cd, imd_score, imd_rank, imd_decile, income_score, crime_score, population`
- **Bonus:** The population column in File 7 gives us LSOA-level population denominators for density without needing a separate mid-year estimate download.

---

### M2 — Aggregate to LSOA

#### [MODIFY] [aggregate_to_lsoa.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/transform/aggregate_to_lsoa.py)

**Input:** All `data/interim/*.parquet` files from M1
**Output:** `data/interim/lsoa_features.parquet`

Feature construction:
| Feature | Numerator | Denominator | Notes |
|---|---|---|---|
| `vehicle_crime` | count of vehicle-crime incidents per LSOA (summed over months) | population (from IMD File 7) × months / 12 → rate per 1k per year | |
| `road_casualties` | severity-weighted collision count (`slight×1 + serious×3 + fatal×8`) | population × years | From config severity weights |
| `deprivation` | IMD overall score | — (already normalised by ONS) | |
| `vehicle_density` | licensed vehicles (if VEH0125 wired) | area_km2 | Optional; may be skipped |
| `population_density` | population (from IMD) | area_km2 (from boundaries) | |

- Use **duckdb** for the group-by joins (fast, no DB server)
- Join everything on `lsoa11cd`

---

### M3 — Risk Index

#### [MODIFY] [build_risk_index.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/transform/build_risk_index.py)

The pure functions `normalise()` and `composite()` already exist. Implement `run()`:

1. Load `lsoa_features.parquet`
2. Call `composite()` with config weights → `risk_index` column (0–100)
3. `pd.qcut()` into quintile buckets → `risk_bucket` (1–5)
4. Join boundaries geometry (from `lsoa_boundaries.parquet`)
5. Write `data/processed/lsoa_risk.parquet` (tabular) + `data/processed/lsoa_risk.geojson` (EPSG:4326, for the map)

---

### M4 — Calibrate

#### [MODIFY] [wtw_index.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/calibrate/wtw_index.py)

Already functional — writes 3 seed rows. I'll:
- Expand the seed data with more London-area anchors where published (e.g., specific postcode areas like EC, E, N, NW, SE, SW, W from publicly available quarterly reports)
- Keep the manual CSV approach as designed (this is not an API — it's ~20–50 rows transcribed from published reports)

#### [MODIFY] [calibrate.py](file:///Users/anugnana/Library/Projects/london-insurance-risk/src/calibrate/calibrate.py)

1. Load `lsoa_risk.parquet` + features, `postcode_lookup.parquet`, `wtw_anchors.csv`
2. Roll LSOA features up to postcode-area level (mean) via the postcode lookup
3. Join to WTW anchors on `postcode_area`
4. Fit OLS regression: `avg_premium ~ vehicle_crime + road_casualties + deprivation + pop_density`
5. Report: coefficients, R², sign checks (crime↑ → premium↑), residuals
6. Optionally derive back-fit weights from standardised coefficients
7. Write `reports/calibration.md` with full methodology and caveats

---

## Verification Plan

### Automated Tests
```bash
make test   # existing smoke tests + new per-module tests
```

New tests to add:
- `tests/test_ingest.py` — assert each module produces expected parquet schema (column names + dtypes) when given a small fixture
- `tests/test_aggregate.py` — verify feature table joins produce expected row count against fixture data
- `tests/test_risk_index.py` — expand existing smoke tests; verify quintile distribution

### Manual Verification
```bash
make ingest    # downloads + parses → data/interim/*.parquet
make features  # builds lsoa_features.parquet
make risk      # builds lsoa_risk.parquet + .geojson
make calibrate # fits regression, writes reports/calibration.md
```

- Inspect parquet row counts (expect ~4,800 LSOAs for London)
- Spot-check 2–3 known high-crime LSOAs vs. the risk index output
- Verify the GeoJSON renders in geojson.io or QGIS
- Review calibration.md for sensible coefficient signs and R²
