# Data Provenance & Transformations — GB Territorial Risk Model

> How every input was sourced, why it was chosen, and exactly what transformation and
> normalisation turned it into a model feature. Companion to
> `PROJECT_TECHNICAL_OVERVIEW.md` (which covers the model) — this doc is the **data
> engineering** story.
>
> **Reading order:** §1 the design principles that govern *all* sources → §2 each source
> in detail → §3 the normalisation layer → §4 the feature table → §5 the data-quality
> ledger.

All sources are **Open Government Licence v3.0** (or OGL-compatible public statistics).
The grain target throughout is one row per **small area** (`area_code`): an **LSOA
(2011)** in England & Wales, a **Data Zone (2011)** in Scotland — 41,729 areas total.
Working CRS is **EPSG:27700** (British National Grid, metres) for all spatial maths;
**EPSG:4326** only for final map output.

---

## 1. Cross-cutting design principles

Five rules govern how *every* source is handled. They exist because the data is
genuinely heterogeneous (three nations, three statistical agencies, incompatible
scales), and naively concatenating it would produce a garbage model.

1. **Rank within comparable groups, never across them.** Deprivation indices and crime
   measures are constructed differently per nation/source. Absolute values are *not*
   comparable across borders, so each area is converted to a **percentile within its own
   comparable group** before the model sees it (nation for deprivation; source-group
   `ew`/`scotland` for crime). Only the *within-group ordering* is treated as signal.
2. **Distinguish "true zero" from "missing."** A vehicle-crime count of 0 in an English
   LSOA is a real zero; the same blank in a nation with *no crime source* is missing
   (NaN). They're handled differently — true zeros stay 0; genuine gaps stay NaN so the
   index can **reweight** around them rather than scoring the area as crime-free.
3. **Rates, not counts.** Raw counts confound size with intensity. Everything is
   normalised to a **per-capita (or per-area, or per-vehicle-mile) annual rate** before
   ranking, with explicit denominators and time windows.
4. **Be honest about disaggregation.** Where a source is published coarser than the
   model grain (Scottish crime at council level, traffic at local-authority level), it's
   spread to small areas **by population share** — which adds between-unit variation but
   *no within-unit variation*, and that limitation is documented, not hidden.
5. **Pure functions + parquet hand-offs.** Each ingest module is independently runnable
   and unit-testable; the interim parquet is the contract between stages. No stage
   reaches back into another's internals.

---

## 2. Sources, one by one

### 2.1 Boundaries — the spatial backbone
- **Source:** ONS Open Geography Portal (E+W LSOA 2011, BGC clipped, ArcGIS REST) +
  Scottish Government `maps.gov.scot` (Data Zone 2011). `src/ingest/boundaries.py`.
- **Why:** 2011 vintage is the lowest common denominator that matches IMD 2019 and
  Scotland's DZ geography — picking a single vintage avoids crosswalk error.
- **Transform:** fetch paginated ESRI features → repair ESRI ring winding into valid
  polygons → unify into one schema (`area_code`, `nation`, `area_type`, `area_km2`,
  `geometry`) → compute `area_km2` in EPSG:27700 → repair invalid geometries.
- **Output:** `area_boundaries.parquet` (geometry, EPSG:27700). This is the master area
  list every other feature left-joins onto.

### 2.2 Deprivation — three indices, one comparable feature
- **Source:** England **IoD2019** (MHCLG File 7), Wales **WIMD2019** (Welsh Gov ArcGIS,
  population via NOMIS KS101EW), Scotland **SIMD2020v2** (NHS Scotland open data,
  population via DZ `totpop2011`). `src/ingest/imd.py`.
- **Why ranks, not scores:** the three indices are on different scales and methodologies
  — they cannot be pooled. What *is* meaningful is each area's **rank within its nation**.
- **Normalisation (the key line):**
  ```
  deprivation_pct = (n − deprivation_rank) / (n − 1)        # 0–1, higher = more deprived
  ```
  where `n` is the nation's area count and rank 1 = most deprived. This **within-nation
  percentile** is the single cross-border-comparable deprivation feature the model uses.
- **Also yields population**, which becomes the denominator for crime and density.

### 2.3 Vehicle crime (England & Wales) — point data with codes
- **Source:** `data.police.uk` bulk archive (one S3 zip = ~36 months for all E+W forces
  + BTP). `src/ingest/police_crime.py`.
- **Why this category:** "vehicle-crime" is the closest open analogue to the territorial
  theft/break-in risk that drives premiums. 36 months (vs the original 12) smooths
  seasonality. Each CSV row already carries an LSOA code → **no spatial join needed**.
- **Filter:** keep only E/W LSOAs (drop stray BTP rows referencing other nations, which
  would give those nations a misleadingly tiny count).
- **Rate transform** (`compute_vehicle_crime_rate`):
  ```
  vehicle_crime = crime_count / max(population, 1) × 1000 / (months_back / 12)
                = incidents per 1,000 residents per year
  ```

### 2.4 Vehicle crime (Scotland) — closing the coverage gap via SPARQL
- **Source:** `statistics.gov.scot` "Recorded Crime in Scotland" linked-data cube,
  queried over **SPARQL** for "Theft of a motor vehicle" + "Theft from a motor vehicle".
  `src/ingest/scotland_crime.py`.
