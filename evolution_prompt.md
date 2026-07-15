# Prompt: Evolving the GB Car-Insurance Territorial Risk Model

> Copy everything below the line and paste it as the opening prompt to a new agent conversation.

---

## Your role

You are a **Senior Data Scientist / ML Engineer acting as a strategic product-and-modelling advisor**. I'm going to describe an existing project to you in detail — including its architecture, model, data sources, validation results, known limitations, and deferred work. Your job is to think deeply, creatively, and critically about **how this project can evolve, improve, and grow** across three dimensions:

1. **Data & features** — what new data sources, features, or enrichments would meaningfully improve the model or unlock new capabilities?
2. **Model & methodology** — how can the statistical model, calibration, validation, and explainability be refined or upgraded?
3. **Product & UX** — what new user-facing features, interactions, or presentation improvements would make the tool more powerful, useful, and impressive?

For each idea, I want you to assess:
- **Impact** (how much it would improve accuracy, coverage, usefulness, or impressiveness)
- **Feasibility** (effort, data availability, technical complexity)
- **Priority** (where it sits in a realistic roadmap)
- **Risks / caveats** (what could go wrong or what trade-offs exist)

Be opinionated. Challenge assumptions. Propose ideas I haven't considered. Think beyond incremental improvements — what would make this a **genuinely impressive, portfolio-defining, or even commercially-viable** system?

---

## The project as it stands today

### What it is
An open-data pipeline that estimates an **expected annual car-insurance premium** for all **41,729 small areas** (LSOAs in England/Wales, Data Zones in Scotland) across Great Britain, rendered as an **interactive choropleth map** with postcode search.

- **Not a quote engine** — no individual driver/vehicle details. It models the **territorial (postcode) component** of insurance pricing only.
- The premium is **calibrated** against the published WTW/Confused.com Car Insurance Price Index.
- The 0–100 "risk index" is the premium on a percentile scale — **one reconciled model**, not two separate constructs.
- Every area's price is **fully explainable**: a premium waterfall bridges from a baseline (£537) to the area's estimate via exact, signed, per-factor £ steps.

### Live demo
Deployed as a **fully static** GitHub Pages site (React + MapLibre GL). Postcode search works client-side via postcodes.io + point-in-polygon. A FastAPI backend exists for local development.

---

## Architecture

```
data.police.uk · STATS19 · IMD/WIMD/SIMD · Census 2021/22 · DfT AADF
Scotland crime (SPARQL) · ONS boundaries · WTW/Confused price index
                                 │
   M1  ingest/      one module per source ──────────▶ data/interim/*.parquet
                                 │
   M2  transform/   aggregate_to_lsoa.py → one row per area_code
                                 │
   M3  transform/   build_risk_index.py  → percentiles, calibrated premium,
                    (reads calibration.json)  per-driver £ contributions, quintiles
                                 │      → data/processed/lsoa_risk.parquet
   M4  calibrate/   wtw_index.py + calibrate.py → reports/calibration.json
                                 │
   showcase/        bake_static.py → frontend/public/data/areas.geojson
                                 ▼
                    React + MapLibre GL choropleth (GitHub Pages)
```

- **Config-driven**: `config/config.yaml` is the single source of truth for geography footprint, feature buckets (place/composition/diagnostics), normalisation method, calibration settings.
- **One module per data source** with parquet hand-offs.
- **Python 3.11+**, type hints, ruff-clean. `duckdb` for big joins, `geopandas` for spatial.

---

## The model

### Response variable
**Log of relative territorial index**: `y = log(area_premium ÷ national_avg)` — isolates the spatial effect, removes the national price level/time trend.

### Specification
```
log(premium_index) = const
    + β₁·vehicle_crime_pct + β₂·deprivation_pct + β₃·aadf_intensity_pct    (PLACE)
    + β₄·young_driver_share_pct + β₅·cars_per_household_pct                  (COMPOSITION)
    + C(source)                                                                (source FE)
```

- **Estimator**: Panel OLS with area-clustered SEs. Ridge CV for regularisation.
- **Feature basis**: Percentile (0–100) — bounds LSOA-grain extrapolation.
- **Place vs composition**: Place features are the territorial drivers; composition features are demographic controls included so place coefficients are net of who lives there.

