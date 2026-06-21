# Project Technical Overview — GB Car-Insurance Territorial Risk Model

> A study/reference doc for explaining this project in technical interviews (ML / AI
> engineering). Covers: what it is, the end-to-end system, the modelling & maths, the
> decisions made along the way, the honest limitations, and how to pitch it.
>
> **One-line pitch:** *An open-data pipeline that estimates an expected annual
> car-insurance premium for all 41,729 small areas (LSOAs / Data Zones) in Great
> Britain, by calibrating a percentile-feature, log-relative-index regression against
> the published WTW/Confused.com price index — validated with leave-one-area-out and
> temporal back-tests.*

---

## 1. The problem, framed honestly

Insurers price motor cover partly on **where the car is kept** — a territorial
("postcode") risk component. That component is real but opaque. This project rebuilds a
*defensible proxy* for it from public data: not a quote engine (no driver/vehicle
details), but a **territorial risk index reconciled to real money**.

Two things to be precise about, because interviewers will probe them:

1. **What it predicts:** a *relative* territorial premium — how an area compares to the
   GB national average — expressed back in £. It deliberately uses **no individual**
   information (age of *this* driver, *this* car's value, claims history). So it can
   never be a personal quote; it's the *place* term only.
2. **It's applied statistics + data engineering, not deep ML.** The estimator is a
   regularised linear regression. That's a *strength* here (interpretable, auditable,
   hard to overfit on n=106), but don't oversell it as machine learning — own the
   modelling-discipline story instead (Section 10).

---

## 2. End-to-end system architecture

A config-driven Python pipeline (`make` targets), then a static React/MapLibre
front-end baked for GitHub Pages. No live backend in production — the showcase is fully
static.

```
            data.police.uk · STATS19 · IMD/WIMD/SIMD · Census 2021/22 · DfT AADF
            Scotland crime (SPARQL) · ONS boundaries · WTW/Confused price index
                                     │
   M1  ingest/      one module per source ─────────────▶ data/interim/*.parquet
                    (boundaries, imd, police_crime, scotland_crime, stats19,
                     census_demographics, traffic, aadf, wtw_index)
                                     │
   M2  transform/   aggregate_to_lsoa.py  → one row per area_code (LSOA/DZ)
                                     │
   M3  transform/   build_risk_index.py   → percentiles, calibrated premium,
                    (reads calibration.json)  per-driver £ contributions, quintiles
                                     │      → data/processed/lsoa_risk.parquet
                                     │
   M4  calibrate/   wtw_index.py  (anchor panel) + calibrate.py (the regression)
                                     │      → reports/calibration.{json,md}
                                     │        feature_analysis.md
                                     │
   showcase/        bake_static.py  → frontend/public/data/areas.geojson (+ methodology.json)
                                     │   (mapshaper topology-aware simplify → ~6.7 MB gzip)
                                     ▼
                    React + MapLibre GL choropleth (static, GitHub Pages)
```

**Key architectural decisions**

- **One module per data source** with a parquet hand-off — each source is independently
  testable and re-runnable; the interim parquets are the contract between stages.
- **Config as single source of truth** (`config/config.yaml`): geography footprint,
  feature buckets (place / composition / diagnostics), normalisation method,
  calibration settings. You can re-scope London→GB, or move a feature from "driver" to
  "diagnostic", **without touching code**.
- **The risk index and the premium are one construct, not two.** `build_risk_index`
  sets `risk_index = GB-wide percentile of calibrated_premium`. Earlier versions had an
  expert-weighted composite *and* a separate premium that could disagree; reconciling
  them removed a whole class of "why does the colour not match the price?" bugs.
- **Static showcase**: GitHub Pages can't run the FastAPI backend, so the four API
  endpoints were replaced by a baked GeoJSON + client-side postcode lookup
  (postcodes.io) + client-side ranking/point-in-polygon. The local FastAPI app still
  exists for full-fidelity dev.

> ⚠️ **The one foot-gun in this architecture** (you hit it and fixed it): the Makefile
> has no dependency edge from `calibration.json` → `lsoa_risk.parquet`. `make calibrate`
> writes coefficients; `make risk` *consumes* them. Run them out of order (or re-run
> calibrate without re-running risk) and the baked premiums silently reflect *older*
> coefficients than the published methodology. Worth a `make risk` dependency on
> `reports/calibration.json`, or a CI check that recomputes a few premiums from the
> shipped coefficients and asserts they match.

