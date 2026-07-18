# London Territory Risk Map — Project Overview

> A high-level explanation of what was built, how the model works, what data was used, and where the project can go next. Written to support project showcases and portfolio presentations.

---

## What Is This?

This project reverse-engineers **territorial motor insurance risk** for every small area in London using only public, open data — then validates that model against real published average premiums.

The core idea: insurers charge different premiums based on where you live because some areas genuinely experience more vehicle crime, road collisions, and correlated risk factors than others. This "territory rating" is one of the biggest components in a motor insurance premium. We reconstruct that rating signal from scratch, rank every London neighbourhood, and display the result as an interactive choropleth map.

**What it is not**: a quote scraper. It doesn't connect to Compare the Market or any insurer. It's a *data science product* that answers: *"If you knew nothing about the driver or car, what does the postcode alone tell you about risk?"*

---

## 1. Spatial Unit Choice: LSOAs

The most important design decision is **what geography to model at**.

We chose **Lower Super Output Areas (LSOAs)** — the census building blocks defined by the Office for National Statistics. London has **4,881 LSOAs**, each containing roughly 1,500 people and 650 households. This is fine-grained enough to see meaningful intra-borough variation but stable enough that all our data sources can be cleanly joined to it.

### Why LSOAs and not postcodes or boroughs?

| Unit | Count in London | Problem |
|------|----------------|---------|
| Postcode (full) | ~600,000 | Too granular; crime data gets too sparse |
| Postcode district (e.g. E1, SW7) | ~300 | Useful for UX but too coarse for modelling |
| Borough (e.g. Hackney) | 33 | Hides the massive within-borough variation |
| **LSOA** | **4,881** | ✅ Perfect — all major data sources publish at this grain |

A key constraint: we use the **2011 LSOA vintage** throughout because it matches the **Index of Multiple Deprivation (IMD) 2019**, the most important deprivation dataset. If we mixed 2011 and 2021 LSOA boundaries, records wouldn't join correctly.

A **postcode-to-LSOA lookup** (from the ONS Postcode Directory, ~2.5 million rows) allows users to type any London postcode and instantly resolve it to its LSOA.

---

## 2. Data Sources

We used four open data sources, each chosen because it is freely available, regularly updated, and published at (or aggregatable to) LSOA grain.

### 2.1 Vehicle Crime — `data.police.uk`

**What it is**: The Metropolitan Police and City of London Police publish street-level crime records monthly through the Home Office open data API.

**What we extracted**: All incidents in the `vehicle-crime` category for the last 12 months.

**How**: Each record has a lat/lon point (snapped to the nearest road to anonymise the exact address). We downloaded records month-by-month, then used a **spatial join** (GeoPandas, British National Grid projection EPSG:27700) to count how many vehicle crime incidents fell within each LSOA polygon.

**Normalisation**: The raw count was divided by the LSOA population to get a **rate per 1,000 residents** — otherwise dense inner-city LSOAs would always appear highest simply because more people (and cars) are present.

**Caveat**: Police.uk anonymises point locations to representative snapped points, so there's a small spatial imprecision. Fine for aggregate statistics, not for street-level mapping.

---

### 2.2 Road Casualties — DfT STATS19

**What it is**: The Department for Transport publishes all reported road collisions in Great Britain since 1979 under the STATS19 collection scheme. Each collision record includes a severity classification (Slight, Serious, or Fatal) and, since 2016, the LSOA in which the accident occurred.

**What we extracted**: 4 years of data (2021–2024) covering all London collisions.

**Key design decision — severity weighting**: Not all accidents are equal. We applied a severity index:
- Slight = 1
- Serious = 3
- Fatal = 8

So a single fatal collision contributes 8× as much to the risk signal as a minor fender-bender. This is a principled way to make the signal responsive to the *harm* caused, not just the frequency.

**Feature created**: `road_casualties` = weighted sum of (slight × 1 + serious × 3 + fatal × 8) per LSOA per year, normalised by population.

---

### 2.3 Deprivation — IMD 2019

**What it is**: The English Indices of Multiple Deprivation 2019, published by MHCLG, is the official government measure of relative deprivation in England. Every 2011 LSOA gets a score and rank across seven domains: income, employment, health, education, crime, barriers to housing/services, and living environment.

