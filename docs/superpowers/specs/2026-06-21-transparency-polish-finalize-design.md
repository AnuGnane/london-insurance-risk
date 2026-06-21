# Design — Transparency, Verification & Finalisation

Date: 2026-06-21
Status: approved design (pre-implementation)
Scope: `src/transform/build_risk_index.py`, `src/showcase/bake_static.py`, `frontend/src/*`, `tests/`, new `AUDIT.md`.

## 1. Goal

Finalise the GB car-insurance territorial risk map by making the premium **legible and
self-consistent**, **verifying** the model is computing what it claims (especially the
extreme-low and extreme-high tails), and **polishing** the frontend — all while staying a
fully static GitHub Pages site. Honour the project rule: finalise, don't over-engineer.

Three user requirements drive this:
1. *Transparency (priority)* — some areas price extremely low/high and it is hard to see why.
2. *Frontend polish* — improve the map/visuals; evaluate whether GitHub Pages is too limiting.
3. *Simplicity* — no new heavy systems.

## 2. What was verified (and goes into AUDIT.md)

The pricing model is `premium = national_avg × exp(const + Σ coefₖ · featureₖ_pct)`, a log
relative-index model. Current artefact values (`reports/calibration.json`):

| term | value |
|---|---|
| const | −0.7243 |
| vehicle_crime_pct | +0.001397 |
| deprivation_pct | +0.003386 |
| aadf_intensity_pct | +0.003911 |
| young_driver_share_pct | +0.009450 |
| cars_per_household_pct | −0.004429 |
| national_avg_latest | £558.55 |

Verification results (recomputed from coefficients across all 41,729 served areas):

- **The math is correct and sensible.** All place coefficients are positive; young-driver
  share positive; cars/household negative (affluence proxy). Monotonic, bounded by the 0–100
  percentile basis — no runaway. LOAO MAE £89, Spearman 0.97.
- **The extreme tails are real, not a bug.** Cheapest area (Wiltshire 039C, £193) sits at the
  bottom percentile on all three place drivers *and* favourable demographics (young-driver 1st
  pct, cars/household 92nd). Dearest (Tower Hamlets 018A, £1,542) is top-percentile on all.
  Both reconstruct exactly from the coefficients.
- **Composition dominates the spread.** Young-driver share alone moves the premium −£137 (cheapest)
  to +£445 (dearest); cars/household −£39 to +£300. The place drivers move it far less. This is a
  key reason the current "what moves the premium" panel feels unconvincing — it foregrounds the
  smaller place effects and hides the dominant demographic ones inside an unanchored "vs average".
- **Rankings are NOT desynced from the UI.** The top-10 names map correctly to their premiums.
  "Barlanark - 06" and "Keppochhill - 03" are genuine Glasgow Data Zones (deprivation 98–99th
  pct, high traffic, high young-driver share) — legitimately expensive, not a name/row mismatch.
  Top-100 is 79 England / 21 Scotland.
- **Caveat surfaced by the rankings:** Scotland's vehicle-crime percentile is ranked *within
  Scotland* (different source, incomparable absolute scale), so a Glasgow "86th" is not the same
  yardstick as a London "86th". Documented; the waterfall tags it.
- **Out-of-support extrapolation in the tails.** The cheapest LSOA predictions fall below the
  cheapest observation in the (postcode-area-grain) calibration panel. Defensible — the percentile
  basis bounds it — but it is an extrapolation and AUDIT.md says so.

### 2.1 The real transparency defect (root-caused)

Two concrete, fixable problems make the premium illegible:

1. **No visible anchor, non-additive parts.** The detail panel shows each driver as "+£X vs the
   GB-average area". In a multiplicative model these deltas **do not sum to anything**, and the
   baseline they are measured against is never shown. A user cannot trace £537 → £193.
2. **The displayed total cannot be reproduced from the displayed factors.** `bake_static.py`'s
   `_round_props` ships percentiles rounded to **whole integers**, but `calibrated_premium` was
   computed upstream (`build_risk_index.py`) from **1-decimal** percentiles. Recomputing the
   premium from the shipped integer percentiles is off by **mean £1.68, max £12.60** (only 41%
   within £1) — uniformly across all three nations. So any client-side reconstruction silently
   disagrees with the headline number. This is a delivery-precision bug, not coefficient skew.

