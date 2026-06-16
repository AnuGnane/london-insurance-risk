# Model Review — Full State Analysis

Date: 2026-06-16 · Branch: `uk-expansion` · Reviewer pass on the GB expansion.

This is an honest, evidence-grounded audit of **what the model actually does**, **how it was
validated**, **whether the methodology holds across England/Wales/Scotland**, and **where to invest
next**. Every claim here is checked against the code and the produced data (`data/processed/lsoa_risk.parquet`,
`reports/calibration.json`), not assumed.

---

## 0. TL;DR

- The headline **R² = 0.917 is NOT the risk index's accuracy.** It's the fit of a *separate* premium
  regression at coarse (region/postcode-area) grain on **England + Wales only**, 22 areas. The risk
  index itself is validated only by a **Spearman rank of 0.757** against premiums.
- There are effectively **two decoupled models** in the repo that only correlate **0.69** with each
  other: the `risk_index` (expert-weighted percentiles) and the `calibrated_premium` (OLS on raw
  features). Users see both; they don't know they're different constructs.
- **Scotland has no premium at all** — all 6,976 Scottish areas return `calibrated_premium = NULL`
  (a NaN-propagation through the crime term). ~17% of GB is unpriced.
- The premium model **extrapolates wildly at LSOA grain**: produced range £82–£4,788 vs a calibration
  range of £455–£1,815. **18% of E+W LSOAs (6,130) price below the calibration floor**, 215 above the
  ceiling. The extremes are artefacts (commercial LSOAs with tiny resident denominators; single-tower
  density outliers), not signal.
- `road_casualties` is **statistically dead and wrong-signed** (coef −10.5, p=0.45, LSOA corr 0.04 with
  premium) yet carries the **second-largest expert weight (0.30)** in the risk index.
- What's genuinely good: a clean config-driven pipeline, correct within-nation deprivation ranking,
  honest NaN handling, and a validation ladder (CV / leave-one-area-out / temporal back-test / sign
  checks / clustered SEs) that is well above hobby-grade.

---

## 1. What the model is, precisely

There are **two outputs**, built differently. This distinction is the single most important thing to
internalise.

### 1a. `risk_index` (0–100) — the map's colour
- Built in `build_risk_index.composite()`.
- = weighted mean of **percentile-normalised** features, using **expert weights** from `config.yaml`:
  `vehicle_crime 0.40, road_casualties 0.30, deprivation 0.18, population_density 0.12`.
- For Scotland (no crime), weights are **reweighted per row** over the 3 present features.
- **Validation:** none directly, except its rank correlation with premiums (Spearman 0.757).
  The weights are judgement calls, not fitted.

### 1b. `calibrated_premium` (£) — the detail panel's number
- Built in `build_risk_index.add_calibrated_premium()` from `reports/calibration.json` coefficients.
- = `const + Σ (OLS coef × raw feature)`. **Raw** units (crime per 1k, casualties per 1k,
  deprivation 0–1, density per km²) — *not* the percentile features the index uses.
- Coefficients come from `calibrate.py`: a panel OLS of WTW premiums on **population-weighted,
  postcode-area-grain** features.
- **Validation:** the R²/CV/MAE ladder below.

> The map colours by 1a; the £ figure on click is 1b. They are different models. They agree only
> moderately (corr 0.69). Neither is "the" calibrated risk score.

---

## 2. How it was tested (answering "was it just WTW/Confused?")

**Yes — the only ground-truth anchor is the WTW / Confused.com price index.** There is one external
source of "real premiums," transcribed into a 137-row panel (`data/manual/wtw_anchors_panel.csv`),
much of it from press write-ups of the index (`source_type=press`). No second independent anchor.

The validation *ladder* applied to that single anchor (in `calibrate.fit_calibration`) is:

| Test | Result | What it tells you | Caveat |
|---|---|---|---|
| Panel OLS R² (quarter FE, area-clustered SE) | **0.917** | In-sample fit | Quarter FE absorbs the time trend; only 22 areas |
| Ridge 5-fold CV-R² | **0.890** | Out-of-fold fit | Folds are random rows, not held-out areas |
| Leave-one-**area**-out MAE | **£113** | Generalisation to unseen areas | Only 22 areas; coarse grain |
| Temporal back-test MAE (predict next quarter) | **£149** | Forward stability | |
| Spearman(risk_index, premium) | **0.757** (p≈1e-18) | Does the *index* rank like the market? | This is the *only* test of `risk_index` |
| Coefficient sign checks | 3/4 sensible | Sanity | `road_casualties` fails |

**The honest read:** the *premium regression* fits the *coarse WTW panel* well (R² 0.92), and predicts
held-out **regions** to ~£113. But:
- The panel is **94 obs / 22 areas / 10 quarters**, and **57 of 94 (61%) are region rollups** built
  from a **hand-curated 8-region → postcode-area map** (`REGION_POSTCODE_AREAS`). The effective spatial
  degrees of freedom are ~8 regions + a few towns. R² 0.92 across 8 well-separated regions × a strong
  national time trend is *expected*, not impressive.
- It validates the **premium**, at **region grain**, in **E+W**. It says **nothing** about per-LSOA
  accuracy, and **nothing** about Scotland.

---

## 3. Issues found (evidence-based, prioritised)

### P0 — correctness

**3.1 Scotland is entirely unpriced.**
`add_calibrated_premium` computes `const + coef·vehicle_crime + …`. Scotland's `vehicle_crime` is NaN,
so the whole sum is NaN. Verified: **6,976 / 6,976 Scottish areas have `calibrated_premium = NULL`.**
The risk index reweights around the gap; the premium does not. Either impute, drop the crime term for
Scotland, or surface an explicit "no premium (no crime data)" state.

**3.2 The premium model extrapolates far outside its training support.**
Fit on smoothed postcode-area/region averages (£455–£1,815); applied to **raw LSOA features**:

| | Calibration support | Produced at LSOA grain |
|---|---|---|
| Premium range | £455 – £1,815 | **£82 – £4,788** |
| Below floor | — | **6,130 LSOAs (18%)** |
| Above ceiling | — | **215 LSOAs** |

The extremes are artefacts of applying linear coefficients in raw units to LSOA-level outliers:
- **Solihull 009A → £4,788**: `vehicle_crime = 226/1k`. A commercial LSOA — crime divided by a tiny
  *resident* population explodes. £4,395 of the £4,788 is the crime term alone.
- **Tower Hamlets 032D → £3,931**: `vehicle_crime = 0`, but `density = 94,360/km²` (a single-block
  LSOA). The linear density term (0.036 × density) alone contributes £3,397, extrapolated far beyond
  any density seen in the smoothed training data.

Root cause: the regression is in **raw feature units** but the panel features are population-weighted
*averages* (compressed), while LSOAs have heavy right tails. Fitting on **percentile/standardised**
features — the same transform the index uses — would bound this and make coefficients comparable.

**3.3 `road_casualties` is dead weight and wrong-signed.**
Coef −10.5, **p = 0.45**, LSOA correlation with premium **0.04**. Statistically it is noise at this
grain, and it enters the premium with a *negative* sign (more casualties → lower premium). Yet it
carries **0.30** — the second-highest expert weight — in the risk index. This is the biggest single
mismatch between what the model bets on and what tracks premiums.

### P1 — methodology

**3.4 Expert weights and reality disagree on every feature.**

| Feature | Expert weight | Back-fit (standardised) | OLS p-value |
|---|---|---|---|
| vehicle_crime | 0.40 | 0.25 | 0.004 ✓ |
| road_casualties | 0.30 | **0.05** | 0.45 ✗ |
| deprivation | 0.18 | 0.22 | 0.063 |
| population_density | 0.12 | **0.48** | 3.7e-11 ✓ |

`population_density` does **half** the predictive work but gets the **smallest** expert weight. The
model is, to a large degree, a proxy for **urbanness**. Worth deciding deliberately: is this a *claims-
risk* index or an *urban-density* index?