- **Why it exists:** `data.police.uk` has *zero* Scottish coverage — without this,
  Scotland couldn't be priced at all.
- **Grain reality + honest disaggregation:** Scotland publishes recorded crime only at
  **local-authority** (32 councils), not Data Zone. Each council's count is spread to its
  Data Zones **by population share** (every DZ in a council inherits the council's
  per-capita rate). Two SPARQL queries: counts-by-council (latest year picked
  client-side) and a DZ→council best-fit lookup. *Adds between-council variation, no
  within-council variation* — documented as a known limitation.
- **Comparability:** Scottish "theft of/from a motor vehicle" is a narrower, differently
  recorded measure than the E+W category, so the absolute rates are **not** cross-border
  comparable — which is exactly why crime is percentile-ranked *within source-group* (§3).

### 2.5 Road collisions (STATS19) — severity weighting + spatial join
- **Source:** DfT STATS19 Road Safety Data (GB, years from `config.data_years`).
  `src/ingest/stats19.py`.
- **Severity weighting:** DfT codes (1=fatal, 2=serious, 3=slight) → config weights
  **slight 1, serious 3, fatal 8** (a fatal collision counts 8× a slight one), reflecting
  relative claims severity.
- **Scotland fix:** STATS19's `lsoa_of_accident_location` is populated for E+W only
  (Scotland rows carry `-1`). Those rows get an `area_code` via a **point-in-polygon
  spatial join** (`gpd.sjoin(..., predicate="within")`) onto the boundaries — so Scottish
  Data Zones receive their casualties.
- **Two features derived** (`aggregate_to_lsoa`):
  - `road_casualties = Σ severity_weight / pop × 1000 / n_years` (a **diagnostic**).
  - `ksi_collisions_per_billion_vehicle_miles` = fatal/serious count on the DfT traffic
    denominator (a **diagnostic** — gated out of the premium, §7 of the model doc).

### 2.6 Traffic exposure (DfT, local-authority) — the v1 that got demoted
- **Source:** DfT road-traffic downloads, LA annual traffic (million vehicle miles).
  `src/ingest/traffic.py`.
- **Transform:** mean over configured years per LA → allocate to areas **by population
  share** within each LA → `traffic_per_capita`.
- **Outcome:** this became a **diagnostic, not a driver** — `traffic_per_capita` is an
  inverse-density proxy (rural through-roads/motorways score highest; univariate r≈−0.92,
  VIF≈16, wrong-signed as a risk driver). It motivated the move to point-level AADF.

### 2.7 Traffic intensity (DfT, point-level AADF) — the v2 that replaced density
- **Source:** DfT count-point AADF (`dft_traffic_counts_aadf.zip`, ~22k GB count points).
  `src/ingest/aadf.py`.
- **Why:** to separate *"how busy are the roads where you live"* (genuine exposure) from
  *"how many people live here"* (density) — the signal LA-traffic couldn't isolate.
- **Transform (spatial, metric):**
  - Pool the configured years, take each count point's **mean AADF** (DfT only physically
    counts a subset each year; the rest are modelled).
  - Build a **`scipy.spatial.cKDTree`** over count-point eastings/northings (already
    EPSG:27700 — no reprojection).
  - For each area centroid: `aadf_intensity` = **mean AADF of all points within 2 km**;
    areas with none fall back to their **single nearest** point (so coverage is complete).
    `aadf_points_within` records how many points informed it (0 = fallback).
- **Outcome:** an independent, significant **place driver** (partial r +0.38, VIF≈2.3) —
  this is what killed the "it's just a density model" critique.

### 2.8 Demographic controls (Census) — composition, not place
- **Source:** E+W **Census 2021** via Nomis (TS007A age bands, TS045 car availability);
  Scotland **Census 2022** via UK Data Service (UV103 age by single year, UV405 cars).
  `src/ingest/census_demographics.py`.
- **Why composition controls:** including `young_driver_share` (17–24) and
  `cars_per_household` in the regression lets the **place** coefficients be estimated
  *net of who lives there* (the identification strategy).
- **Transforms with honest approximations:**
  - **Young-driver share:** Scotland uses **exact** single-year counts (17–24 ÷ 17+).
    E+W only has 5-year bands, so the 17–24 share uses a **uniform-within-band split** of
    the 15–19 band (ages 17,18,19 ≈ 3/5 of it). Fine for a percentile-ranked control.
  - **Cars per household:** household-weighted mean, **capped at 3+** in both nations.
  - **Vintage seam:** Scotland's 2022 tables are published on **2011 Data Zones** (no
    crosswalk needed — they merge directly). E+W Census 2021 is on **2021 LSOAs** while
    the model keys on **2011 LSOAs**; ~93% of codes are unchanged and merge, the rest are
    left NaN and **held at the national mean** in premium reconstruction.

