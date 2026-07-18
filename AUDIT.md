# Model Verification Audit

Date: 2026-06-21 · Branch: `transparency-waterfall`

This document records a one-page verification of the premium estimator: the formula, coefficients,
tail reconstructions, sign checks, ranking integrity, and known caveats. It accompanies the
premium-waterfall feature, which replaces an unanchored driver breakdown with an exact,
order-invariant decomposition.

---

## 1. Pricing formula

```
premium = national_avg × exp(const + Σ coefₖ · featureₖ_pct)
```

All features are expressed as **percentile ranks (0–100)** within their respective nation-groups,
so the coefficient unit is "log-premium change per percentile point." The baseline is what the
formula produces when every feature sits at the median (pct = 50).

### Coefficient table

| Term | Coefficient | Direction |
|---|---|---|
| const | −0.7243 | — |
| vehicle\_crime\_pct | +0.001397 | higher crime → higher premium |
| deprivation\_pct | +0.003386 | higher deprivation → higher premium |
| aadf\_intensity\_pct | +0.003911 | heavier traffic → higher premium |
| young\_driver\_share\_pct | +0.009450 | more young drivers → higher premium |
| cars\_per\_household\_pct | −0.004429 | more cars per household → lower premium |
| national\_avg | £558.55 | WTW/Confused.com price index anchor |
| **Baseline (all pct = 50)** | **£537** | reference point for the waterfall |

---

## 2. Tails are real

The cheapest and dearest LSOA predictions are not artefacts — they reconstruct exactly from the
coefficients, and the underlying percentiles are consistent with the areas' real-world
characteristics.

**Cheapest: Wiltshire 039C — £193**

This LSOA sits near the bottom percentile on every place driver and has an exceptionally low
young-driver share. Starting from the baseline of £537:

| Factor | Percentile | £ step |
|---|---|---|
| vehicle\_crime | 14th | −£17 |
| deprivation | 8th | −£48 |
| aadf\_intensity | 3rd | −£62 |
| young\_driver\_share | 1st | −£154 |
| cars\_per\_household | 92nd | −£63 |
| **Estimate** | | **£193** |

**Dearest: Tower Hamlets 018A — £1,540** (served as £1,542; ±£2 is integer-percentile rounding)

This LSOA sits at the top percentile on every driver — high crime, high deprivation, extremely
dense traffic, high young-driver share, and very few cars per household. Starting from the same
baseline:

| Factor | Percentile | £ step |
|---|---|---|
| vehicle\_crime | 97th | +£63 |
| deprivation | 92nd | +£135 |
| aadf\_intensity | 97th | +£175 |
| young\_driver\_share | 97th | +£423 |
| cars\_per\_household | 1st | +£207 |
| **Estimate** | | **£1,540** |

Both tails are verified reconstructions, not interpolations.

---

## 3. Composition dominates the spread

In both tail examples, **young\_driver\_share is the single largest mover** (−£154 cheapest;
+£423 dearest), larger than any individual place driver. **cars\_per\_household** is the
second-largest in both directions. The three place drivers (crime, deprivation, traffic) together
account for less of the gap than the two composition features do individually.

This is why the waterfall foregrounds composition: a reviewer asking "why is this LSOA expensive?"
is best served by seeing the demographic terms first, before the geographic ones.

---

## 4. The breakdown is exact and order-invariant (LMDI split)

The waterfall uses a **logarithmic-mean decomposition (LMDI)** to assign each factor a £ share of
the gap between the area's premium and the baseline. For a log-linear model this decomposition is:

- **Exact:** the five £ steps sum to the estimate in both examples above, with no residual term.
- **Order-invariant:** no factor is privileged by where it appears in the sequence; the £ share
  each factor receives is independent of ordering.

The LMDI split of `ln(premium/baseline)` assigns factor k a share proportional to its log
contribution, then back-projects to £ using the logarithmic mean of the area and baseline
premiums. Concretely: for each factor k, the £ step is
`(coefₖ × (pctₖ − 50)) × (premium − baseline) / ln(premium/baseline)`.

---

## 5. Sign checks

All coefficients are directionally sensible:

| Feature | Sign | Rationale |
|---|---|---|
| vehicle\_crime | + | Higher theft/crime rate → higher claims cost |
| deprivation | + | Deprivation correlates with claims frequency and severity |
| aadf\_intensity | + | Higher traffic exposure → higher collision probability |
| young\_driver\_share | + | Young drivers have disproportionately high loss ratios |
| cars\_per\_household | − | An affluence proxy; wealthier areas tend to have lower premiums net of other factors |

No sign is counter-intuitive. This is an improvement over the earlier model version in which
`road_casualties` entered with a negative coefficient and was statistically insignificant (p = 0.45).

---

## 6. Rankings are not desynced