**3.5 The two models should be reconciled.** Either (a) calibrate the **risk_index directly**
(`premium ~ risk_index`) so the headline number is the validated one, or (b) make the **premium** the
headline and demote `risk_index` to a diagnostic. Right now both are shown with equal authority and
only one is (loosely) validated.

**3.6 Multicollinearity.** statsmodels flags condition number **1.3e5**. deprivation/density/crime are
correlated; the deprivation coefficient is large but only p=0.06 with a huge SE. The OLS coefficients
are individually unstable — another reason to report the **ridge** coefficients for the production
premium rather than raw OLS.

**3.7 Vintage mismatch.** Premium panel 2023-Q3→2026-Q1 · crime = latest 36 months · STATS19 = 2021–24
· deprivation = 2019/2020 · population = England mid-2015 but Wales/Scotland 2011 Census. The
England-vs-rest population gap (~4 years of growth) biases per-capita rates and density *across the
border*.

---

## 4. Cross-border methodology validity (England / Wales / Scotland)

This was a specific question. Summary verdict: **deprivation handling is sound; everything else has a
Scotland-shaped hole.**

| Feature | England | Wales | Scotland | Cross-border verdict |
|---|---|---|---|---|
| **deprivation** | IoD2019 | WIMD2019 | SIMD2020v2 | ✅ **Sound** — ranked *within* each nation to a 0–1 percentile before combining (the correct call). ⚠️ But the *premium coefficient* on it is E+W-fit and assumed to transfer. |
| **vehicle_crime** | ✓ | ✓ | ✗ NaN | ❌ Not available for Scotland (data.police.uk has no coverage). Index reweights; premium breaks (§3.1). |
| **road_casualties** | ✓ (DfT LSOA) | ✓ (DfT LSOA) | ✓ via **spatial join** | ⚠️ Comparable in principle, but Scotland's casualties depend on a point-in-Data-Zone join whose accuracy is **untested** (boundary points, multi-island zones). |
| **population_density** | ✓ | ✓ | ✓ | ✅ Geometric, comparable — but see population vintage below. |
| **population base** | mid-2015 | 2011 Census | 2011 Census | ⚠️ England is ~4 years newer → density and all per-capita rates are on a slightly different denominator across the border. |
| **calibrated_premium** | ✓ | ✓ | ✗ NULL | ❌ No Scottish premium; coefficient transfer to Scotland never validated (no Scottish anchor in the panel). |

**The within-nation percentile for deprivation is the right design** and is correctly implemented.
The cross-border weakness is concentrated in **Scotland**: missing crime, an untested casualty join, an
older-vs-newer population denominator, and a premium that is both null *and* (would be) built from a
coefficient vector fit without a single Scottish observation.

---

## 5. More pertinent data that exists (worth ingesting)

### Risk features (claims-relevant, currently missing)
- **Young-driver share / age structure** — Census 2021 (E+W, TS007) & **Scotland Census 2022** (TS).
  Age 17–24 density is one of the strongest real premium drivers and is entirely absent.
- **Car / vehicle ownership** — Census KS/TS (cars per household). Exposure and theft-target density.
- **Urban/rural classification** — ONS (E+W) & Scottish Gov 6-fold. Captures the density effect more
  robustly than raw `persons/km²` and would tame the §3.2 density outliers.
- **Flood risk** — Environment Agency (England), NRW (Wales), **SEPA** (Scotland) flood zones.
  Comprehensive cover prices flood directly; not represented at all.
- **Traffic volume (AADT)** — DfT. A far better *exposure denominator* for both collisions and crime
  than residential population (fixes the Solihull-style commercial-LSOA blow-ups in §3.2).
- **Scotland crime** — **Police Scotland / "Recorded Crime in Scotland" (gov.scot)** publish recorded
  crime by local authority and SIMD. Categories differ from data.police.uk, but this could close the
  single biggest cross-border gap. (Local-authority grain, so would need disaggregation.)
- **Uninsured-driving rates** — Motor Insurers' Bureau publish area statistics; a strong premium
  correlate and conceptually independent of the existing features.