There is also a **latent train/serve-skew risk** (documented in `CLAUDE.md`): `make risk` does not
depend on `reports/calibration.json`, so the served premiums can be baked from different
coefficients than the current calibration. Nothing guards it today.

## 3. Non-goals (YAGNI)

PMTiles / vector-tile migration; any backend; Northern Ireland; flood activation; re-opening
feature selection or weights; new data sources; Shapley attribution (sequential is exact and
sufficient). GitHub Pages stays — it is not the bottleneck (the 44 MB / 6.4 MB-gzip single
GeoJSON is, and it is acceptable for a finalised showcase).

## 4. Workstream A — Verification & guard

**A1. `AUDIT.md`** (repo root, committed). A short, evidence-backed note recording §2 above: the
pricing formula, the verified tails with worked numbers, the sign checks, the rankings
no-desync confirmation, the within-Scotland-crime caveat, and the out-of-support note. Purpose:
make the cheap/expensive areas defensible to a reviewer at a glance.

**A2. `tests/test_serve_consistency.py`** (pytest, runs in `make test`). Loads
`frontend/public/data/areas.geojson` + `reports/calibration.json` and asserts three things,
each chosen so it is *exactly* checkable from the shipped file:
- **Skew guard (exact):** the served `premium_baseline` equals `national_avg × exp(const +
  Σ coefₖ·50)` recomputed from the coefficients, within £1. The baseline uses no per-area
  percentiles, so this is rounding-free and catches train/serve coefficient skew precisely.
- **Premium reproducibility (exact):** every served `calibrated_premium` equals a recompute from
  the coefficients using the **shipped 1-dp model-driver percentiles** (see B/§5.3) within £1.
  This is only exact because B ships those percentiles at the precision the premium was baked
  from — fixing the §2.1(2) precision gap.
- **Waterfall reconciliation (exact):** `premium_baseline + Σ driver _contrib == calibrated_premium`
  within £0 per area (integer-reconciled in B/§5.2).
- a sign/extrema sanity check: min/max premium within a configured plausible band; place
  coefficients positive.

This test **fails on today's data** (the £12.60 precision gap + no `premium_baseline` field) and
passes once Workstream B bakes the steps/baseline and re-bakes at 1-dp percentile precision — that
failure *is* the proof the guard works.

## 5. Workstream B — Premium waterfall (transparency feature)

Replace the unanchored "what moves the premium" bars with an **exact premium bridge** read
straight from baked fields, so the parts always sum to the whole.

### 5.1 Decomposition (exact AND order-invariant — LMDI)

Anchor = **baseline** = premium with every feature held at the median percentile (50):
`premium_baseline = national_avg × exp(const + Σ coefₖ·50)` (= £537.39 today).

The model is log-linear, so in log space each factor's effect is exactly additive and
order-independent: `ln(premium / baseline) = Σ coefₖ·(pctₖ − 50)`. We turn that into an exact
**£** split using the **logarithmic-mean (LMDI) decomposition** — the standard exact attribution
for a multiplicative/log model:

```
logₖ      = coefₖ · (pctₖ − 50)                 # factor k's log-contribution (order-free)
L         = (premium − baseline) / ln(premium / baseline)   # logarithmic mean, per area
stepₖ (£) = L · logₖ
```

Then `baseline + Σ stepₖ == premium` **exactly** (Σ stepₖ = L · Σ logₖ = L · ln(premium/baseline)
= premium − baseline), and each `stepₖ` depends only on factor *k*'s own log-contribution and a
per-area scalar `L` — so it is **independent of ordering** (an earlier sequential design swung the
dearest area's per-driver attribution by up to £187 between orderings; LMDI removes that entirely).
The `L = baseline` limit is used when premium == baseline (all factors at the median → all steps £0).
This is simpler than the sequential walk (one scalar per area, no accumulation) and needs no
Shapley combinatorics. A fixed display order (place first, then composition) is used purely for
presentation; it does not affect the magnitudes. Verified exact for the £193 and £1,542 extremes.

### 5.2 Server bake (`build_risk_index.py`)

Rework `bake_premium_and_contributions` via a pure `decompose_premium` helper:
- compute `premium_baseline` (one value, constant across areas) and bake it per area (simplest
  for the static contract; it is identical everywhere).
- redefine each driver's baked `{base}_contrib` as its **LMDI step £** (§5.1; replaces the
  current "vs-median delta"). Diagnostics keep `_contrib = 0`.