### 2.9 The calibration anchor (WTW/Confused + MoneySuperMarket)
- **Source:** WTW/Confused.com Car Insurance Price Index (transcribed quarterly,
  **cited per row**, strict no-invented-figures rule) + MoneySuperMarket published
  regional figures (London/Scotland/Wales). `src/calibrate/wtw_index.py`, panel CSV.
- **Role:** this is the **label** the model calibrates to — a 137-row multi-quarter,
  multi-grain panel (region / postcode-area / town). It is *not* a feature; it's the £
  ground-truth the territorial index is regressed against (see model doc §5–6).

---

## 3. The normalisation layer — turning features into model inputs

Two distinct normalisations happen at different stages. Keeping them straight is a common
interview stumble, so be precise:

**(a) Feature normalisation — percentile, in `build_risk_index.normalise()`**
```python
if method == "percentile":
    return s.rank(pct=True) * 100          # → 0–100
```
- Every model feature is converted to its **GB-wide rank-percentile (0–100)** —
  *except* the two that rank **within a group**:
  - `deprivation` is already a within-nation percentile from ingest (§2.2).
  - `vehicle_crime` is ranked **within source-group** (`ew` vs `scotland`) at this stage,
    via `groupby(...).transform`, because the two crime sources are incomparable.
- **Why percentile and not raw / z-score / min-max:** percentiles are **bounded [0,100]**,
  which prevents a single outlier LSOA (a commercial area with a tiny resident
  denominator, a one-block density spike) from blowing up its premium. Raw units
  overshoot badly on the long tail; this was a real bug (`MODEL_REVIEW.md §3.2`).

**(b) Response normalisation — relative index, in `calibrate.to_relative_index()`**
```
premium_index = area_premium ÷ national_avg      (per source × quarter)
y = log(premium_index)
```
- The *target* is divided by the national average so the model learns the **spatial**
  deviation, not the national price level or time trend. Per **source × quarter** so a
  cheaper anchor source doesn't distort another's index.

**(c) Missing-feature reweighting — in `composite()` / premium reconstruction**
- The legacy composite re-weights per row over **present** features (so an area missing
  one feature is scored from the rest with weights renormalised).
- In premium reconstruction, a missing **composition control** is **held at the national
  median (pct=50)** — so the area simply equals its place-only premium rather than
  dropping out.

---

## 4. The feature table — where it all converges

`aggregate_to_lsoa.py` (M2) left-joins every source onto the boundary master list,
producing one row per `area_code`:

| Feature | Bucket | Units (pre-percentile) | Source(s) |
|---|---|---|---|
| `vehicle_crime` | place | incidents / 1k pop / yr (within-source ranked) | police.uk (E+W) · gov.scot SPARQL (S) |
| `deprivation` | place | within-nation percentile 0–1 | IoD2019 / WIMD2019 / SIMD2020v2 |
| `aadf_intensity` | place | mean AADF within 2 km | DfT count points |
| `young_driver_share` | composition | share of 17–24 | Census 2021 (E+W) / 2022 (S) |
| `cars_per_household` | composition | mean, capped 3+ | Census 2021 (E+W) / 2022 (S) |
| `road_casualties` | diagnostic | severity-wtd / 1k pop / yr | STATS19 |
| `ksi_..._per_billion_vehicle_miles` | diagnostic | KSI / traffic | STATS19 + DfT traffic |
| `traffic_per_capita` | diagnostic | traffic / resident | DfT LA traffic |
| `population_density` | diagnostic | persons / km² | population + boundary area |

Then `build_risk_index.py` (M3): adds `{feature}_pct` (percentiles) and `{feature}_val`,
reads `calibration.json`, and bakes `calibrated_premium`, `premium_place_only`, the
per-driver `{feature}_contrib` £ deltas, `risk_index` (= GB percentile of the premium)
and `quintile`.

---

## 5. Data-quality ledger (state the caveats before you're asked)

- **Scottish crime disaggregation** adds only between-council variation (council→DZ by
  population). The cleanest known refinement is to weight by the SIMD crime domain.
- **Crime cross-border incomparability** is handled by within-source ranking — the E+W
  and Scottish crime numbers are *never* compared on an absolute scale.
- **E+W demographic vintage seam** (2021 census on 2011 model keys): ~93% match; the rest
  are NaN → held at national mean. A 2011↔2021 best-fit lookup is the documented fix.
- **AADF**: DfT counts a subset of points yearly (rest modelled); pooling years + nearest
  fallback gives complete coverage but rural areas may lean on a single distant point
  (`aadf_nearest_m` records the distance for auditing).
- **Traffic_per_capita / KSI / density / road_casualties** are **diagnostics**, shown on
  the map but evidence-gated out of the premium (partial-correlation + VIF, see model doc).
- **Northern Ireland** is excluded: no NI open crime source and STATS19 omits NI, so an NI
  area would carry only 2 of 4 features.
- **The anchor is a market average**, transcribed and cited — not claims data. The model
  calibrates to published index figures, with a no-invented-figures rule.

---

*Code references: `src/ingest/{boundaries,imd,police_crime,scotland_crime,stats19,traffic,aadf,census_demographics}.py`,
`src/transform/aggregate_to_lsoa.py`, `src/transform/build_risk_index.py`, `config/config.yaml`.*
