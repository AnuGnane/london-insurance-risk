# Interview Prep — Mock Q&A for the GB Risk Model Project

> 20 questions an ML / AI engineering interviewer is likely to ask about this project,
> with a strong model answer and the **trap** to avoid for each. Pairs with
> `PROJECT_TECHNICAL_OVERVIEW.md` and `DATA_PROVENANCE_AND_TRANSFORMS.md`.
>
> **Golden rule for the whole interview:** lead with the *validation discipline* and
> *data engineering*, be honest that the estimator is a regularised linear model, and
> volunteer the validation-grain caveat before they corner you on it. Honesty about
> limitations reads as senior; overselling "ML" reads as junior.

---

## A. The 60-second pitch (memorise this)

> *"It estimates an expected annual car-insurance premium for every small area in Great
> Britain — about 42,000 LSOAs and Data Zones — from open data. The hard part is data
> engineering: reconciling three nations' incompatible crime, deprivation and census
> sources onto one grain. On top of that I fit a regularised log-linear regression that
> predicts an area's premium relative to the national average, calibrated against the
> published WTW/Confused price index. I validate it three ways — k-fold CV,
> leave-one-area-out, and a temporal back-test — getting about £89 mean absolute error on
> a ~£558 average and 0.97 rank correlation. It ships as a static interactive map. It's
> deliberately a simple, interpretable model because the calibration sample is small, and
> the honest caveat is that it's validated at postcode-area grain but predicts at the
> finer LSOA grain."*

---

## B. Modelling questions

**1. Walk me through the model.**
> Response is `log(area_premium / national_average)` — a relative index, so the model
> learns spatial deviation, not the national price level. Features are percentile-
> transformed (0–100): three place drivers (vehicle crime, deprivation, AADF traffic
> intensity) plus two demographic controls (young-driver share, cars/household). It's
> OLS with area-clustered standard errors. I reconstruct £ as
> `national_avg × exp(const + Σ βᵢ·pctᵢ)`.
> **Trap:** don't call it "a neural net" or wave at "ML algorithms." Name the estimator
> precisely — OLS in log-relative-index space — and own it.

**2. Why a linear model and not XGBoost / a neural net?**
> The calibration sample is 106 matched observations across 30 areas. A high-variance
> learner would overfit badly; a regularised linear model is the right bias/variance
> point, and it's auditable, which matters for anything pricing-adjacent. I'd reach for
> gradient boosting only with claims- or quote-level data — 10⁴–10⁶ rows.
> **Trap:** don't apologise for it being "just" linear. Frame it as a *deliberate*
> complexity choice matched to the data, which is exactly the judgment they're testing.