---

## 3. The data layer — the real engineering challenge

The hard part isn't the regression; it's making **three nations' incompatible open
data** comparable on one grain. Highlights worth naming in an interview:

| Challenge | What was done |
|---|---|
| **Different area systems** | England/Wales **LSOA (2011)**, Scotland **Data Zone (2011)** — unified under one `area_code` key, 41,729 areas. |
| **Crime has no Scotland coverage** | `data.police.uk` is E+W only. Scotland's "Recorded Crime" (theft of/from a motor vehicle) is pulled from `statistics.gov.scot` over **SPARQL**, at council grain, then disaggregated to Data Zone by population. |
| **Deprivation is incomparable across nations** | England IoD2019, Wales WIMD2019, Scotland SIMD2020 are separate constructions. Each area is ranked to a **percentile within its own nation** before use — only within-nation ordering is meaningful. |
| **Crime from incomparable sources** | E+W (police.uk) vs Scotland (gov.scot) measure differently → vehicle crime is percentile-ranked **within source-comparable groups** (`ew` vs `scotland`), not pooled. |
| **STATS19 lacks Scottish LSOA codes** | Scottish collisions are assigned a Data Zone by **spatial join** (point-in-polygon) instead of the missing code field. |
| **Traffic exposure** | DfT **point-level AADF** count points averaged within 2 km of each area centroid → a local "road business" intensity (replaced raw density, see §8). |
| **Demographic controls** | Census 2021 (E+W, Nomis) + Census 2022 (Scotland, on 2011 DZ so no crosswalk needed): young-driver share (17–24) and cars/household. |

**Missing-feature handling** is principled, not ad-hoc: `composite()` re-weights per row
over the features that are *present*, so a Scottish area missing a feature is scored from
its remaining features with weights renormalised — never scored as NaN and never
silently treated as zero.

---

## 4. Feature engineering

**Percentile basis (0–100).** Every model feature is transformed to its rank-percentile
(`s.rank(pct=True) * 100`), optionally *within group* (nation or crime-source). Why this
matters and not raw units:

- **Bounds extrapolation.** Raw features blow up the premium on outlier LSOAs
  (commercial areas with tiny resident denominators, single-block density spikes). A
  percentile is bounded to [0,100], so a per-LSOA prediction can't run away. (This is
  `MODEL_REVIEW.md §3.2` — a real bug that motivated the switch.)
- **Cross-nation comparability.** Percentiles make incomparable raw scales (three
  deprivation indices, two crime sources) orderable on one axis.

**Place vs composition split** — the identification idea at the core of the project:

- **Place features** (the territorial drivers we *want* to estimate): `vehicle_crime`,
  `deprivation`, `aadf_intensity`.
- **Composition features** (demographic *controls*): `young_driver_share`,
  `cars_per_household`.

Both go into the regression, but they're reported separately so the place coefficients
are estimated **net of who lives there**. This yields the **three numbers** shown per
area:

- **Full premium** — place + composition.
- **Place-only** — composition controls held at the national median (pct=50): *"what
  this area costs at national-average demographics."*
- **Composition uplift** — full − place-only: the demographic effect.

**Diagnostics** (`traffic_per_capita`, `ksi_collisions_per_billion_vehicle_miles`,
plus legacy `road_casualties`, `population_density`) are ingested and shown on the map
but are **not** premium drivers — they were *evidence-gated out* (§8).

---

## 5. The model & the maths

### 5.1 Response variable

The regression target is the **log of the relative premium index**:

```
premium_index = area_premium ÷ national_avg          (per source × quarter)
y = log(premium_index)
```

Modelling the *relative* index (not absolute £) removes the national price level and the
time trend, isolating the **spatial** effect — which is the whole point. Normalisation is
per **source × quarter**, so a cheaper source (MoneySuperMarket sits well below Confused)
doesn't distort another source's index.

### 5.2 Specification

```
log(premium_index) = const
                   + β1·vehicle_crime_pct + β2·deprivation_pct + β3·aadf_intensity_pct      (place)
                   + β4·young_driver_share_pct + β5·cars_per_household_pct                    (composition)
                   + C(source)                                                                (source FE, when >1 source)
```