- **Integer reconciliation:** after rounding `premium_baseline`, each `_contrib`, and
  `calibrated_premium` to whole £, the largest-magnitude step per area absorbs the rounding
  residual so `round(baseline) + Σ round(step) == round(premium)` *exactly* (the residual is at
  most a few £ across the six rounded terms). Guarantees the on-screen bridge ties to the pound.
  `calibrated_premium` and the reconciliation total are rounded from the **same** float Series
  (computed once) so they can never disagree.
- **Implementation note (verified):** materialise the numpy step array with `.to_numpy().copy()`
  before the in-place residual write — pandas 3.x returns a read-only array and the `+=` otherwise
  raises `ValueError: assignment destination is read-only` (reproduced against the repo `.venv`).
- add `premium_baseline` to the slim GeoJSON `keep` list (this feeds the FastAPI dev path; the
  static Pages asset gets it via `bake_static._BASE_PROPS` — see §5.3).
- keep `premium_place_only` (still used for the "who lives there" figure).

### 5.3 Delivery (`bake_static.py`)

- add `premium_baseline` to `_BASE_PROPS`; round it to whole £ in `_round_props`.
- **ship the five model-driver `_pct` at 1 decimal** (currently integer): `build_risk_index`
  computes the premium from 1-dp percentiles, so shipping 1 dp makes the premium exactly
  reproducible from the served file (closes §2.1(2)). Diagnostic `_pct` stay integer (display
  only). Payload cost is negligible (one decimal on 5 fields × 41,729 ≈ a few hundred KB pre-gzip).
- `_contrib` stay whole £ (integer-reconciled upstream). The A2 test enforces the full chain.

### 5.4 Client render (`DetailPanel.tsx`, `utils.ts`, `types.ts`)

- `types.ts`: add `premium_baseline?` to `LsoaProps` and `AreaDetail`; add a `WaterfallStep`
  shape `{ key, label, percentile, step£, kind }`.
- `utils.featureToDetail`: build the ordered step list from baked `_contrib` + `premium_baseline`;
  keep `composition_uplift` for the existing three-number row.
- `DetailPanel`: render a **waterfall** — "Typical GB area £537" anchor row, then one signed
  step per driver (label · percentile · ±£, place rows first then a "Who lives there" sub-group),
  ending in the area's "£193" total. Each step is a small diverging bar (left = cheaper, right =
  dearer). Bar width scales to the **per-area largest |step|** (the dominant driver fills the bar,
  the rest are proportional within the area) — not a fixed baseline fraction, which would cap and
  flatten the dominant composition drivers exactly where the story lives. The signed £ label is the
  source of truth. Scotland crime rows get a "within Scotland" tag.
  Diagnostics remain a separate, contribution-free "also mapped" list. The existing
  national-average sparkline/notch and quintile pill stay.
- `utils.dominantDriver` (used by `RankingsPanel` chip): make **sign-aware** — pick the factor
  with the largest |step| (the biggest mover in either direction) and return its **direction**
  alongside the key. `RankingsPanel.tsx` renders a ▲/▼ glyph so a cheap area dominated by
  cars/household (a saving) is visually distinct from a dear area dominated by the same factor.
  `RankingsPanel.tsx` is therefore in scope for this change.

### 5.5 Edge cases

- **Missing composition** — this is the **~1,110 England/Wales LSOAs whose 2011 codes changed in
  2021** (and any other genuinely absent cell), *not* Scotland: Scotland's per-area census
  controls (young-driver share, cars/household) **are** ingested (Census 2022 on 2011 Data Zones),
  so Scottish areas show real composition steps — e.g. Barlanark's young-driver 98th pct. (The
  separate "Scotland composition held at the national mean" note in `calibrate.py` applies only to
  the coarse *calibration-panel* matching, not to the per-area premium bake.) Where a control is
  truly missing it is held at the median → its step is exactly £0 and renders as
  "national-average (no local data)"; `premium_place_only` already equals full there.