### Calibration anchors (to reduce reliance on one transcribed index)
- **ABI Average Premium Tracker** — quarterly, national + some regional. A second independent series.
- **MoneySuperMarket / Compare the Market price indices** — also published (press), region grain.
- Reality check: **no public LSOA-level premium exists** (commercially sensitive). The region/postcode-
  area grain ceiling is **structural**, not a gap you can ingest your way out of. More rows mainly help
  by reducing dependence on the hand-curated 8-region map and adding Scottish/other-region anchors.

---

## 6. What's gone well

- **Architecture.** Config-driven (weights, years, footprint all in `config.yaml`), one module per
  source, pure functions for the math, slim/gzipped GeoJSON, Dockerised, 10 passing tests, ruff-clean.
- **Within-nation deprivation percentile** — the methodologically correct way to combine three
  incompatible national indices. Well implemented.
- **Honest missing-data handling** — NaN vs 0 distinction by nation; per-row reweighting; **skips are
  logged, never silent** (`match_panel`).
- **A real validation ladder** — clustered SEs, ridge CV, leave-one-area-out, temporal back-test,
  Spearman, and sign checks. This is genuinely good practice and most of the diagnostics needed to see
  the problems above are *already in the report* (the road_casualties ✗, the back-fit divergence).
- **Hard ingestion problems solved** — Scotland Data Zone Esri-JSON quirk, ArcGIS HTTP-200 errors,
  STATS19 Scotland spatial join.

---

## 7. Recommended roadmap (in priority order)

**P0 — make the numbers defensible**
1. Fix Scotland premium (§3.1): drop the crime term for Scotland *or* impute *or* show an explicit
   "risk index only — no premium" state. Don't ship 6,976 silent NULLs.
2. Bound premium extrapolation (§3.2): fit the premium regression on **percentile/standardised**
   features (same transform as the index), and/or clip predictions to the calibration support, and/or
   fit in **log-premium** space. This is the highest-leverage single fix.
3. Reconcile the two models (§3.5): pick the headline number and label the other a diagnostic.

**P1 — make the model honest about what it measures**
4. Resolve `road_casualties` (§3.3): drop it, switch to KSI-only, or re-grain — don't keep a 0.30
   weight on noise.
5. Report **ridge** (regularised) coefficients for the production premium, not raw OLS (§3.6).
6. Move population to **Census 2021 (E+W) / 2022 (Scotland)** for a consistent denominator (§3.7).

**P2 — extend coverage and signal**
7. Add young-driver share, car ownership, urban/rural class, flood risk (§5).
8. Fill the Scotland crime gap from Police Scotland recorded crime (§5).
9. Broaden calibration anchors (ABI tracker) and add Scottish/under-represented region rows to cut
   reliance on the curated 8-region map (§2, §5).

---

## 8. Decisions (2026-06-16)

Resolved with the user:

1. **Model purpose → premium estimator.** The calibrated premium is the headline; calibrate the index
   directly against premiums. Density dominating the fit is acceptable for this purpose.
2. **Scotland → ingest Police Scotland recorded crime first** (gov.scot "Recorded Crime in Scotland",
   local-authority/SIMD grain → disaggregate to Data Zone) so Scotland gets a *real* premium, rather
   than imputing or shipping premium-less.
3. **Start the P0 fixes now**: Scotland NULL premium, bound the premium extrapolation, reconcile the
   two models so premium is primary.

### Working plan

- **P0-a — Premium basis refit (foundational).** Re-fit the premium on a feature basis that bounds
  LSOA-grain extrapolation (percentile normalisation hard-caps to the index's 0–100 scale, killing the
  Solihull/Tower-Hamlets blow-ups), and derive the index weights from the fitted coefficients so the
  index and premium become one construct. Empirically compare raw / standardised / percentile / log
  bases on R², CV, MAE *and* resulting LSOA range before committing.
- **P0-b — Scotland crime ingest.** New `src/ingest/` path for Police Scotland recorded crime;
  disaggregate LA→Data Zone (likely population- or SIMD-weighted); plug into the refit so Scotland
  gets a bounded premium.
