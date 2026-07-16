# Evolution Roadmap — Design

Date: 2026-07-15 · Status: **approved** (brainstormed against `evolution_prompt.md`; user-approved).
Companion to `STATUS.md` (current state), `PHASE4_PLAN.md` (first item), `NEXT_PHASE_DESIGN.md`
(the Phase 1–4 design this roadmap succeeds).

---

## 1. Framing decisions (user-confirmed)

1. **Objective: balanced.** Rank work by return-on-effort across all three dimensions
   (statistical rigor / product & UX / commercial-engineering), rather than optimising one.
2. **Phase 4 (flood) finishes first.** The scaffold, config wiring and tests exist; only the
   extent downloads and the overlay transform remain.
3. **Effort rhythm: slow burn.** Occasional sessions. Every roadmap item must be small,
   independently shippable, and leave the repo mergeable at the end of any session. No
   long-lived branches, no twin tracks.

**Sequencing model: a return-on-effort ladder.** One item in flight at a time, strictly
ordered by impact ÷ effort regardless of dimension. The ladder is re-reviewed after each item
ships — evidence-gate outcomes can re-rank what follows (e.g. if flood gates out as a
diagnostic, its UI surface shrinks and item 2 starts sooner).

Constraints carried over unchanged from `AGENTS.md` / `CLAUDE.md`: open data only, no
quote-scraping, no invented anchor figures, evidence-gate every candidate feature, validation
capped at postcode-area/town grain, static-site deployment.

---

## 2. The ladder

### Now — short-term (each ≈ 1–3 sessions, one PR each)

#### 2.1 Finish Phase 4 — flood risk
Per `PHASE4_PLAN.md`: EA RoFRS (England) + SEPA (Scotland) first — the two clean OGL bulk
routes — NRW (Wales) once its download path is confirmed. Areal overlay → `flood_area_share`
→ within-nation percentile → evidence gate decides driver vs diagnostic.

- **Impact:** first true *peril* feature (not an urban-intensity proxy). Either gate outcome
  is a win: gated-in = new premium driver; gated-out = new map layer + another demonstration
  that features are tested, not assumed.
- **Effort:** medium — the downloads are large and the overlay is the expensive step, but the
  scaffold, tests and config are already in place.
- **Risks:** extent-file size/format churn; Wales slipping to a follow-up PR (acceptable,
  mirrors how Scotland demographics were sequenced).

#### 2.2 Uncertainty bands (per-area premium intervals)
Cluster bootstrap over the anchor panel (resample the 30 areas with replacement, refit,
collect the per-LSOA prediction spread), widened by the LOAO residual variance so the
interval honestly reflects the LSOA-grain extrapolation, not just coefficient uncertainty.
Bake `premium_low`/`premium_high` into the processed parquet and served GeoJSON; the UI shows
a range ("£520–£640") instead of a false-precision point, and the waterfall keeps the point
estimate as its bridge target.

- **Impact:** highest rigor-per-effort item on the list — converts the project's biggest
  caveat (validation grain ≠ prediction grain) into a visible, quantified feature. Also a
  prerequisite mindset for the long-term hierarchical model (2.9).
- **Effort:** low-medium — pure `calibrate.py`/`build_risk_index.py`/UI work, no new data.
- **Risks:** interval width must be defended in `AUDIT.md` (bootstrap-only intervals would
  understate; the LOAO-widening is the honest correction). Payload grows by two fields.

#### 2.3 Already-held-data quick wins (one PR, pure evidence-gate runs)
Near-zero ingest work; all data is already downloaded or one small file away:

- **IMD sub-domains** — the crime and income domain scores (already in the IoD2019 file)
  tested as candidate replacements for (or complements to) overall deprivation.
- **Scotland crime grain fix** — SIMD publishes its *crime domain* at Data Zone grain; blend
  or substitute it for the council-grain SPARQL disaggregation to restore within-council
  variation. Directly attacks the "Scotland crime is council-grain" limitation with data the
  pipeline already ingests. Within-nation ranking unchanged.
- **Moran's I** — spatial-autocorrelation diagnostic (PySAL/`esda`) on anchor-grain residuals
  and on the LSOA premium surface. Reported in `feature_analysis.md`/`AUDIT.md`. Also tells
  us whether the long-term spatial/hierarchical work (2.9) is warranted by the data.
- **Urban/rural robustness check** — ONS Rural-Urban Classification (E+W) + Scottish
  Government 6-fold, used *not* as a driver but as a stratified validation: does the model
  hold within urban and within rural strata separately? Goes in `AUDIT.md`.

- **Impact:** three known limitations addressed or quantified in one PR.
- **Effort:** low. **Risks:** none structural — the gate may simply say "no change", which is
  itself reportable.

#### 2.4 Comparison view (product)
Pick two areas → side-by-side premium waterfalls plus an **exact £ delta decomposition**
("SW1 is £412 dearer than CV21: +£210 traffic, +£120 crime, …"). The LMDI waterfall makes
per-factor deltas exact and order-invariant, so this is arithmetic on data the frontend
already has — mostly React/UI work plus a small deep-link extension
(`?compare=<codeA>,<codeB>`).