### Three numbers per area
1. **Full premium** (place + composition)
2. **Place-only** (composition at national median) — "what this area costs at average demographics"
3. **Composition uplift** (full − place-only)

### Current features

| Feature | Bucket | Source |
|---------|--------|--------|
| `vehicle_crime` | Place | data.police.uk (E+W) + statistics.gov.scot SPARQL (Scotland) |
| `deprivation` | Place | IoD2019 (E) + WIMD2019 (W) + SIMD2020v2 (S), within-nation percentile |
| `aadf_intensity` | Place | DfT point-level AADF count points, mean within 2 km of centroid |
| `young_driver_share` | Composition | Census 2021 (E+W) + Census 2022 (S), age 17–24 share |
| `cars_per_household` | Composition | Census 2021 (E+W) + Census 2022 (S) |

**Diagnostics** (ingested, shown on map, NOT premium drivers — evidence-gated out):
- `traffic_per_capita`, `ksi_collisions_per_billion_vehicle_miles`, `road_casualties`, `population_density`

### Validation results

| Metric | Value |
|--------|-------|
| Matched observations | 106 (30 areas × up to 11 quarters) |
| Panel R² (adj) | 0.917 (0.912) |
| Ridge CV-R² | 0.887 |
| Leave-one-area-out MAE | £89 |
| Temporal back-test MAE | £74 |
| Spearman (predicted vs actual) | 0.968 |
| Feature VIFs (all premium features) | 2–6 (no collinearity) |
| Place-only R² | 0.759 |
| Composition-only R² | 0.884 |
| National average premium | £558.55 |
| Premium range (all GB) | £193–£1,542 |

### Back-fit importances
young_driver_share: 0.44, cars_per_household: 0.24, aadf_intensity: 0.17, vehicle_crime: 0.09, deprivation: 0.08

---

## Data sources & licences
All Open Government Licence v3.0 or equivalent:
- **Vehicle crime (E+W)**: data.police.uk bulk download, 36-month window
- **Vehicle crime (Scotland)**: "Recorded Crime in Scotland" via SPARQL, council grain → disaggregated to Data Zone by population
- **Collisions**: DfT STATS19 GB-wide (Scotland assigned Data Zone by spatial join)
- **Traffic**: DfT point-level AADF (Annual Average Daily Flow)
- **Deprivation**: England IoD2019 · Wales WIMD2019 · Scotland SIMD2020v2
- **Demographics**: Census 2021 (E+W, Nomis) + Census 2022 (Scotland, UK Data Service)
- **Boundaries**: ONS E+W LSOAs + Scottish Data Zones 2011 + ONSPD (2.64M postcodes)
- **Calibration anchor**: WTW/Confused.com price index (137-row panel) + MoneySuperMarket regional figures

---

## Completed phases

### Phase 0 — Model foundation
- Reconciled risk_index and calibrated_premium into one construct
- Switched to percentile feature basis (bounds extrapolation)
- Ingested Scotland crime; all 41,729 areas priced

### Phase 1 — Territorial reframe
- Relative log-index response variable
- Demographic controls (young-driver share, cars/household)
- Place/composition split with three numbers per area
- Feature significance report with evidence-gating

### Phase 2 — Anchor expansion
- Confused/WTW Scottish regions in the panel (30 areas, 106 obs)
- MoneySuperMarket as a second anchor source with source FE
- Scotland Census 2022 demographics (97% coverage)

### Phase 3 — Traffic exposure
- Point-level AADF traffic intensity replaced population density
- KSI collisions and LA-traffic-per-resident evidence-gated to diagnostics
- All premium features now independent significant keepers (VIF 2–6)

### Phase 4 — Flood risk (STARTED)
- Scaffold exists (`src/ingest/flood.py`, areal-overlay transform, config wired)
- Awaiting EA/NRW/SEPA High+Medium flood extent downloads
- Will be evidence-gated like Phase 3

---

## Known limitations & caveats