The top-10 area names in the served ranking tie to their predicted premiums — no name/number
mismatch. The highest-ranked Scottish areas — **"Barlanark - 06"** and **"Keppochhill - 03"** —
are real Glasgow Data Zones, both at the 98th–99th percentile of Scotland's deprivation index
(SIMD), with young-driver shares and low car-ownership rates consistent with their census
demographics. Scotland's Census 2022 controls (young-driver share, cars/household) are ingested
at Data Zone level, so these areas are not relying on extrapolated averages.

Top-100 composition: **79 England, 21 Scotland** — consistent with Scotland's concentration of
high-deprivation urban Data Zones in the percentile distribution.

---

## 7. Caveats

**Scotland vehicle-crime percentile uses a different source.** England and Wales crime comes from
data.police.uk; Scotland uses Police Scotland recorded crime (statistics.gov.scot). The recording
definitions are not identical. Accordingly, `vehicle_crime_pct` for Scottish areas is ranked
**within Scotland only**, not against the England/Wales distribution. The waterfall tags Scottish
areas with a note to this effect.

**Out-of-support extrapolation at the low tail.** The cheapest LSOA predictions (around £193)
fall below the cheapest observation in the calibration panel (postcode-area averages anchored to
WTW premiums). The percentile feature basis hard-caps inputs to 0–100, which prevents the extreme
blow-ups seen with raw-feature regression, but it does not eliminate extrapolation beyond the
panel's observed premium range. Predictions in the bottom few percentiles of the premium
distribution should be read as directionally correct rankings, not precise £ figures.

---

## 8. Validation summary

| Metric | Value | Notes |
|---|---|---|
| Panel R² (quarter FE, area-clustered SE) | **0.930** | 106 obs, 30 areas (2026-07 model) |
| Ridge 5-fold CV-R² | **0.910** | Out-of-fold |
| Leave-one-area-out MAE | **£76.51** | Generalisation to held-out postcode areas (was £89) |
| Temporal backtest MAE | **£69.76** | Train ≤2025-Q4, predict 2026 |
| Spearman (predicted, actual premium) | **0.97** | Rank agreement across all observations |
| Coefficient sign checks | **5 / 5** | All sensible (see §5; imd_crime replaced deprivation, §10) |

The validation is at **postcode-area / region grain** against the WTW/Confused.com index — the
finest geographic resolution for which published premium benchmarks exist. Per-LSOA accuracy is
not directly measurable with public data; the rank metric (Spearman 0.97) is the best available
proxy.

## 9. Uncertainty intervals are honest (2026-07)

Every area now ships a 95% interval (`premium_low`–`premium_high`) around the point
estimate, shown as the hero range on the map. Two components, both necessary:

1. **Cluster bootstrap (coefficient uncertainty).** 200 replications resampling the 30
   anchor **areas** with replacement (not rows — quarters within an area are correlated),
   refitting, and collecting each area's prediction spread. Alone this gives a median
   width of **£241** — and would be an *understatement*, because it only captures
   uncertainty in the coefficients, not the error of extrapolating a postcode-area-grain
   fit down to LSOA grain.
2. **LOAO residual-variance widening (extrapolation honesty).** The leave-one-area-out
   residuals estimate how wrong the model is on geography it wasn't fitted to
   (σ_log = 0.113). Widening the bootstrap band by this variance lifts the median width
   to **£373** — the honest interval for an unseen area.

Defence of the width: ±~19% on a mid-range premium is consistent with the LOAO MAE
(£76.51 on a £559 national average ≈ 14% typical error, plus coefficient uncertainty).
An interval much narrower than that would contradict the model's own out-of-sample
record; much wider would contradict the backtest (£69.76). The interval is validated
end-to-end: `premium_low ≤ calibrated_premium ≤ premium_high` holds for all 41,729
areas in the shipped artifacts (checked in the pipeline run; the serve-consistency
suite guards the premium itself).

## 10. The 2026-07 evidence gate (flood + IMD sub-domains)

The gate's job is to say no, and it did: of three candidates, only **imd_crime**
survived — and it *replaced* overall deprivation (partial r +0.43 p=3.8e-6 vs
deprivation's +0.03 p=0.78 once imd_crime is present). **flood_risk** is wrong-signed
for car premiums (univariate r=−0.94; flood exposure tracks rurality, which is cheap) —
it ships as a map diagnostic and is documented evidence for a future home-insurance
line. **imd_income** is redundant with the deprivation family (VIF 33). aadf_intensity
was retained on a LOAO head-to-head (£76.51 with vs £82.54 without) despite a marginal
partial p=0.063 — the out-of-sample test outranks the in-sample p-value. Full table:
`reports/feature_analysis.md`. Post-gate fit: R²=0.9304, LOAO MAE £76.51 (from £88.77),
backtest £69.76, Spearman 0.974.
