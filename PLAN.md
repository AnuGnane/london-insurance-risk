# London Car-Insurance Risk Map — Build Plan

## What this is
A data product that builds a **composite territory-risk score for every small area in London** from open
data, renders it as an interactive choropleth, and lets you type a postcode to see its risk profile. It is
**not** a quote scraper and does not pull per-insurer prices. Instead it reconstructs the kind of signal
insurers use for territory rating, then **calibrates that score against real, published average premiums**
(WTW / Confused.com Car Insurance Price Index) so the numbers are anchored to reality rather than arbitrary.

Think of it as: *reverse-engineering postcode rating from public risk drivers, validated against the
market's own published price index.*

## Why this scope
- The risk layer is the original, defensible, portfolio-worthy core.
- Live multi-aggregator quotes (Compare the Market / MoneySuperMarket / Confused / GoCompare) are out of scope
  for v1: their ToS prohibit scraping, they run real anti-bot, and a single quote needs a full driver +
  vehicle profile, not a postcode. Revisit later as a manual experiment if wanted.

---

## 1. Spatial unit (the most important decision)

**Model and display at LSOA (Lower-layer Super Output Area).**
- ~4,800 LSOAs in Greater London (2011 vintage), ~1,500 people each — fine-grained and stable.
- Almost every covariate we want (deprivation, census demographics) is *published* at LSOA, and crime /
  collisions can be aggregated to it cleanly.
- Provide two roll-ups for UX and validation:
  - **LSOA → postcode district** (e.g. `EN1`, `SW1`, `E14`) — friendlier choropleth (~300 polygons) and the
    unit people recognise.
  - **LSOA → postcode area** (the letters, e.g. `EN`, `E`, `SW`) — the grain the WTW index publishes at, used
    for calibration.
- A user-typed postcode resolves to its LSOA via the ONS Postcode Directory (ONSPD / NSPL).

> Gotcha: IMD 2019 uses **2011** LSOA boundaries; Census 2021 uses **2021** LSOAs. Pick one space and stay in
> it (v1 = 2011 to match IMD), or use the ONS 2011↔2021 LSOA lookup to bridge. Don't silently mix vintages.

---

## 2. Data sources (all free / open)

| Layer | Source | Grain | Notes |
|---|---|---|---|
| Vehicle crime | data.police.uk API + bulk CSV | point (snapped) | Category `vehicle-crime`; monthly; ~last 3 yrs; no key; rate-limited |
| Road collisions | DfT STATS19 (data.gov.uk) | point + `lsoa_of_accident_location` | Severity slight/serious/fatal; 1979–latest; CSV |
| Deprivation | English Indices of Deprivation 2019 | LSOA (2011) | Overall IMD + domains |
| Boundaries | ONS Open Geography Portal | LSOA polygons | Filter to London region `E12000007` |
| Postcode lookup | ONSPD / NSPL (ONS) | postcode → LSOA, lat/long | Powers postcode search |
| Vehicle density (optional) | DfT VEH0125 | postcode district / LA | Denominator for normalising theft |
| **Price anchor** | **WTW / Confused.com Price Index** | region + postcode-area / town | Published quarterly; small manual/semi-manual ingest |

### Reality check on the price anchor
The WTW/Confused index is published as quarterly reports/tables, **not a clean API** — ingestion means
transcribing a handful of rows (London regions + any London postcode areas/towns) into a CSV. That's fine:
it only needs ~20–50 anchor rows because its job is calibration, not per-LSOA pricing. Useful London anchors
it publishes: Inner London, Outer London, and West Central London (consistently the most expensive postcode
area in the UK, recently ~£1,350; the UK-wide spread top-to-bottom is >£850/yr).

---

## 3. Risk index methodology

Per LSOA, build features then combine:

1. **Vehicle crime rate** — `vehicle-crime` incidents per 1,000 households (or per licensed vehicle if VEH0125
   used), averaged over the chosen months.
2. **Collision severity rate** — STATS19 collisions in the LSOA weighted by severity
   (`slight=1, serious=3, fatal=8`), normalised by population or road length.
3. **Deprivation** — IMD overall score/rank.
4. **Vehicle density** (optional) — licensed vehicles per area.
5. **Population density** — ONS mid-year estimate / area.

**Combine:** percentile-normalise each feature to 0–100 (robust to outliers; `zscore`/`minmax` switchable in
config), apply configurable weights (default in `config.yaml`), sum → `risk_index` 0–100. Bucket into
quintiles for the map legend.

**Calibration (the bit that makes it credible):**
- Roll LSOA features up to postcode area, join to WTW average premium for that area.
- Fit an interpretable regression (OLS / regularised) of premium ~ features. Report direction, R², and
  whether components behave sensibly (crime ↑ → premium ↑, etc.).
- Optionally **back-fit the index weights** from the regression so the composite tracks real premiums, then
  re-score at LSOA. Keep the unfitted "expert weights" version too, for comparison.
- Be candid: WTW grain for London is coarse, so this is a sanity-check + weight aid, **not** a precise
  per-LSOA price model. State that in the write-up.

---

## 4. Stack

- **Python 3.11+**, dependency mgmt via `uv` (or pip + `requirements` fallback).
- **ETL / analysis:** `pandas`, `geopandas`, `shapely`; **`duckdb`** for fast local SQL joins over CSV/Parquet
  (homelab-friendly, no DB server).
- **Modelling:** `scikit-learn` + `statsmodels` (interpretability).
- **Config:** `pydantic-settings` + `config/config.yaml`.
- **API (Phase 5):** `FastAPI` + `uvicorn` — `GET /risk?postcode=` and `GET /geojson`.
- **Map (Phase 5):** **MapLibre GL JS** (open source, no token) over vector/GeoJSON tiles. Front-end form
  factor deferred — scaffolded as a stub for now.
- **Repro:** `Makefile` stage targets; raw data git-ignored; sources + licences documented in README.

---

## 5. Milestones

- **M0 — Scaffold + config** *(this deliverable)*: repo, config, stubs, AGENTS.md, Makefile.
- **M1 — Ingest**: each source cached to `data/raw`, parsed to tidy Parquet in `data/interim`.
- **M2 — Aggregate to LSOA**: one feature table `data/interim/lsoa_features.parquet`.
- **M3 — Risk index**: `data/processed/lsoa_risk.parquet` + `lsoa_risk.geojson` (expert-weighted).
- **M4 — Calibrate**: WTW ingest, regression, validation, optional weight-fit; comparison report.
- **M5 — Serve** *(after you pick a form factor)*: FastAPI + MapLibre choropleth with postcode search.
- **M6 — Write-up**: methodology + caveats as a portfolio piece (this is the bit that lands in interviews).

---

## 6. Limitations / honesty section (keep this in the final write-up)
- **Proxy, not price**: it estimates *relative territory risk*, not what any named insurer would charge.
- **MAUP / ecological fallacy**: LSOA-level risk ≠ any individual's risk; don't over-claim street precision.
- **Snapped crime points**: police.uk anonymises locations to representative points — fine for aggregates,
  not for pinpointing.
- **Vintage mismatch**: IMD 2019 (2011 LSOAs) vs Census 2021 — handle explicitly.
- **Coarse anchor**: WTW publishes London at region / postcode-area grain, so calibration is approximate.