1. **Validation grain ≠ prediction grain**: validated at postcode-area/region grain, predicts at LSOA grain. Per-LSOA numbers are extrapolations.
2. **Small calibration sample**: n=106 obs, 30 areas. Hence regularised linear model, not ML.
3. **Composition explains more variance than place** (0.884 vs 0.759) — at this grain, *who lives there* matters more than *where*.
4. **Scotland crime is council-grain** — no within-council variation.
5. **No individual driver/vehicle info** — purely territorial.
6. **AADF coverage**: ~10% of areas fall back to nearest count point.
7. **Ecological / MAUP risk**: area-aggregate features, can't infer individual-level effects.
8. **Wealthy-but-central LSOAs**: can be under-priced because deprivation (a strong signal) is low while real premiums are driven by unmodelled factors (vehicle value, congestion, claims cost).
9. **GeoJSON payload**: ~15 MB gzipped for 42k areas. PMTiles deferred.

---

## Deferred / not yet started

| Item | Notes |
|------|-------|
| **Northern Ireland** | No NI crime or collision open data; would carry only 2 of 4 features |
| **PMTiles vector tiles** | Needed for production-scale serving |
| **Flood risk completion** | Phase 4 scaffold exists; needs extent data download |
| **Sub-district calibration** | Structural — no public premium data exists below postcode-area grain |
| **CI / automated re-ingest** | Data sources update quarterly; no cron yet |
| **Urban/rural classification** | ONS (E+W) + Scottish Gov 6-fold — a cleaner urban proxy |
| **Vehicle age/type mix** | DfT VEH licensing tables — repair cost proxy |
| **Uninsured driving rates** | MIB hotspots — only top-15 published |
| **IMD sub-domains** | Crime/income domains already downloaded but not tested as standalone features |
| **Spatial autocorrelation** | Moran's I diagnostic not implemented |
| **ABI Average Premium Tracker** | A third independent calibration anchor |

---

## What I want from you

Think expansively but ground everything in the project's real constraints (open data, no quote-scraping, small calibration sample, linear model). I want you to produce:

### 1. Data & Feature Evolution
- What **new open data sources** could materially improve the model?
- Which **existing but unused signals** should be tested first (quick wins)?
- How can I improve **Scotland's data quality** (council-grain crime, coverage gaps)?
- Are there creative ways to get **more calibration anchors** without violating terms?
- What about **temporal features** (year-on-year change, seasonality)?

### 2. Model & Methodology Improvements
- Should I move beyond OLS/Ridge? If so, to what — and why, given n=106?
- How can I improve **per-LSOA accuracy** (the validation-grain gap)?
- Is there a better way to handle the **place vs composition decomposition**?
- How could I add **uncertainty quantification** (confidence intervals per area)?
- What about **spatial models** (spatial lag/error, geographically weighted regression)?
- Should the model be **retrained automatically** as new quarterly data arrives?

### 3. Product & UX Evolution
- What **new user-facing features** would make the map more powerful?
- How can I make the **"why is my area expensive?"** story more compelling?
- What about **comparison tools**, trend lines, or personalisation (even lightweight)?
- Could this become a **multi-line insurance model** (home, travel, life)?
- What would make this **commercially interesting** to insurers, brokers, or consumers?
- How should I think about **mobile UX** for the map?

### 4. Technical / Infrastructure
- What's the right path to **PMTiles / vector tiles**?
- Should I add **CI/CD for data freshness** (automated re-ingest + redeploy)?
- How could I make the pipeline more **composable / extensible** for new features?
- Any thoughts on **testing strategy** beyond the current smoke tests?

### 5. Big-Picture / Ambitious Ideas
- What would make this a **genuinely novel or publishable** piece of work?
- Could this evolve into a **platform** (API for third parties, embeddable widget)?
- What would a **"v2.0"** look like that would make an experienced data scientist say "wow"?
- Are there adjacent problem domains where this methodology could be reused?

Please organise your response as a **structured roadmap** with short-term (weeks), medium-term (months), and long-term (ambitious) horizons. Be specific about data sources (with URLs where possible), implementation approaches, and expected impact. Challenge my assumptions where you think I'm wrong or missing something.