- **Impact:** the single most compelling product expression of the project's origin story
  (same driver, London vs Rugby); high demo value.
- **Effort:** low-medium, frontend-only. **Risks:** mobile layout of two waterfalls (stack,
  don't shrink); keep the static payload unchanged.

### Next — medium-term (months)

#### 2.5 PMTiles migration + roll-up layers
tippecanoe → `.pmtiles` served statically from GitHub Pages via the MapLibre PMTiles
protocol; add pre-aggregated region/LA roll-up layers for zoomed-out views. Kills the ~15 MB
GeoJSON payload, unlocks mobile, prerequisite for any serious mobile UX pass.
`bake_static.py` grows a tiles target; the GeoJSON path stays for local dev/API parity.

#### 2.6 Anchor panel growth + anchor-refresh CI
Each new Confused/WTW quarter adds ~13 region rows (plus named towns) for free; named-town
rows map town → postcode district(s) → rolled-up features. Then a small GitHub Action:
when a new anchor CSV row lands, re-run `calibrate` + `showcase-data` and redeploy, with the
calibration report attached to the run. **Opinionated split:** anchor refresh belongs in CI;
the multi-GB full re-ingest does not — that stays a documented manual runbook. The
no-invented-figures rule applies to every transcribed row (cite the source PDF/URL).

#### 2.7 Vehicle age/value mix (repair-cost proxy)
DVLA/DfT vehicle licensing tables (`VEH` series) at postcode-district grain — vehicle age and
body-type mix as a candidate place feature. Best available open-data fix for the
"wealthy-but-central LSOAs under-priced" limitation (unmodelled vehicle value). Through the
evidence gate like everything else; exact table IDs and grain to be confirmed at
implementation time.

#### 2.8 Temporal UX
The anchor panel already spans ~11 quarters: surface the national premium trend line and each
area's index stability in the detail panel. No new data; narrative win ("your area is
consistently ~1.4× the national average").

### Later — long-term / ambitious

#### 2.9 Hierarchical Bayesian multiscale model — the v2.0 centerpiece
Partial pooling across LSOA ⊂ postcode-area ⊂ region, with anchors observed at coarse grain
and features at fine grain, so LSOA predictions are **constrained to aggregate back to the
observed anchor values** and uncertainty is coherent at every grain (PyMC/numpyro). This
turns the validation-grain gap from a caveat into the research question — small-area
downscaling of coarse-grain price indices — and is the genuinely novel/publishable angle.
Everything earlier feeds it: uncertainty bands (2.2) set the honesty bar, Moran's I (2.3)
justifies the spatial structure, anchor growth (2.6) supplies the data.

#### 2.10 Home-insurance line
Reuses ~70% of the pipeline: burglary replaces vehicle crime, flood becomes the star driver,
deprivation/composition carry over. Honest caveat: regional home-premium anchors are thinner
than motor — feasibility of the calibration panel is the gating question, and should be
scouted before any ingest work. Travel/life lines are **cut** from the ambition list: not
territorially priced from open data.

#### 2.11 Northern Ireland at coarse grain
Partially unblocked if council-grain PSNI recorded-crime statistics are accepted
(Scotland-style population disaggregation) + NIMDM2017 + NI Census 2021. Low
payoff-to-effort; stays last unless a finer NI crime source appears.

#### 2.12 Embeddable widget / public data contract
A query-param iframe view plus a documented, versioned static JSON schema is the near-free
"platform" move consistent with the static-site ethos. A hosted public API is explicitly
**not** worth the running cost at this stage.

---

## 3. Positions taken (pushback on `evolution_prompt.md`)

1. **No ML estimator swap.** With 30 clustered areas, tree ensembles/NNs memorise the panel.
   The legitimate upgrade is hierarchical pooling (2.9), not gradient boosting.
2. **No GWR / spatial-lag models at LSOA grain.** They cannot be validated where no ground
   truth exists. Moran's I as a diagnostic: yes. Spatial structure belongs inside the
   hierarchical model where aggregation consistency keeps it honest.
3. **ABI tracker is not a panel source.** It is national-only and measures *paid* premiums
   (vs quoted). Use it, if at all, as a level sanity-check ("quoted vs paid gap") in the
   methodology page — zero spatial rows.
4. **"Composition explains more than place" is a finding, not a flaw.** At small-area grain,
   who lives there beats where it is. The narrative should lean into this decomposition
   rather than engineering it away.
5. **Automated retraining: split the question.** Quarterly anchor refresh in CI — yes (cheap,
   deterministic). Automated multi-GB source re-ingest in CI — no; manual runbook.

---

## 4. Success criteria & cadence

- Every shipped item leaves: tests green, ruff clean, `STATUS.md` updated, and (where the
  model changed) `make calibrate` re-run so served premiums match coefficients (the known
  train/serve-skew gap).
- Evidence-gate outcomes (keep vs diagnostic) are reported in `reports/feature_analysis.md`
  and summarised in `AUDIT.md` — for *every* candidate feature this roadmap adds.
- The ladder is re-reviewed after each item ships; this document gets a one-line changelog
  entry per re-ranking rather than silent edits.

## Changelog

- 2026-07-15 — initial approved version.