**3. Why model the log of a ratio rather than £ directly?**
> Two reasons. The **ratio** strips out the national price level and time trend so the
> coefficients capture the spatial effect — the actual goal. The **log** makes it
> multiplicative (premiums scale, can't go negative) and linearises a process that's
> naturally proportional. I convert back to £ with the stored national average.
> **Trap:** be ready for "what does a coefficient mean then?" → a one-percentile-point
> increase multiplies the premium by `exp(β)` ≈ `1+β` for small β.

**4. Your R² is 0.917 — isn't that too good / overfit?**
> That's in-sample. The honest generalisation numbers are ridge **CV-R² 0.887** and
> **leave-one-area-out MAE £89**. And it's fit at coarse (postcode-area) grain — the
> high R² partly reflects aggregation smoothing. I trust the hold-out numbers, not the
> in-sample fit.
> **Trap:** never quote 0.917 as the headline. Quote LOAO MAE and CV-R² — quoting
> in-sample R² as success is the classic junior tell.

**5. Explain leave-one-area-out and why it's stronger than random k-fold.**
> I hold out *all* observations for one area, fit on the rest, predict that area, repeat.
> Random k-fold can leak: the same area appears in train and test across quarters, so the
> model can memorise an area-specific intercept. LOAO forces genuine spatial
> generalisation — "can you price an area you've never seen?" That's the realistic
> deployment scenario.
> **Trap:** if you only mention k-fold, they'll ask about leakage. Pre-empt it.

**6. What's the temporal back-test and why have both?**
> Fit on quarters ≤ T, predict T+1. LOAO tests generalisation *across space*; the
> back-test tests generalisation *forward in time*. They fail differently — a model can
> be spatially robust but drift temporally — so I report both (back-test MAE ≈ £74).
> **Trap:** don't conflate the two; the interviewer is checking you understand *what each
> hold-out controls for*.

**7. How did you choose features — and what did you throw out?**
> Evidence-gating: each candidate must clear **partial-correlation p < 0.05** (independent
> signal, controlling the others) **and VIF < 10** (not collinear). That killed
> population_density (VIF 13–60), traffic-per-capita (inverse-density proxy, wrong-signed),
> KSI rate (no independent signal, p≈0.44), and road_casualties. They survive as map
> *diagnostics*, not premium drivers.
> **Trap:** "I used the features that seemed relevant" is a fail. Name the *quantitative*
> gate and a concrete feature you *rejected* — that's the senior signal.

**8. One of your coefficients is negative — cars per household. Explain.**
> Low car ownership correlates with dense, urban, higher-theft, higher-uninsured-driver
> areas, so the model learns low car ownership → higher premium. It's a genuine negative
> association, sign-checked and significant. It also creates a nice counterintuitive UI
> case: an area can be near-zero on the car-ownership percentile yet be that area's
> *biggest* £ contributor, because the negative sign pushes it furthest from the median.
> **Trap:** don't claim it's a bug or "fix" the sign. Defend it with the mechanism.

**9. How do the per-driver £ contributions work — do they sum to the premium?**
> Each is a counterfactual: `premium − premium(that feature held at the median
> percentile)`. Because the model is multiplicative, they **don't** sum exactly to the
> premium — they're interpretable deltas, not an additive decomposition. I'm explicit
> about that in the UI copy.
> **Trap:** if you imply they add up, a sharp interviewer will multiply them out and
> catch you. State the multiplicative caveat first.

**10. What's the place-vs-composition split, and what did it reveal?**
> Place features are the territorial drivers; composition features (demographics) are
> *controls*, included so place coefficients are net of who lives there. The honest
> finding: composition-only R² (0.884) is *higher* than place-only (0.759) — at this
> grain, who lives somewhere explains more premium variation than where it is. I report
> them separately rather than hiding it.
> **Trap:** don't bury this. Volunteering an unflattering finding builds credibility.

---

## C. Data & engineering questions

**11. What was the hardest part?**
> Making three nations comparable. England/Wales and Scotland use different area systems
> (LSOA vs Data Zone), different deprivation indices, and crime that Scotland publishes
> only at council level via a SPARQL linked-data cube while England/Wales comes from
> data.police.uk. I unified them on a 2011 area grain and rank each feature *within* its
> comparable group so I never compare incomparable scales.
> **Trap:** don't say "the modelling." For this project the data engineering *is* the
> achievement — lean in.

**12. How do you handle the incompatible crime sources?**
> I never pool them on absolute scale. Vehicle crime is percentile-ranked *within
> source-group* — England+Wales together, Scotland separately — so only within-group
> ordering feeds the model, exactly like deprivation is ranked within nation. Scotland's
> council-level counts are disaggregated to Data Zones by population, which I'm explicit
> adds between-council but not within-council variation.
> **Trap:** be ready for "isn't disaggregation making up data?" → it propagates a real
> council rate down by population; it adds no false within-council signal, and I document
> it as a limitation with a named refinement (SIMD crime-domain weighting).

**13. Why percentile features instead of raw values or standardisation?**
> Percentiles are bounded [0,100], so an outlier LSOA — a commercial area with a tiny
> resident denominator, a single-block density spike — can't blow up its premium the way
> raw units do. It also makes incompatible raw scales orderable on one axis. It was a
> real bug fix, not a stylistic choice.
> **Trap:** "it normalises the data" is too vague. The specific reason is *bounding
> per-area extrapolation*.

**14. How do you deal with missing features?**
> I distinguish true-zero from missing. A blank crime count in an English LSOA is a real
> 0; a blank in a nation with no crime source is NaN. True zeros stay 0; genuine gaps are
> reweighted (the composite renormalises over present features) or, for composition
> controls, held at the national median so the area equals its place-only premium rather
> than dropping out.
> **Trap:** "I filled NaNs with the mean" is too glib — explain the *true-zero vs
> missing* distinction, which is the actual design decision.

**15. Walk me through the AADF traffic feature — that's the interesting one.**
> ~22k DfT count points, pooled over several years (DfT physically counts only a subset
> each year). I build a KD-tree over their eastings/northings — both points and
> boundaries are already in British National Grid, so it's a pure metric query — and take
> each area centroid's mean AADF within 2 km, falling back to the single nearest point if
> none are in range. It measures local road *business*, decoupled from population density.
> **Trap:** be ready for "why 2 km / why centroid?" → 2 km ≈ local road network given ~3 km
> mean point spacing; centroid keeps it population-agnostic so it doesn't smuggle density
> back in.

**16. How is this reproducible / how would you productionise it?**
> Config-driven `make`-target pipeline, one module per source, parquet hand-offs, and a
> model card (`calibration.md` / `methodology.json`) emitted on every calibration. To
> productionise I'd add a CI guard that recomputes a sample of premiums from the published
> coefficients and asserts they match the served data, schedule re-ingests, and version
> the coefficients (they're currently a git-ignored artifact).
> **Trap:** don't claim it's "production-ready." Name the specific gaps — that's more
> convincing.

---

## D. The killer / senior-signal questions

**17. What's the biggest weakness of this project?**
> Validation grain ≠ prediction grain. I validate at postcode-area/region level (the
> anchor panel's grain) but predict at LSOA level, which is far finer. The hold-out numbers
> are honest *at the coarse grain*; per-LSOA values are an extrapolation. To close it I'd
> need claims- or quote-level data at fine grain to validate where I actually predict.
> **Trap:** don't dodge with a fake weakness ("I'm too thorough"). This is the real one —
> naming it first is the strongest move you can make.

**18. Tell me about a bug you found.**
> A train/serve-style skew. The served map premiums were baked from an *older, steeper*
> set of coefficients than the methodology I was publishing — the pipeline had no
> dependency edge forcing the premiums to rebuild when the calibration changed. I caught
> it by recomputing premiums from the *published* coefficients and finding a systematic
> fan-out: the median area matched within 1% but the tails were stretched up to ~1.9×. Fix
> was to rebuild in the correct order and I'd add a CI check to prevent recurrence.
> **Trap:** this is gold for an ML role — it's exactly model/serving drift. Tell it as a
> *detection-and-prevention* story, not "I made a mistake."

**19. How do you know the model isn't just overfit to Confused.com?**
> Cross-source check: I pool a second anchor (MoneySuperMarket) with a source fixed effect
> and confirm the model reproduces *its* spatial ordering too. Different absolute price
> level, same spatial pattern — so the pattern isn't a single-source artefact. It's a
> small, coarse second source, so I treat it as corroboration, not a powered test.
> **Trap:** don't overclaim significance on the small second source — call it indicative.

**20. If you had two more weeks, what would you do?**
> In priority order: (1) a CI guard against coefficient/serving drift; (2) finer-grain
> validation data to close the grain gap; (3) activate the Phase-4 flood feature (scaffold
> exists); (4) PMTiles to shrink the map payload; (5) SIMD-weighted Scottish crime
> disaggregation. The first two are about *trustworthiness*; the rest are polish.
> **Trap:** lead with correctness/trust items, not features — it signals you think like an
> engineer shipping a system, not a student adding scope.

---

## E. Concept refreshers (so you're not caught flat)

- **VIF (variance inflation factor):** how much a feature's variance is inflated by
  collinearity with the others; `1/(1−R²ⱼ)` from regressing feature j on the rest. >10 =
  redundant.
- **Partial correlation:** correlation of feature and target *after* removing both's
  linear dependence on the other features — its independent contribution.
- **Clustered standard errors:** widen SEs to account for correlated observations within a
  group (here, repeated quarters per area), so significance isn't overstated.
- **RidgeCV / L2:** penalises Σβ² to shrink coefficients; α chosen by cross-validation —
  trades a little bias for lower variance, key on small n.
- **Spearman vs Pearson:** Spearman is rank correlation (monotonic, robust to the
  multiplicative scale); the right metric for a *ranking* product.
- **MAUP / ecological inference:** results depend on how areas are drawn, and area-level
  associations needn't hold at the individual level — the structural caveat of any
  small-area model.