**Why it's useful here**: High deprivation correlates with several insurance risk factors — older vehicles, higher crime rates, less access to secure parking, higher uninsured motorist rates. Including it as a feature captures socioeconomic risk signal the other datasets don't fully capture.

**What we used**: The overall IMD score (not individual domain scores) — a single robust aggregate.

---

### 2.4 Population Density — ONS

**What it is**: ONS mid-year population estimates crossed with LSOA area (in km², computed from the boundary polygons in British National Grid projection).

**Why it's included**: Density is a known insurance risk predictor — more vehicles in a confined space means more collisions, more crime opportunity, and harder parking. It also acts as a useful covariate alongside the crime rates.

---

### 2.5 Price Anchor — WTW / Confused.com Car Insurance Price Index

**What it is**: Willis Towers Watson (WTW) and Confused.com jointly publish a quarterly Car Insurance Price Index reporting average comprehensive motor premiums by UK region and postcode area. Unlike insurer rate cards (which are confidential), this is a publicly available aggregate.

**How we used it**: We manually transcribed 16 London postcode area averages (e.g. WC = West Central, E = East London, SW = South West) from the published tables into a small CSV (`data/interim/wtw_anchors.csv`). This isn't an API — it's a table from a quarterly PDF/webpage.

**Its role**: This is the **ground truth** for calibration (see §4). We roll up our LSOA-level features to postcode-area grain, then check whether our risk scores actually correlate with real premiums.

---

## 3. The Risk Index Model

### How It Works

Once all four data sources are ingested and joined at LSOA level, we build a single **0–100 composite risk index** for each of the 4,881 LSOAs.

**Step 1 — Normalise each feature to 0–100**

Raw feature values are not comparable — crime rates are per 1,000 residents, deprivation is an IMD score, density is people/km². We need a common scale.

