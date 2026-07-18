# Next-Phase Design — Isolating the Territorial Premium Effect

Date: 2026-06-16 · Status: **draft for review** (brainstorming output; not yet planned/implemented).
Companion to `MODEL_REVIEW.md` (audit + P0 resolution log).

---

## 1. Goal (reframed)

Answer one question well: **how does a postcode/area affect a person's car-insurance premium,
holding the driver constant?** The motivating case is real — the same person paying ~£7k in London
and ~£2k in Rugby. We want to isolate the **place** effect and net out **who lives there**, using
only measurable, comparable open data, and to be explicit about which factors are statistically
significant.

Output per GB area: an **expected territorial premium** and a breakdown of how much each *place*
factor contributes, with demographic composition estimated separately (not folded into the headline).

### The core problem this design solves

Every public premium anchor (Confused/WTW, MoneySuperMarket, ABI) is the **average premium of whoever
actually quotes in each area** — it blends *place* (crime, traffic, repair cost, flood) with *people*
(local age mix, vehicles, claim behaviour). To measure the place effect "independent of age," the
correct move is **not** to omit demographics but to **include them as controls** — otherwise their
effect leaks into the place coefficients (areas with more young drivers also have more crime). We
therefore model premium on *place features + demographic controls*, and report the two buckets
separately: **"place effect"** vs **"composition effect."**

### Honest limits (unchanged from MODEL_REVIEW)

- No public premium data exists below postcode-area/town grain, and quote-scraping is prohibited
  (AGENTS.md). **Validation stays capped at postcode-area/town**; LSOA-level numbers are predictions.
- What we *can* validate is the **spatial multiplier** between areas (e.g. WC London ~£1,349 vs
  cheapest towns ~£438 ≈ 3×), not an absolute personal quote like the £7k.

---

## 2. Methodology

### 2.1 Response variable — a relative territorial index

Switch the regression target from absolute £ to a **relative territorial index**:

```
territorial_index = area_average_premium / national_average_premium   (per quarter)
```

This directly expresses "how many times the national average this area costs" — the spatial effect we
care about — and removes the national level/time trend by construction. We model `log(territorial_index)`
(symmetric, strictly positive). For display, £ is reconstructed: `premium_£ = index × national_average_£`
(the national average is a single published number per quarter).

### 2.2 Two-bucket model (approach B)

```
log(territorial_index) ~  PLACE features  +  COMPOSITION controls  +  source_fixed_effect
```

- **PLACE** (attributed to the area itself): vehicle crime, traffic/exposure, flood risk, deprivation,
  population density.
- **COMPOSITION** (controls): young-driver share (17–24), cars per household, and other age structure.
  Included so PLACE coefficients are *net of* who lives there.
- **source_fixed_effect**: when multiple anchor sources are pooled (Confused, MSM, ABI), a per-source
  intercept absorbs methodology differences in level.

**Three numbers, deliberately distinct** (this resolves the "is the headline place-only?" question):
1. **Headline expected premium** = the *full* model prediction (place + composition). This is what a
   fixed driver would actually pay there, because the insurer's postcode factor embeds local claims —
   including those from the area's own demographic mix.
2. **Attribution breakdown** = how that headline splits into a **place component** vs a **composition
   component** (£ each), so the user sees *why* the area loads their premium.
3. **Place-only counterfactual** = "what this area would cost if its demographics matched the national
   average" — composition controls held at their national mean. The purest answer to "the place itself."

Each is surfaced in the API/UI and reports. Feature basis stays **percentile** (bounds extrapolation),
within-nation where the source differs across borders (as already done for crime).

### 2.3 Validation (extends the existing ladder)

Keep: panel R², ridge CV-R², leave-one-area-out MAE, temporal back-test, Spearman(predicted, actual).
Add:

- **Feature-significance report** (`reports/feature_analysis.md`): per candidate feature — univariate
  correlation with the index, **partial correlation** (controlling the others), **VIF** (collinearity),
  OLS p-value, and a keep/drop verdict. Plus a **place-vs-composition variance decomposition** (what
  share of the spatial premium variance each bucket explains). *This is the "is there real correlation
  / significance?" deliverable.*
- **Spatial-multiplier sanity checks**: predicted vs published area ratios for named pairs (e.g.
  WC London vs Rugby/CV, Inner London vs South West), so we can see whether the model reproduces the
  real ~3× spread that motivated the project.

---

## 3. New data (all four, prioritised)

| Dataset | Source | Grain | Bucket | Plumbing |
|---|---|---|---|---|
| **Age structure** (17–24 share) | Census 2021 TS007 (E+W, Nomis); Scotland Census 2022 (NRS) | LSOA / DZ | composition control | Easy (E+W); Scotland separate |
| **Car/van availability** | Census 2021 TS045 (E+W, Nomis); Scotland 2022 | LSOA / DZ | composition control + exposure | Easy |
| **Traffic (AADT)** | DfT Road Traffic Statistics (count points + LA, 1993–2024) | count-point → LSOA, or LA | place | Medium (start LA-level, refine to point→LSOA) |
| **Flood risk** | EA RoFRS (England) · NRW (Wales) · SEPA (Scotland) | polygon → LSOA areal overlay | place | Medium |
| **Collisions (revisit)** | existing STATS19 | LSOA / DZ | place | Re-derive with traffic exposure + KSI-only |