- **P0-c — Reconcile + re-present.** Make premium the headline in API/frontend; risk index becomes the
  diagnostic/driver breakdown. Re-run the validation ladder including Scotland.
- **P1 follow-ups** (road_casualties, ridge coefficients, population vintage) per §7.

---

## 9. Resolution log (2026-06-16)

All three P0 items are **done**. New headline numbers: Panel R²=0.909, CV-R²=0.889, LOAO MAE £108,
Spearman(predicted, actual premium)=0.974; premium range across all GB ≈ £113–£1,687, **0 nulls**.

| Item | Issue (§) | Resolution |
|------|-----------|------------|
| **P0-a** | Extrapolation £82–£4,788 (§3.2) | Premium now fits on **percentile** features (config `calibration.feature_basis`), which hard-caps to 0–100 — range collapsed to a sane £113–£1,687, 0 LSOAs above the WTW ceiling. Chosen after an empirical bake-off of raw/standardised/percentile/log bases (percentile, casualties-dropped, won on MAE *and* boundedness). |
| **P0-a** | `road_casualties` noise (§3.3) | **Dropped from the premium** (config `calibration.premium_features`); still ingested + shown as a map layer. |
| **P0-b** | Scotland unpriced (§3.1) | New `src/ingest/scotland_crime.py` pulls "Theft of/from a motor vehicle" by council from statistics.gov.scot (SPARQL), disaggregated to Data Zone by population. Crime percentile now ranked **within nation-group** (E+W vs Scotland) since the measures aren't comparable. Scotland fully priced. |
| **P0-c** | Two decoupled models (§3.5) | **Full reconcile**: `risk_index` is now the calibrated premium on a 0–100 (percentile) scale — one construct (corr 0.9995). Map colours by premium quintile, drivers shown as **£ contributions**, `/api/methodology` reports the calibration not expert weights, frontend leads with the £ premium. The old circular Spearman(risk_index, premium) was replaced with Spearman(predicted, actual). |

### Phase 1 update (2026-06-16) — territorial reframe

Implemented per `NEXT_PHASE_DESIGN.md` (branch `phase1-territorial-model`):
- Response switched to a **relative territorial index** (log of area premium ÷ national average) —
  isolates the spatial effect. Panel R²=0.909, LOAO MAE £108, Spearman(pred,actual)=0.974.
- **Demographic controls** added (Census 2021 young-driver share + cars/household, E+W) so place
  features are estimated **net of composition**; three numbers per area (full / place-only / uplift).
- **Significance report** `reports/feature_analysis.md`: the density-dominance finding from §3.4 is now
  quantified — density's univariate r +0.92 collapses to partial +0.27 (VIF 13, mostly collinear),
  while **young-driver share is the strongest independent predictor** (partial +0.52) and deprivation
  is clean (+0.36, VIF 1.8). So the old "76% density" importance was largely collinearity.
- **New limitation surfaced:** at individual-LSOA grain, wealthy-but-central areas (e.g. WC1A) are
  under-priced because deprivation — the dominant clean signal — is low there, while their real
  premiums come from factors not yet modelled. Postcode-area-grain validation (≈2× London/Rugby) is
  sound; LSOA-grain is noisier. Phases 3–4 (traffic, flood, claims-cost proxies) target this gap.

**Still open (now the top caveats):**
- **Density dominates (~0.76 importance).** Dropping casualties + the percentile basis pushed
  population density to ~76% of standardised importance. The model is, candidly, mostly an
  urban-density signal. Acceptable for a premium estimator (per the §8 decision) but not a strong
  "claims/crime" model. Revisit if/when richer features land (§5: young-driver share, car ownership).
- **Scotland coefficient transfer is unvalidated.** Scotland now has a premium, but it rests on
  E+W-fit coefficients with no Scottish WTW anchor in the panel, and the crime feature is council-grain
  (no within-council variation). P2: add Scottish/region anchors; consider SIMD-crime-domain weighting.
- **P1 carried forward:** ridge (not OLS) coefficients for production; population vintage → Census
  2021/2022; broaden calibration anchors (ABI tracker).
