# Phase 2 Implementation Plan — Anchor Expansion + Scotland Validation

> Per `NEXT_PHASE_DESIGN.md` §4 + §6. Branch: `phase2-anchor-expansion`.

**Goal:** broaden the calibration panel and finally **validate Scotland** (the top
open caveat from `MODEL_REVIEW.md` — the Scottish premium previously rested on
E+W-fit coefficients with no Scottish anchor). Add the schema for a second anchor
source so MoneySuperMarket/ABI can be pooled later with a source fixed-effect.

---

## What this phase changes vs Phase 1

Phase 1 delivered the relative-index methodology + place/composition split. Phase 2
is about **coverage and validation**, not methodology: more anchor areas, Scotland
inside the validation panel, and multi-source readiness.

---

### Task 1 — Validate Scotland via region mapping ✅ DONE

**Why it's now possible:** P0-b (Phase 0) ingested Scottish vehicle crime
(statistics.gov.scot); Scotland already had SIMD deprivation + density. So all
three PLACE features are present for Scotland at 100%. The Scottish anchor rows
already existed in the panel (Central Scotland, East & North East Scotland,
Highlands & Islands, Scottish Borders) but were being **skipped** because
`REGION_POSTCODE_AREAS` omitted Scotland (a now-stale "no Scottish crime" comment).

**Change:** added the four Scottish regions to `REGION_POSTCODE_AREAS`
(`src/calibrate/calibrate.py`) as a clean geographic partition of Scottish
postcode areas (documented in `data/manual/wtw_anchors_notes.md`).

**Result:**
- Matched panel obs: **95 → 103**, areas **23 → 27**.
- R²=0.910, CV-R²=0.895, **LOAO MAE £108 → £99.7**, Spearman 0.969.
- Scottish anchors fit better than average (~£39 vs ~£73 mean abs error).
- Scotland validates **place-only** (composition controls held at national mean —
  Scotland demographics are deferred, see Task 4).

**Tests:** `test_scottish_regions_mapped`, `test_region_postcode_areas_are_disjoint`
in `tests/test_calibrate.py`.

---

### Task 2 — Second-source schema (`source` column) ✅ DONE

**Change:**
- Added a brand-level `source` column to `data/manual/wtw_anchors_panel.csv`
  (all current rows = `confused`), distinct from `source_type` (press/pdf).
- `wtw_index.py` carries `source` through to the interim anchors.
- `calibrate.py` already adds a `C(source)` fixed-effect when >1 source is pooled
  (built in Phase 1) and `to_relative_index` defaults missing `source` to
  `confused` — so the multi-source path is wired and the absence of a 2nd source
  is handled gracefully.

This is schema prep with no behavioural change until a second source is added.

---

### Task 3 — MoneySuperMarket / ABI second source ⏸ DEFERRED (needs real data)

Adding a genuinely independent second anchor requires **transcribing real
published regional figures** from MSM/ABI reports. The panel is governed by a
strict **no-invented-figures** rule (`wtw_anchors_notes.md` §Data integrity), so
this cannot be fabricated. When the published figures are sourced:
1. Append rows with `source=moneysupermarket` (+ `source_url`, `source_type`).
2. Extend `REGION_POSTCODE_AREAS` / `NAME_ALIASES` for any new region names.
3. The OLS picks up `C(source)` automatically; report cross-source **rank
   correlation** (do sources agree on the spatial pattern?) — levels differ by
   methodology and are absorbed by the source FE.

---

### Task 4 — Scotland demographic controls ⏸ DEFERRED (boundary crosswalk)

Scotland's Census 2022 age + car-ownership are published on **2022 Data Zones**,
but the model keys on **2011 Data Zones** (boundaries, SIMD, crime all 2011 DZ).
A 2011↔2022 DZ crosswalk (areal/population apportionment) is needed before
Scottish composition controls can be merged. Until then Scotland is priced
place-only (full == place-only), which is honest and documented. This is the
remaining half of Phase 2 and the natural next coding step.

---

## Deferred to later phases (unchanged from NEXT_PHASE_DESIGN.md)

- **Phase 3:** DfT AADT traffic + STATS19 collisions revisit on a traffic denominator.
- **Phase 4:** EA/NRW/SEPA flood overlay; final variance decomposition; UI split.

---

## Success criteria for Phase 2

1. ✅ Scotland represented in the calibration panel (≥ a few anchors) — no longer
   extrapolation-only. (8 Scottish obs across 4 regions.)
2. ✅ Multi-source schema in place (`source` column + source FE path).
3. ⏸ Second independent source pooled — deferred pending real published figures.
4. ⏸ Scotland demographic controls — deferred pending 2011↔2022 DZ crosswalk.
5. ✅ Extrapolation stays bounded; all tests pass; ruff clean.