Notes:
- **Census vintage** differs (E+W 2021 vs Scotland 2022) — acceptable, documented; both replace the
  older mid-2015/2011 population for per-capita rates (resolves a MODEL_REVIEW P1).
- **AADT**: count points are sparse (major roads). v1 = LA-level AADT per road-km / per capita (robust);
  v2 = mean AADT of count points within a radius of each LSOA centroid (reuses our spatial-join infra).
- **MIB uninsured driving** is **out** as a feature: only top-15 postcode-district hotspots are
  published (not a comprehensive dataset). May add later as a coarse binary hotspot flag only.
- **Collisions revisit**: re-test with the right denominator (traffic, not residents — which fixes the
  Solihull-style per-resident distortion) and KSI-only; only re-enter the premium if significant.

---

## 4. Anchor expansion (coverage + a second source)

- **Richer Confused/WTW rows**: the quarterly price-index **PDF reports** carry town and postcode-area
  tables (e.g. West Central London £1,349; Inner London £1,093; cheapest town Llandrindod Wells £438).
  Transcribe these into the panel with citations. This is reading **published index reports**, not
  automating quote journeys — within AGENTS.md. Expands area coverage and adds **Scottish rows**, which
  finally lets us **validate Scotland** (an open MODEL_REVIEW caveat).
- **Second source**: add **MoneySuperMarket** (and ABI where available) regional figures as an
  independent anchor with a `source` column + source fixed-effect. Cross-check: do the sources agree on
  the *spatial pattern* (rank correlation between sources)? Levels differ by methodology; we use them
  for spatial agreement and added coverage, not absolute level.
- Expand `REGION_POSTCODE_AREAS` to cover the new rows (incl. Scottish regions).

---

## 5. Architecture / components (follows existing patterns)

New ingest modules (one per source, → `data/interim/*.parquet` keyed by `area_code`, within-nation
handling where sources differ):
- `src/ingest/census_demographics.py` — age structure + car ownership (E+W Nomis, Scotland NRS).
- `src/ingest/traffic.py` — DfT AADT (LA-level v1).
- `src/ingest/flood.py` — EA/NRW/SEPA flood overlay → % area in flood zone.

Changed:
- `config/config.yaml` — declare each feature with a `bucket: place | composition` tag; new sources.
- `src/transform/aggregate_to_lsoa.py` — merge new features into the feature table.
- `src/transform/build_risk_index.py` — extend percentile/contribution baking; bake all three numbers
  per area (full headline, place vs composition attribution, place-only counterfactual).
- `src/calibrate/calibrate.py` — relative-index response; place + composition + source FE; emit
  `feature_analysis.md` (partial corr, VIF, significance) and spatial-multiplier checks.
- `src/calibrate/wtw_index.py` + panel CSV — `source` column; expanded rows.
- `src/api/main.py` + frontend — surface place-vs-composition split (later sub-phase).

Each new feature column flows through the *same* percentile-basis premium machinery built in P0, so
extrapolation stays bounded.

---

## 6. Sequencing (checkpointed sub-phases)

Each sub-phase is independently shippable: ingest → integrate → recalibrate → regenerate reports →
**checkpoint for review**.

- **Phase 1 — Methodology + demographic controls + significance report.** Switch to the relative
  index, add Census age + car ownership as controls, implement the place/composition split, and ship
  `feature_analysis.md`. *Delivers the core reframe; highest conceptual value.*
- **Phase 2 — Anchor expansion.** Richer Confused/WTW rows + MoneySuperMarket 2nd source + Scottish
  anchors → broaden validation and validate Scotland. *Front-loaded so later features are better tested.*
- **Phase 3 — Traffic (AADT) + collisions revisit.** Add traffic exposure; re-test collisions on the
  traffic denominator; re-run significance.
- **Phase 4 — Flood risk.** Add flood overlay; final significance + variance decomposition; UI split.

---

## 7. Risks & caveats

- **Validation grain** capped at postcode-area/town; LSOA values remain predictions.
- **Manual anchor transcription** is error-prone — cite every row, spot-check totals against the source.
- **Source comparability** — Confused (avg of 5 cheapest quotes) ≠ MSM methodology; pool with source FE,
  compare *patterns* not levels.
- **Collinearity** — density/traffic/deprivation/urbanity co-move; monitor VIF, prefer ridge for the
  production coefficients (a carried-over P1).
- **Census vintage** mismatch (E+W 2021 / Scotland 2022) and Scotland AADT/flood-source differences —
  documented; within-nation ranking mitigates.
- **Scope** — this is four datasets + a methodology change + anchor work; the sub-phase split keeps each
  step reviewable and reversible.

---

## 8. Success criteria

1. Place-vs-composition decomposition exists and is reported per area and in aggregate.
2. `feature_analysis.md` states, with numbers, which factors significantly predict the territorial
   index and which don't (partial correlation + p-value + VIF).
3. The model reproduces the real spatial multiplier on named pairs (e.g. WC London vs a cheap town
   ≈ published ratio) within a stated tolerance.
4. Scotland is represented in the calibration panel (≥ a few anchors) — no longer extrapolation-only.
5. Extrapolation stays bounded; all tests pass; ruff clean; Docker serves the updated model.