- **Estimator:** Panel **OLS** (`statsmodels`) with **area-clustered standard errors**
  (`cov_type="cluster"`, groups = area) — the panel is repeated measures (same area
  across up to 11 quarters), so naive SEs would be overconfident.
- **No quarter fixed effects** — the relative-index response already removes the
  national level/time trend, so quarter FE would be redundant.
- **Source fixed effect** absorbs methodology level differences when a second anchor
  source is pooled.

### 5.3 From log-index back to £

The coefficients are stored with the **latest national average** so premiums can be
reconstructed (this is what `build_risk_index.bake_premium_and_contributions` does):

```
premium(£) = national_avg × exp(const + Σ βᵢ · featureᵢ_pct)
```

with `national_avg = £558.55` (latest quarter). This is a **multiplicative** (log-linear)
model — a percentile-point change scales the premium, it doesn't add a fixed £.

### 5.4 Per-driver £ contributions

The breakdown shown per area is a **counterfactual delta**, not an additive split:

```
contributionᵢ = premium_full − premium(featureᵢ held at median pct=50)
              = premium_full · (1 − exp( βᵢ · (50 − featureᵢ_pct) ))
```

i.e. *"how much £ does this factor add versus a median area?"* Because the model is
multiplicative, these deltas **don't sum exactly** to the premium — that's expected and
worth stating, not a bug.

> **The negative-coefficient gotcha** (you debugged this): `cars_per_household` has a
> *negative* coefficient (−0.0044). Low car-ownership areas are dense/urban with higher
> theft/uninsured exposure, so **low car ownership → higher premium**. An area at the
> 3rd percentile of car ownership is pushed *furthest above* the median, so it can be
> the *biggest* positive £ contributor while rendering near-white on a percentile colour
> ramp. Low percentile and large £ move in opposite directions *by design* — the sign
> is negative.

### 5.5 What "rank #1" actually means

- **Ranking** is by `calibrated_premium` (the reconstructed £).
- **risk_index** = GB-wide percentile of that premium; **quintile** = `qcut` into 5.
- The "reason" chip uses `dominantDriver()` = the driver with the **largest positive £
  contribution** — which is a *different axis* from the largest percentile. (After the
  recent recalibration the top area shifted; the strongest spread driver is
  `young_driver_share`, std-coef back-fit weight 0.44.)

---

## 6. Validation methodology — the part that signals rigour

Calibration runs a full **validation ladder** against the WTW/Confused panel (137-row
multi-quarter, multi-grain). Current headline numbers:

| Metric | Value | What it tells you |
|---|---|---|
| Matched observations | **106** (30 areas × up to 11 quarters) | the *real* sample size — not 41,729 |
| Panel OLS R² (adj) | **0.917 (0.912)** | in-sample fit |
| Ridge K-fold **CV-R²** | **0.887** ± … (α≈2.34) | out-of-sample generalisation |
| **Leave-one-area-out** MAE | **£89** (n=106) | predict each area from the *others* — spatial hold-out |
| **Temporal back-test** MAE | **£74** | fit quarters ≤T, predict T+1 — forward generalisation |
| Spearman(pred, actual) | **0.968** | does it *rank* areas like the market does? |
| Variance decomposition | place-only **0.759** · composition-only **0.884** · full **0.915** | how much is place vs who-lives-there |
| Cross-source (MoneySuperMarket) | independent 2nd anchor | spatial pattern isn't a Confused artefact |

Plus **sanity checks**: predicted spatial multipliers (West-Central London ÷ Rugby ≈
1.94×, City of London ÷ Truro ≈ 2.42×) that match real-world intuition.

**Why each rung exists** (this is the interview gold):

- **Ridge CV** guards overfitting on a small n and reports honest generalisation; the
  α is chosen by `RidgeCV` over a log-spaced grid.
- **Leave-one-area-out** is the strict test: never let an area's own data inform its
  prediction. £89 MAE on a ~£558 average is the credible headline.
- **Temporal back-test** answers a different question (forward in time, not across
  space) — both matter.
- **Spearman** matters because for a *ranking* product, rank fidelity ≥ point accuracy.
- **VIF + partial correlation** (`feature_analysis.md`) decide which features earn a
  place in the model vs stay diagnostics (§8).

---

## 7. Feature significance & selection (evidence-gating)

Features aren't kept by intuition — they pass a **partial-correlation + VIF** gate
(verdict `keep` iff partial-p < 0.05 **and** VIF < 10):