We use **percentile normalisation**: each LSOA is ranked relative to all other LSOAs, and its score is its percentile rank (0th = lowest risk, 100th = highest). This is robust to outliers (a single extremely high-crime LSOA won't compress everything else to the bottom of the scale) and interpretable ("this LSOA is at the 87th percentile for vehicle crime across London").

**Step 2 — Weight and combine**

Each normalised feature is multiplied by an expert-set weight, summed, and divided by the total weight to produce a final index on the 0–100 scale:

```
risk_index = (
  vehicle_crime_pct × 0.40
  + road_casualties_pct × 0.30
  + deprivation_pct × 0.18
  + population_density_pct × 0.12
) / (0.40 + 0.30 + 0.18 + 0.12)
```

**Step 3 — Quintile bucketing**

LSOAs are split into 5 equal-sized quintiles (Q1 = lowest 20% of risk, Q5 = highest 20%). These drive the map colour (yellow → red).

### Current Results

| Metric | Value |
|--------|-------|
| LSOAs modelled | 4,881 |
| Risk index range | 1.8 – 95.2 |
| Median risk index | 50.0 (by design — percentile normalised) |
| Calibrated premium range | £471 – £4,280 |
| Median calibrated premium | ~£947 |

The weights (0.40 / 0.30 / 0.18 / 0.12) were set by expert judgement based on actuarial literature, then validated by the calibration step.

---

## 4. Calibration Against Real Premiums

This is what makes the project credible rather than arbitrary.

### The Problem

We can produce a risk index and call it "composite territorial risk", but without an external anchor it's just an opinionated weighted sum. We need to ask: *does this index actually predict what insurers charge?*

### The Approach

We roll up LSOA-level features to **postcode-area** grain (the level WTW publishes at) by taking the population-weighted mean of each feature across all LSOAs in a postcode area. We then fit an **Ordinary Least Squares (OLS) regression**:

```
avg_premium_gbp ~ const + vehicle_crime + road_casualties + deprivation + population_density
```

across 16 matched London postcode areas.

### Results

| Metric | Value |
|--------|-------|
| Observations | 16 postcode areas |
| R² | **0.909** |
| Adjusted R² | 0.875 |
| F-statistic p-value | 1.16×10⁻⁵ |

**The model explains 90.9% of the variance in real average premiums** across London postcode areas. That's a very strong fit for an open-data proxy.

### Coefficient Sign Checks

Every coefficient has the expected sign:

| Feature | Coefficient | Sign | Sensible? |
|---------|------------|------|-----------|
| Vehicle crime | +13.45 | Positive | ✅ More crime → higher premium |
| Road casualties | +12.41 | Positive | ✅ More collisions → higher premium |
| Deprivation | +4.82 | Positive | ✅ More deprived → higher premium |
| Population density | +0.031 | Positive | ✅ Denser area → higher premium |

The intercept of £408 can be interpreted as the baseline premium for an area with zero risk across all dimensions.

### The Back-fit Weights Discovery

Running the regression also gives us "market-implied" weights — how the market (i.e. the WTW aggregate) effectively weights each factor:

| Feature | Our Expert Weight | Market-Implied Weight |
|---------|------------------|-----------------------|
| Vehicle crime | 40% | 13% |
| Road casualties | 30% | 18% |
| Deprivation | 18% | 11% |
| Population density | 12% | **58%** |

**The key insight**: Population density is the dominant market signal, far more so than our expert prior assumed. The market charges substantially more in dense urban areas — a reflection of the higher collision probability, parking risk, and repair costs in congested environments. This is a genuine finding worth discussing in a showcase setting.

> **Important caveat**: With only 16 observations and 4 predictors, individual coefficients are unstable — only `population_density` and the intercept achieve conventional statistical significance (p < 0.05). The R² is meaningful; the individual betas are directional indicators, not precise parameters.

### The Premium Estimate

The calibration coefficients are used to generate a **per-LSOA estimated annual premium**:

```
calibrated_premium = 408 + 13.45 × vehicle_crime + 12.41 × road_casualties
                   + 4.82 × deprivation + 0.031 × population_density
```

This gives the map its £ estimates shown in the detail panel and rankings (range: ~£471 for lowest-risk outer London LSOAs to ~£4,280 for highest-risk central LSOAs).

---

## 5. The Technology Stack

### Data Pipeline (Python)

```
data.police.uk API  ─┐
DfT STATS19 CSV     ─┤── [M1 Ingest]  → data/raw/*.csv/.parquet
IMD 2019 XLSX       ─┤
ONS Boundaries ZIP  ─┘

data/raw/  ─── [M2 Feature Build]  → data/interim/lsoa_features.parquet
                                       (4,881 rows × ~15 columns)

lsoa_features.parquet ─── [M3 Risk Index]  → data/processed/lsoa_risk.parquet
                                              data/processed/lsoa_risk.geojson.gz

WTW anchor CSV ─── [M4 Calibration]  → reports/calibration.json
                                        reports/calibration.md
```

**Key libraries**: `pandas`, `geopandas`, `shapely` (spatial ops), `duckdb` (fast SQL joins on Parquet), `statsmodels` (OLS regression), `scikit-learn`.

**Geometry**: All area/distance calculations done in **EPSG:27700** (British National Grid, metres). Reprojected to **EPSG:4326** (WGS84, lat/lon) only for GeoJSON map output.

### API (FastAPI)

A lightweight `FastAPI` server with three key endpoints:
- `GET /api/geojson` — serves the gzipped choropleth GeoJSON (~4,881 features, ~2MB gzipped)
- `GET /api/risk?postcode=SW1A1AA` — resolves postcode → LSOA → full risk profile + premium estimate
- `GET /api/rankings?n=10&order=desc` — top/bottom N areas by risk
- `GET /api/methodology` — exposes model weights, normalisation method, and calibration R²

All data is loaded into memory at startup from Parquet — no per-request database queries.

### Frontend (React + MapLibre GL)

An interactive web app built with React + TypeScript + Vite, using **MapLibre GL** (the open-source, no-API-key alternative to Mapbox) for the map.

**Key architectural decision**: The entire GeoJSON is loaded into the browser once (it's ~2MB gzipped). This single in-memory store powers:
- The choropleth fill colours (re-computed client-side when the filter changes)
- Instant click-to-detail (no network round-trip — the detail panel reads from the already-loaded feature properties)
- Client-side distribution statistics (the "higher risk than X% of London areas" sparkline)
- Client-side fly-to animation on search/click

### Deployment

Docker multi-stage build: Node.js builds the frontend, Python serves both the React app (as static files) and the API via FastAPI + uvicorn. OrbStack on macOS.

---

## 6. What the Map Shows

When you open the app:

1. **Choropleth**: 4,881 LSOAs coloured from yellow (lowest risk) to dark red (highest risk), on a clean Carto Positron basemap.
2. **Filter by driver**: Switch from composite risk to any single driver (vehicle crime, road casualties, deprivation, population density) — the map recolours using that metric's percentile, the legend updates, and an on-screen label confirms what's being shown.
3. **Rankings panel**: Top 10 / bottom 10 areas by risk, each with the estimated annual premium and a "driven by crime / density / etc." chip.
4. **Postcode search**: Type any London postcode → flies to the LSOA, shows the detail panel with risk score, quintile, premium estimate, and driver breakdown.
5. **Detail panel**: For the selected area — distribution context ("higher risk than 87% of London areas"), per-driver bars (contribution in risk index points), and model vs WTW premium comparison where available.
6. **Deep-linkable URLs**: `?area=E01000001&filter=vehicle_crime` — shareable, bookmarkable.

---

## 7. Identified Areas for Improvement

### Model

| Area | Current State | Improvement |
|------|--------------|-------------|
| **Sample size for calibration** | 16 postcode areas | Expand to district grain (EN1, E14…) if WTW or other sources publish at that level; more observations = stabler betas |
| **Individual coefficient significance** | Only `population_density` is statistically significant (p < 0.05) | Regularised regression (Ridge/Lasso) with cross-validation would be more principled; or aggregate to fewer, more distinct areas |
| **Temporal coverage** | 12 months crime, 4 years STATS19 | Longer crime window (3 years) would smooth seasonal variation |
| **Vehicle density as denominator** | Currently using population density | DfT VEH0125 provides licensed vehicles per postcode district — a more accurate denominator for normalising vehicle crime |
| **Spatial autocorrelation** | Not tested | Adjacent LSOAs are likely correlated; Moran's I test + spatial lag model (PySAL) would be more statistically sound |
| **2021 LSOA vintage** | Using 2011 boundaries | Bridging to 2021 (ONS lookup table exists) would unlock Census 2021 variables (EV ownership, commute patterns) |

### Data

| Area | Current State | Improvement |
|------|--------------|-------------|
| **Price anchor grain** | Postcode area (e.g. "E", "SW") | Postcode district grain (e.g. "E1", "SW7") if available — 10× more anchor points |
| **Vehicle type mix** | Not included | Areas with older average vehicles or higher van/HGV density may have different risk profiles |
| **Uninsured rate** | Not included | MIB data on uninsured claims by area would be a strong predictor |
| **Flood/weather** | Not included | Environment Agency flood risk zones correlate with weather-related claims |
| **Historical claims** | Not public | The gold standard; none of the public sources provide this |

### Product / UX

| Area | Current State | Improvement |
|------|--------------|-------------|
| **Borough aggregation** | LSOA only | A borough-level toggle would let users say "Hackney vs Barnet" |
| **Compare two areas** | Not built | Side-by-side comparison of any two LSOAs/postcodes |
| **Postcode typeahead** | Not built | As-you-type suggestions from the postcode lookup |
| **"Near me" button** | Not built | Browser geolocation → nearest LSOA |
| **Time series** | Static snapshot | Showing year-on-year change in risk scores per area |

---

## 8. How to Talk About This in a Showcase

**Framing**: *"I reverse-engineered the territorial component of motor insurance pricing using open government data, then validated it against real published market premiums."*

**Key talking points**:
1. **Problem framing** — Territory rating is the single biggest geographic component of a motor premium. It's a well-understood actuarial concept. I wanted to see how well you could reconstruct it from freely available data.
2. **Spatial design** — Chose LSOAs (4,881 in London) as the unit because it's the intersection of granularity and data availability. Postcode-level would be too sparse; borough-level loses the within-borough variation that makes territory rating interesting.
3. **Model validation** — The R² of 0.91 against real WTW premiums is the headline number. All four factors have the expected positive sign — the model isn't just fitting noise.
4. **The density finding** — The market-implied weights suggest population density (58%) is far more predictive than our expert prior (12%). That's a genuine insight from the calibration, not just confirming what we assumed.
5. **Limitations** — Be upfront: 16 calibration points is small; this is a territorial proxy, not a per-individual model; the WTW index is at coarser grain than the LSOA model. Knowing the limitations of your own model is what distinguishes a data scientist from someone who just ran some code.
6. **Stack** — End-to-end: Python ETL pipeline → geospatial joins → OLS regression → FastAPI → React/MapLibre interactive map → Docker deployment.