- **Areas with no premium** (none today — all 41,729 carry one): waterfall hidden, existing
  fallback copy shown.

### 5.6 FastAPI dev path parity (`src/api/main.py`)

`/api/risk` reads the same parquet `{c}_contrib` columns, so their meaning changes under it too,
and it currently (a) omits `young_driver_share`/`cars_per_household` from `COMPONENT_COLS` — the
two biggest movers — and (b) returns no `premium_baseline`. The FastAPI app is **local-dev only**
(not used by the deployed Pages site), but to avoid a silent inconsistency we make a small parity
change: add the two composition drivers to `COMPONENT_COLS`, surface `premium_baseline` in the
`/api/risk` response, and update the stale "vs a national-average area" comment to "LMDI step".
No behaviour the static site depends on. (The A2 guard still only checks the shipped static asset.)

## 6. Workstream C — Frontend polish (static, GeoJSON kept)

Scoped, visual/UX only — no build-infra change:
- waterfall styling (diverging bars, anchor + total rows, place/composition grouping) in
  `index.css`.
- legend + loading polish; ensure the £ legend ticks and the waterfall share one ramp/token set.
- responsive/mobile pass on the sidebar + detail panel (waterfall must read on narrow screens).
- hover/selected-state and focus-ring consistency; colour-contrast/accessibility check on text
  over the ramp.
- copy pass so the cheap/expensive tails read as intended (tie to AUDIT.md language).

**GitHub Pages decision (documented):** stay. Everything is client-side (MapLibre, point-in-poly,
rankings); nothing needs a server. The only real lever is payload, and PMTiles — still a static
file on Pages — is recorded as an *optional* future stretch, not done now.

## 7. Data contract change

One new shipped field: `premium_baseline` (integer £, constant per build). Existing `_contrib`
fields change **meaning** (LMDI step, not vs-median delta) but not type. Model-driver `_pct` move
from integer to 1 dp (§5.3); premiums and diagnostics unchanged. `methodology.json` unchanged
(already ships coefficients + national_avg). All `AreaDetail` construction funnels through
`utils.featureToDetail`, so the new fields populate on every path (search, map click, ranking).

## 8. Testing

- A2 consistency test (new) — the durable serve↔model guard.
- `tests/test_build_risk_index.py` (new) unit-tests `decompose_premium`: exact integer
  reconciliation (`baseline + Σ steps == full`), **order-invariance** (permuting the column order
  yields identical per-factor steps — the LMDI property), the all-median row equals the baseline,
  and missing **place** *and* missing **composition** columns are held at the median → £0 step.
- `npm run build` (type-check, strict `noUnusedLocals`) + `npm run lint` clean; manual smoke of the
  waterfall on cheap (Wiltshire 039C), dear (Tower Hamlets 018A), and Scottish (Barlanark) areas.

## 9. Pipeline discipline

All model-output changes go through `make calibrate` (which re-runs `risk` + `showcase-data`),
never `make risk` alone. The A2 test now enforces this at `make test` time.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Integer rounding breaks the bridge sum | largest-|step| absorbs the (≤ few £) residual + A2 exact-reconciliation assertion |
| `_contrib` meaning change confuses other readers | all consumers updated: DetailPanel (rewritten), RankingsPanel `dominantDriver`, FastAPI `/api/risk` (§5.6); comment the new LMDI semantics |
| Attribution questioned / reviewer reorders factors | LMDI split is **order-invariant and exact** (§5.1) — magnitudes don't depend on ordering; the unit test asserts permutation-invariance |
| pandas 3.x read-only numpy array crashes the bake | `.to_numpy().copy()` before the in-place residual write (reproduced + fixed) |
| Re-bake forgotten → stale serve | A2 guard fails the build (baseline check is rounding-free) |
| Waterfall too tall on mobile | bar track hidden < 560 px; signed £ + percentile retained |