- **young_driver_share** — strongest independent predictor (partial r ≈ +0.57).
- **aadf_intensity** — +0.38, p<1e-4, VIF ≈ 2.3 (a genuine, non-collinear keeper).
- **cars_per_household** — significant, negative (see §5.4).
- **vehicle_crime, deprivation** — keepers.
- **Gated OUT to diagnostics:** `ksi_collisions…` (no independent signal once
  crime/deprivation/density controlled, partial p≈0.44); `traffic_per_capita` (an
  inverse-density proxy, univariate r≈−0.92, VIF≈16, wrong-signed as risk);
  `road_casualties` (insignificant + wrong-signed at panel grain);
  `population_density` (collinear urban-intensity proxy, VIF 13–60).

This gating is the answer to the project's hardest critique — *"isn't this just a density
model?"* — see §8.

---

## 8. Key decisions & how the project evolved

The London→GB story, as a sequence of defensible pivots:

1. **London-only → GB-wide.** Originally one region (E12000007). Generalising required
   the multi-nation data reconciliation in §3 (Scotland's separate crime/deprivation/
   census sources, Data Zones, SPARQL). Config footprint flips `london`→`gb`.

2. **Raw units → percentile basis.** Raw features overshot premiums on outlier LSOAs.
   Percentiles bound extrapolation and make nations comparable. *(MODEL_REVIEW §3.2)*

3. **Absolute £ → relative log-index response.** Modelling £ directly conflates the
   national price level/trend with the spatial effect. The relative index isolates
   space — the actual goal. *(NEXT_PHASE_DESIGN §2.1)*

4. **Expert composite → calibrated regression, then reconciled.** The legacy
   `risk_index` was a hand-weighted average (crime 0.40, casualties 0.30, …). Calibration
   replaced the weights with back-fit coefficients, then `risk_index` was *redefined* as
   the percentile of the calibrated premium — one construct, colour = price.

5. **Density → AADF traffic intensity** *(the headline modelling improvement)*.
   `population_density` was always collinear (VIF 13–60) and invited the "just a density
   model" critique. Replacing it with **point-level AADF** (a direct measure of local
   road business, VIF ≈ 2.3, partial r +0.38) made *every* premium feature an
   independent significant keeper and dropped LOAO MAE to ~£89. Density stays a map
   diagnostic.

6. **Place vs composition decomposition.** Added young-driver share + cars/household as
   *controls* so the place effect is net of demographics — and surfaced the three
   numbers (full / place-only / uplift). Notably **composition-only R² (0.884) > place-
   only R² (0.759)**: at this grain, *who lives there* explains more variance than
   *where* — an honest finding worth volunteering.

7. **Scotland validation (Phase 2).** Once Scotland had all three place features, the
   four Confused Scottish regions could finally *validate* the model rather than being
   skipped (composition held at national mean — Scottish demographics deferred).

8. **Second anchor source (MoneySuperMarket).** Pooled with a source fixed effect for
   independent cross-source spatial corroboration.

**Deferred (and why):** Northern Ireland (no NI crime/collision open source — would carry
only 2 of 4 features); flood risk (Phase 4 scaffold exists, awaiting EA/SEPA/NRW
extents); PMTiles vector tiling (payload optimisation).

---

## 9. Honest limitations (name these before the interviewer does)

- **Validation grain ≠ prediction grain.** The model is *validated* at postcode-area /
  region grain (the panel's grain) but *predicts* at LSOA grain (≈far finer). Validity
  is demonstrated at the coarse grain; per-LSOA numbers are an extrapolation. This is the
  single most important caveat.
- **Small calibration sample.** n=106 obs, 30 areas, 11 quarters. Hence the heavy
  emphasis on CV / LOAO / temporal hold-outs and a *linear* model — not because linear
  is fanciest, but because anything higher-variance would overfit.
- **Ecological / MAUP risk.** Area-aggregate features predicting an area premium;
  individual-level effects can't be inferred (modifiable-areal-unit problem).
- **Anchor is itself a market average,** not ground-truth claims data — the model is
  calibrated to *published index figures*, transcribed and cited per row, with a strict
  no-invented-figures rule.
- **Contributions are counterfactual deltas, not an exact additive split** (multiplicative
  model).
- **Grain caveat in the model card:** wealthy-but-central LSOAs can be under-priced
  because deprivation (a strong clean signal) is low there while real premiums are driven
  by unmodelled factors (vehicle value, congestion, claims cost).

---

## 10. How to pitch this in an ML / AI engineering interview

**The honest positioning.** *"It's an end-to-end applied-ML/data-science system: a
reproducible pipeline that ingests and reconciles messy multi-source open data, engineers
features, fits and **rigorously validates** a regularised regression, and ships it as a
static product. The model is deliberately simple and interpretable because the validation
sample is small — the sophistication is in the data engineering and the validation
discipline, not the estimator."*

**Lead with the ML-transferable skills:**

- **Validation discipline** — train/test separation done *three* ways (K-fold CV,
  spatial leave-one-group-out, temporal back-test). This is exactly the muscle that
  prevents leaking in real ML systems.
- **Regularisation & model selection** — Ridge with CV-chosen α; choosing model
  *complexity to match data size* (bias/variance reasoning on n=106).
- **Feature engineering** — percentile/rank transforms, within-group normalisation,
  bounded features to control extrapolation.
- **Feature selection by evidence** — partial correlation + VIF gating, not gut feel;
  killing the "density model" critique with a measured swap.
- **Causal-ish identification** — relative-index response + composition controls to
  isolate the effect of interest (place), with a clean variance decomposition.
- **Reproducibility & MLOps-lite** — config-driven, `make`-target pipeline, artifact
  hand-offs, a model card (`calibration.md` / `methodology.json`), and you *caught a
  real train/serve-style skew bug* (stale coefficients in the served artifact) by
  recomputing predictions from published parameters — exactly the kind of monitoring a
  production ML system needs.

**Likely probing questions + crisp answers:**

| They ask | You say |
|---|---|
| *"Why not a gradient-boosted model / neural net?"* | n=106 matched observations. A high-variance learner would overfit; a regularised linear model is the right bias/variance point, and it's auditable — which matters for a pricing-adjacent product. I'd reach for GBMs only with claims-level data (10⁴–10⁶ rows). |
| *"Isn't 0.917 R² suspiciously high?"* | In-sample, yes — that's why the honest numbers are CV-R² 0.887 and LOAO MAE £89. And it's validated at coarse grain, then extrapolated to LSOA. |
| *"Is this just a density model?"* | It was a fair critique of the v1. I replaced density (VIF 13–60) with point-level AADF (VIF 2.3); now every feature is an independent, significant keeper, and LOAO MAE improved. |
| *"How do you know it's not overfit to Confused.com?"* | Cross-source check against MoneySuperMarket (pooled with a source FE) reproduces the same spatial ordering — the pattern isn't a single-source artefact. |
| *"What would you do next?"* | Calibrate on claims-level or quote-level data to lift validation to the prediction grain; add flood (Phase 4); PMTiles for payload; a CI guard so served premiums can't drift from published coefficients. |

**Two-minute narrative arc:** problem (opaque territorial pricing) → data (reconcile 3
nations of open data) → feature engineering (percentiles, place vs composition) →
model (log-relative-index regression) → validation (the ladder) → product (static GB
map) → the honest caveat (validation grain) and what's next.

---

## 11. Quick-reference numbers

- **41,729** areas mapped · **30** calibration areas · **106** matched obs · **11**
  quarters · **137**-row anchor panel.
- **R² 0.917** (adj 0.912) · **CV-R² 0.887** · **LOAO MAE £89** · **temporal MAE £74**
  · **Spearman 0.968**.
- Variance: place-only **0.759**, composition-only **0.884**, full **0.915**.
- National average premium **£558.55**; current premium range **£193–£1,542**.
- Coefficients (log-index): const −0.724; vehicle_crime +0.0014; deprivation +0.0034;
  aadf_intensity +0.0039; young_driver_share +0.0094; cars_per_household **−0.0044**.
- Back-fit importances: young_driver 0.44, cars 0.24, aadf 0.17, crime 0.09, deprivation 0.08.

---

*Source files to re-read before an interview: `src/calibrate/calibrate.py` (the model +
validation ladder), `src/transform/build_risk_index.py` (premium reconstruction +
contributions), `config/config.yaml` (feature buckets & settings), `MODEL_REVIEW.md` and
`NEXT_PHASE_DESIGN.md` (the design rationale), `reports/calibration.md` (the model card).*
