# Transparency, Verification & Finalisation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the calibrated premium legible (an exact, order-invariant "waterfall" of what drives each area's price), guard it with a train/serve-consistency test, record the model audit, and polish the static map — staying on GitHub Pages.

**Architecture:** Bake an exact additive premium decomposition server-side (`build_risk_index.py`): a constant `premium_baseline` (premium with every factor at the median percentile) plus per-driver **LMDI step** `_contrib`s (logarithmic-mean split — exact, order-invariant) that integer-reconcile to the total. Ship them (plus 1-dp model-driver percentiles) in the static GeoJSON. The frontend reads the baked fields and renders a waterfall; a pytest guard recomputes from coefficients to prove serve == model.

**Tech Stack:** Python (pandas/numpy/geopandas, pytest), React + TypeScript + MapLibre (Vite), mapshaper bake. No new dependencies, no JS test runner (frontend verified via `npm run build` type-check + `npm run lint` + manual smoke).

**Reference spec:** `docs/superpowers/specs/2026-06-21-transparency-polish-finalize-design.md`

**Verified constants (from `reports/calibration.json`, used in test expectations):** const −0.7243; coefs vehicle_crime_pct +0.001397, deprivation_pct +0.003386, aadf_intensity_pct +0.003911, young_driver_share_pct +0.009450, cars_per_household_pct −0.004429; national_avg £558.55; baseline (all-median) £537.39; cheapest area £193 (Wiltshire 039C); dearest £1,542 (Tower Hamlets 018A).

**Why LMDI (not sequential):** the model is log-linear, so `ln(premium/baseline) = Σ coefₖ·(pctₖ−50)`. The LMDI split `stepₖ = L·coefₖ·(pctₖ−50)` with `L = (premium−baseline)/ln(premium/baseline)` is exact (`baseline + Σ stepₖ == premium`) **and order-invariant**. A sequential split was rejected because per-driver attribution swung up to £187 between orderings on the dearest area.

---

## Phase 0 — Audit note (no code)

### Task 1: Write AUDIT.md

**Files:**
- Create: `AUDIT.md`

- [ ] **Step 1: Write the audit note**

Create `AUDIT.md` recording the verification (documentation, not code). Include, in prose + a small table:
- the pricing formula `premium = national_avg × exp(const + Σ coefₖ·featureₖ_pct)` and the coefficient table from the header above;
- **tails are real:** cheapest £193 (Wiltshire 039C) = bottom-percentile on all three place drivers + young-driver 1st pct / cars 92nd; dearest £1,542 (Tower Hamlets 018A) = top-percentile throughout; both reconstruct exactly from the coefficients;
- **composition dominates the spread:** young-driver share and cars/household move the premium more than the place drivers — which is why the new waterfall foregrounds them;
- **the breakdown is exact and order-invariant** (LMDI logarithmic-mean split): each factor's £ step is its own share of the gap from the typical-area baseline, and the steps sum exactly to the estimate regardless of ordering;
- **sign checks:** all place coefficients positive, young-driver positive, cars/household negative (affluence proxy) — all sensible;
- **rankings are NOT desynced:** top-10 names tie to their premiums; "Barlanark - 06" / "Keppochhill - 03" are real Glasgow Data Zones (deprivation 98–99th pct, **real local demographics** — Scotland's census controls are ingested); top-100 = 79 England / 21 Scotland;
- **caveat:** Scotland vehicle-crime percentile is ranked within Scotland (different source) — not the same yardstick as England's; the waterfall tags it;
- **out-of-support note:** the cheapest LSOA predictions fall below the cheapest calibration-panel observation; the percentile basis bounds this but it is an extrapolation;
- **validation:** LOAO MAE £89, Spearman 0.97, panel R² 0.917.

- [ ] **Step 2: Commit**

```bash
git add AUDIT.md
git commit -m "docs: add model verification audit (tails, sign checks, rankings, caveats)"
```

---

## Phase 1 — Server-side premium waterfall

### Task 2: Failing unit tests for the exact, order-invariant decomposition

**Files:**
- Create: `tests/test_build_risk_index.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for the LMDI premium-waterfall decomposition (build_risk_index)."""
import pandas as pd

from src.transform.build_risk_index import decompose_premium

COEFS = {"const": -0.72, "a_pct": 0.004, "b_pct": 0.003, "c_pct": -0.002}
ORDER = ["a_pct", "b_pct", "c_pct"]           # a,b = place ; c = composition
PCT = pd.DataFrame({
    "a_pct": [10.0, 90.0, 50.0],
    "b_pct": [20.0, 80.0, 50.0],
    "c_pct": [95.0, 5.0, 50.0],
})


def test_reconciles_exactly():
    out = decompose_premium(PCT, COEFS, 558.55, ORDER, composition_cols={"c_pct"})
    recon = out["steps"].sum(axis=1).astype(int) + int(out["baseline"])
    assert (recon == out["premium_full"].astype(int)).all()


def test_all_median_row_equals_baseline():
    out = decompose_premium(PCT, COEFS, 558.55, ORDER, composition_cols={"c_pct"})
    assert int(out["premium_full"].iloc[2]) == int(out["baseline"])
    assert int(out["premium_place_only"].iloc[2]) == int(out["baseline"])
    # Row 0 has c_pct=95 (negative coef): full < place-only there.
    assert int(out["premium_full"].iloc[0]) < int(out["premium_place_only"].iloc[0])


def test_order_invariant():
    a = decompose_premium(PCT, COEFS, 558.55, ["a_pct", "b_pct", "c_pct"], {"c_pct"})
    b = decompose_premium(PCT, COEFS, 558.55, ["c_pct", "b_pct", "a_pct"], {"c_pct"})
    for col in ORDER:
        assert (a["steps"][col].astype(int) == b["steps"][col].astype(int)).all()


def test_missing_place_and_composition_columns_held_at_median():
    coefs = {"const": -0.72, "a_pct": 0.004, "d_pct": 0.005, "c_pct": -0.002}
    order = ["a_pct", "d_pct", "c_pct"]           # d = place, c = composition; both absent
    pct = pd.DataFrame({"a_pct": [10.0, 50.0]})   # only a_pct present
    out = decompose_premium(pct, coefs, 558.55, order, composition_cols={"c_pct"})
    assert (out["steps"]["d_pct"].astype(int) == 0).all()
    assert (out["steps"]["c_pct"].astype(int) == 0).all()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/test_build_risk_index.py -v`
Expected: FAIL with `ImportError: cannot import name 'decompose_premium'`.

### Task 3: Implement the LMDI decomposition + rebuild the bake

**Files:**
- Modify: `src/transform/build_risk_index.py` (add `decompose_premium`; rewrite `bake_premium_and_contributions`)

- [ ] **Step 1: Add the pure decomposition helper**

Insert this module-level function in `src/transform/build_risk_index.py` directly above `bake_premium_and_contributions` (after the `MEDIAN_PCT = 50.0` line):

```python
def decompose_premium(pct: pd.DataFrame, coefs: dict, national_avg: float,
                      order: list[str], composition_cols: set[str],
                      median_pct: float = MEDIAN_PCT) -> dict:
    """Exact, ORDER-INVARIANT additive premium waterfall (LMDI). Pure.

    The model is log-linear: ln(premium/baseline) = Σ coefₖ·(pctₖ − median). The
    logarithmic-mean (LMDI) split gives each factor an exact £ share of the gap from
    baseline:  stepₖ = L · coefₖ·(pctₖ − median),  L = (full − baseline)/ln(full/baseline),
    so baseline + Σ stepₖ == full and stepₖ depends only on factor k (no ordering).
    Missing/NaN cells are held at the median (step £0). Steps are integer-reconciled
    so round(baseline) + Σ round(step) == round(full) exactly.

    Returns {baseline:int, premium_full:Int64, premium_place_only:Int64, steps:Int64[order]}.
    """
    place_cols = [c for c in order if c not in composition_cols]

    # Per-factor log-contribution (order-independent); columns sum to ln(full/baseline).
    log_cols = {}
    for col in order:
        if col in pct.columns:
            vals = pct[col].fillna(median_pct)
        else:
            vals = pd.Series(median_pct, index=pct.index)
        log_cols[col] = float(coefs[col]) * (vals - median_pct)
    log_df = pd.DataFrame(log_cols)[order]
    total_log = log_df.sum(axis=1)

    baseline = float(national_avg) * np.exp(
        float(coefs["const"]) + median_pct * sum(float(coefs[c]) for c in order)
    )
    full = baseline * np.exp(total_log)
    place_log = (log_df[place_cols].sum(axis=1) if place_cols
                 else pd.Series(0.0, index=pct.index))
    place_only = baseline * np.exp(place_log)

    # Logarithmic mean L(full, baseline) = (full−baseline)/ln(full/baseline); → baseline
    # as full → baseline (all factors at the median).
    tl = total_log.to_numpy()
    diff = (full - baseline).to_numpy()
    safe = np.where(np.abs(tl) < 1e-12, 1.0, tl)
    L = np.where(np.abs(tl) < 1e-12, baseline, diff / safe)
    raw = log_df.mul(pd.Series(L, index=pct.index), axis=0)        # £ steps; Σ == full − baseline

    # Integer reconciliation: the largest-|step| factor per row absorbs the rounding residual.
    baseline_int = round(baseline)
    full_int = full.round()                                        # rounded ONCE; reused below
    steps_int = raw.round()
    residual = (full_int - baseline_int - steps_int.sum(axis=1)).to_numpy()
    arr = steps_int.to_numpy(dtype=float).copy()                  # pandas 3.x: to_numpy is read-only
    pick = raw.abs().to_numpy().argmax(axis=1)
    arr[np.arange(len(arr)), pick] += residual
    steps_int = pd.DataFrame(arr, index=pct.index, columns=order)

    return {
        "baseline": int(baseline_int),
        "premium_full": full_int.astype("Int64"),
        "premium_place_only": place_only.round().astype("Int64"),
        "steps": steps_int.astype("Int64"),
    }
```

- [ ] **Step 2: Rewrite `bake_premium_and_contributions` to use it**

Replace the entire body of `bake_premium_and_contributions` (keep the signature) with:

```python
def bake_premium_and_contributions(features: pd.DataFrame, comps: list[str]) -> dict:
    """Bake the premium, the constant baseline, and per-driver LMDI step
    £-contributions (exact, order-invariant waterfall) from the calibration
    coefficients. baseline + Σ {driver}_contrib == calibrated_premium, to the pound."""
    calib_path = ROOT / "reports" / "calibration.json"
    calib = json.loads(calib_path.read_text()) if calib_path.exists() else {}
    coefs = calib.get("coefficients", {})
    national_avg = calib.get("national_avg_latest")
    if not coefs or national_avg is None:
        log.info("No calibration yet — skipping premium; risk_index falls back to composite.")
        for c in comps:
            features[f"{c}_contrib"] = 0.0
        return {}

    composition_cols = set(calib.get("composition_features", []))
    order = [c for c in coefs if c != "const"]          # place then composition (insertion order)
    missing = [c for c in order if c not in features.columns]
    if missing:
        log.warning("Calibration features missing — held at the national median (pct=50): %s", missing)

    pct = features.reindex(columns=order)                # missing cols -> NaN -> median inside
    res = decompose_premium(pct, coefs, float(national_avg), order, composition_cols)

    features["premium_baseline"] = res["baseline"]
    features["calibrated_premium"] = res["premium_full"]
    features["premium_place_only"] = res["premium_place_only"]

    steps = res["steps"]
    priced: set[str] = set()
    for col in order:
        base = col[:-4] if col.endswith("_pct") else col
        features[f"{base}_contrib"] = steps[col]
        priced.add(base)
    for c in comps:                                      # non-model features contribute £0
        if c not in priced:
            features[f"{c}_contrib"] = 0
    log.info("Baked premium (£%s–£%s, baseline £%s) + %d LMDI step contribs",
             int(features['calibrated_premium'].min()), int(features['calibrated_premium'].max()),
             res["baseline"], len(order))
    return coefs
```

- [ ] **Step 3: Run the unit tests to verify they pass**

Run: `pytest tests/test_build_risk_index.py -v`
Expected: PASS (all four tests).

- [ ] **Step 4: Run the full Python test suite (no regressions)**

Run: `make test`
Expected: all pass (existing calibrate/aggregate tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/transform/build_risk_index.py tests/test_build_risk_index.py
git commit -m "feat: exact order-invariant premium waterfall (LMDI baseline + step contribs)"
```

### Task 4: Ship `premium_baseline` in the slim GeoJSON (FastAPI dev path)

**Files:**
- Modify: `src/transform/build_risk_index.py` (the `keep` list in `run()`, currently ~line 261)

> Note: this slim gzipped GeoJSON is served by the FastAPI dev server (`make api`), NOT by GitHub Pages. The static Pages asset gets `premium_baseline` via `bake_static._BASE_PROPS` (Task 5). This task keeps the two paths in parity.

- [ ] **Step 1: Add the field to the GeoJSON keep list**

In `run()`, immediately after the block that appends `premium_place_only`:

```python
    if "premium_place_only" in gdf.columns:
        keep.append("premium_place_only")
    if "premium_baseline" in gdf.columns:                # NEW: waterfall anchor (API-path parity)
        keep.append("premium_baseline")
```

- [ ] **Step 2: Commit**

```bash
git add src/transform/build_risk_index.py
git commit -m "feat: carry premium_baseline into the slim risk GeoJSON (api parity)"
```

### Task 5: Bake `premium_baseline` + 1-dp model-driver percentiles into the static asset

**Files:**
- Modify: `src/showcase/bake_static.py` (`_BASE_PROPS`, `_round_props`)

- [ ] **Step 1: Add `premium_baseline` to the base props**

```python
_BASE_PROPS = ["lsoa11cd", "lsoa_name", "calibrated_premium",
               "premium_place_only", "premium_baseline", "risk_index", "quintile"]
```

- [ ] **Step 2: Ship 1-dp driver percentiles so the premium is reproducible from the file**

Replace `_round_props` with a driver/diagnostic-aware version:

```python
def _round_props(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Coarsen numbers to cut JSON entropy. Model-driver percentiles ship at 1 dp
    (the premium is computed from 1-dp percentiles upstream, so this keeps the
    served premium exactly reproducible — see tests/test_serve_consistency.py).
    Diagnostic percentiles are display-only -> whole integers. £ figures -> whole £."""
    out = gdf.copy()
    if "risk_index" in out:
        out["risk_index"] = out["risk_index"].round(0).astype("Int64")
    if "premium_baseline" in out:
        out["premium_baseline"] = out["premium_baseline"].round(0).astype("Int64")
    for c in _DRIVERS:
        if f"{c}_pct" in out:
            out[f"{c}_pct"] = out[f"{c}_pct"].round(1)          # 1 dp (float)
        if f"{c}_contrib" in out:
            out[f"{c}_contrib"] = out[f"{c}_contrib"].round(0).astype("Int64")
    for c in _DIAGNOSTICS:
        if f"{c}_pct" in out:
            out[f"{c}_pct"] = out[f"{c}_pct"].round(0).astype("Int64")
    return out
```

- [ ] **Step 3: Commit**

```bash
git add src/showcase/bake_static.py
git commit -m "feat: bake premium_baseline + 1-dp driver percentiles into the static map"
```

### Task 6: FastAPI dev-path parity

**Files:**
- Modify: `src/api/main.py` (`COMPONENT_COLS` ~line 20; the `/api/risk` comment + response ~line 172-199)

> The FastAPI app is local-dev only (not used by the Pages site), but it reads the same parquet `{c}_contrib` columns whose meaning changed. This keeps it consistent: include the two composition drivers (the biggest movers) and surface the baseline.

- [ ] **Step 1: Add the composition drivers to `COMPONENT_COLS`**

Replace `COMPONENT_COLS` with (drivers first, then diagnostics — all preserved):

```python
COMPONENT_COLS = [
    "vehicle_crime",
    "deprivation",
    "aadf_intensity",
    "young_driver_share",
    "cars_per_household",
    "road_casualties",
    "population_density",
    "traffic_per_capita",
    "ksi_collisions_per_billion_vehicle_miles",
]
```

- [ ] **Step 2: Surface `premium_baseline` and fix the stale comment in `get_risk`**

Change the components comment (lines ~172-174) from "the £ each factor adds … vs a national-average area" to:

```python
    # Components mirror the baked parquet: percentile + the LMDI £ step each factor
    # contributes to the premium ({c}_contrib), an exact share of the gap from the
    # median-area baseline. Features not in the premium model carry £0.
```

In the returned dict, add `premium_baseline` next to the other premium figures:

```python
        "calibrated_premium_estimate": full,           # full (place + composition)
        "premium_place_only": place_only,              # at national-average demographics
        "premium_baseline": _num(row.get("premium_baseline")),   # median-area anchor
```

- [ ] **Step 3: Run the API smoke test**

Run: `pytest tests/test_api.py -v`
Expected: PASS (existing API tests still pass; the response just gained a field).

- [ ] **Step 4: Commit**

```bash
git add src/api/main.py
git commit -m "feat(api): parity with the map — composition drivers + premium_baseline"
```

### Task 7: Regenerate the model outputs and static assets

**Files:**
- Regenerates: `data/processed/lsoa_risk.{parquet,geojson.gz}`, `reports/calibration.{json,md}`, `frontend/public/data/areas.geojson`

- [ ] **Step 1: Re-run the calibration → risk → bake pipeline**

Run: `make calibrate`
Expected: logs show `Baked premium (£193–£1542, baseline £537) + 5 LMDI step contribs` and `Wrote … areas.geojson`. (Coefficients are unchanged; only the bake/serve change.)

- [ ] **Step 2: Spot-check the regenerated file (None-safe)**

Run:
```bash
python3 -c "
import json
g=json.load(open('frontend/public/data/areas.geojson'))
feats=g['features']
p=feats[0]['properties']
assert 'premium_baseline' in p, 'baseline missing'
# find a feature with a non-null driver pct and confirm it is 1-dp (float, not int)
for f in feats:
    v=f['properties'].get('vehicle_crime_pct')
    if v is not None:
        assert isinstance(v, float), f'pct should be 1-dp float, got {type(v)} {v}'
        print('ok — baseline', p['premium_baseline'], 'sample driver pct', v); break
"
```
Expected: prints `ok — baseline 537 …` and a float percentile.

- [ ] **Step 3: Commit the regenerated static asset** (data/ + reports/ are git-ignored; only the served asset is tracked)

```bash
git add frontend/public/data/areas.geojson
git commit -m "chore: re-bake static map with baseline + LMDI waterfall contribs"
```

---

## Phase 2 — Serve-consistency guard

### Task 8: Train/serve consistency test

**Files:**
- Create: `tests/test_serve_consistency.py`

- [ ] **Step 1: Write the test**

```python
"""Guards that the SERVED map matches the CURRENT model coefficients — kills
train/serve skew and the percentile-precision gap. Skips if assets aren't built."""
import json
import math

import pytest

from src.common.config import ROOT

GEO = ROOT / "frontend" / "public" / "data" / "areas.geojson"
CALIB = ROOT / "reports" / "calibration.json"


def _load():
    if not GEO.exists() or not CALIB.exists():
        pytest.skip("served geojson / calibration.json not built (run `make calibrate`)")
    return json.loads(CALIB.read_text()), json.loads(GEO.read_text())["features"]


def _order(coefs):
    return [c for c in coefs if c != "const"]


def test_baseline_matches_coefficients():
    calib, feats = _load()
    coefs, na = calib["coefficients"], calib["national_avg_latest"]
    expected = na * math.exp(coefs["const"] + 50.0 * sum(coefs[c] for c in _order(coefs)))
    baselines = {f["properties"].get("premium_baseline") for f in feats} - {None}
    assert baselines, "no premium_baseline shipped"
    for b in baselines:
        assert abs(b - expected) <= 1, f"served baseline {b} != {expected:.2f} — train/serve skew"


def test_premium_reproducible_from_shipped_percentiles():
    calib, feats = _load()
    coefs, na = calib["coefficients"], calib["national_avg_latest"]
    order = _order(coefs)
    bad = []
    for f in feats:
        p = f["properties"]
        served = p.get("calibrated_premium")
        if served is None:
            continue
        z = coefs["const"] + sum(coefs[c] * (p.get(c) if p.get(c) is not None else 50.0) for c in order)
        if abs(na * math.exp(z) - served) > 1:
            bad.append(p.get("lsoa11cd"))
    assert not bad, f"{len(bad)} areas not reproducible within £1 (precision/skew), e.g. {bad[:5]}"


def test_waterfall_reconciles_exactly():
    calib, feats = _load()
    order = _order(calib["coefficients"])
    bases = [c[:-4] if c.endswith("_pct") else c for c in order]
    bad = []
    for f in feats:
        p = f["properties"]
        prem, base = p.get("calibrated_premium"), p.get("premium_baseline")
        if prem is None or base is None:
            continue
        s = sum((p.get(f"{b}_contrib") or 0) for b in bases)
        if base + s != prem:
            bad.append((p.get("lsoa11cd"), base + s, prem))
    assert not bad, f"{len(bad)} areas where baseline+Σcontrib != premium, e.g. {bad[:5]}"


def test_signs_and_extrema_are_sane():
    calib, feats = _load()
    coefs = calib["coefficients"]
    for c in ("vehicle_crime_pct", "deprivation_pct", "aadf_intensity_pct"):
        assert coefs[c] > 0, f"place driver {c} should raise premium"
    prems = [f["properties"]["calibrated_premium"] for f in feats
             if f["properties"].get("calibrated_premium") is not None]
    assert 100 <= min(prems) and max(prems) <= 3000, f"premium range {min(prems)}–{max(prems)} implausible"
```

- [ ] **Step 2: Run the test**

Run: `pytest tests/test_serve_consistency.py -v`
Expected: PASS (after the Task 7 re-bake). If `test_premium_reproducible…` or `test_baseline…` fails, the served asset is stale — re-run `make calibrate` and re-commit.

- [ ] **Step 3: Commit**

```bash
git add tests/test_serve_consistency.py
git commit -m "test: guard served map against model coefficients (train/serve skew + precision)"
```

---

## Phase 3 — Frontend waterfall

### Task 9: Types for the waterfall

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add `premium_baseline` and a `WaterfallStep` shape**

In `LsoaProps`, add after `calibrated_premium?: number;`:

```typescript
  premium_baseline?: number;     // £ premium with every factor at the median percentile
```

Add a new exported interface above `AreaDetail`:

```typescript
export interface WaterfallStep {
  key: string;
  label: string;
  percentile?: number;
  step: number;                  // signed £ contribution (LMDI; sums with baseline to the total)
  kind: 'place' | 'composition';
  withinScotland?: boolean;      // crime is ranked within Scotland — flag it
}
```

In `AreaDetail`, add after `composition_uplift?: number;`:

```typescript
  premium_baseline?: number;
  steps?: WaterfallStep[];
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npm run build`
Expected: builds (no type errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat(ui): types for the premium waterfall"
```

### Task 10: Build the steps in `utils.ts` + give `dominantDriver` a direction

**Files:**
- Modify: `frontend/src/utils.ts`

- [ ] **Step 1: Add the ordering + grouping constants**

After the `MODEL_DRIVERS` / `DIAGNOSTIC_LAYERS` declarations, add:

```typescript
// Canonical DISPLAY order (place drivers first, then composition controls). LMDI
// step magnitudes are order-invariant, so this only sets the on-screen sequence.
export const WATERFALL_ORDER = [
  'vehicle_crime', 'deprivation', 'aadf_intensity',     // place
  'young_driver_share', 'cars_per_household',            // composition
] as const;
const PLACE_KEYS = new Set<string>(['vehicle_crime', 'deprivation', 'aadf_intensity']);
```

- [ ] **Step 2: Build `steps` + `premium_baseline` in `featureToDetail`**

In `featureToDetail`, after the existing `components` array is built and before the `return`, add:

```typescript
  const baseline = props.premium_baseline as number | undefined;
  const steps = baseline == null
    ? undefined
    : WATERFALL_ORDER.map((key) => ({
        key,
        label: COMPONENT_LABELS[key] ?? key,
        percentile: props[`${key}_pct`] as number | undefined,
        step: Number(props[`${key}_contrib`] ?? 0),
        kind: (PLACE_KEYS.has(key) ? 'place' : 'composition') as 'place' | 'composition',
        withinScotland: key === 'vehicle_crime' && String(props.lsoa11cd).startsWith('S'),
      }));
```

Then add to the returned object (after `composition_uplift: …,`):

```typescript
    premium_baseline: baseline,
    steps,
```

- [ ] **Step 3: Make `dominantDriver` return a direction**

Add an exported type and replace the whole `dominantDriver` function:

```typescript
export interface DominantDriver { key: string; dir: 'up' | 'down'; }

// The factor that moves THIS area's premium most, in either direction, with its sign:
// 'up' = pushes the premium up, 'down' = pulls it down.
export function dominantDriver(
  props: Record<string, any>
): DominantDriver | null {
  let bestKey: string | null = null;
  let bestMag = -Infinity;
  let bestSigned = 0;
  for (const key of MODEL_DRIVERS) {
    const c = props[`${key}_contrib`];
    if (c == null) continue;
    const v = Number(c);
    if (Math.abs(v) > bestMag) {
      bestMag = Math.abs(v);
      bestKey = key;
      bestSigned = v;
    }
  }
  return bestKey == null ? null : { key: bestKey, dir: bestSigned >= 0 ? 'up' : 'down' };
}
```

- [ ] **Step 4: Type-check + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: builds clean (RankingsPanel is updated in Task 12; it currently consumes `dominantDriver` as a string and WILL error here — proceed to Task 12 in the same change set, then re-run). To keep commits green, do Tasks 10 and 12 together before building.

- [ ] **Step 5: Commit (with Task 12)**

Defer the commit until Task 12 so the build is green; see Task 12 Step 3.

### Task 11: Render the waterfall in `DetailPanel.tsx`

**Files:**
- Modify: `frontend/src/DetailPanel.tsx`

- [ ] **Step 1: Remove the now-unused `drivers` const + sort (REQUIRED)**

`tsconfig.app.json` sets `noUnusedLocals: true` and `npm run build` runs `tsc -b`, so leaving these will fail the build. Delete the `const drivers` line and the full `drivers.sort(...)` call:

```tsx
  const drivers = data.components.filter((c) => c.kind === 'driver');
```
and
```tsx
  // Biggest premium effect first (by absolute £ contribution).
  drivers.sort(
    (a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0)
  );
```

Keep `const diagnostics = …` (still used by the diagnostics block) and `const color = …`.

- [ ] **Step 2: Replace the "What moves the premium" block with the waterfall**

Replace the entire `{/* Premium drivers */}` block (the `drivers.length > 0` section) with this. The diagnostics block below it stays unchanged:

```tsx
      {/* Premium waterfall — exact, order-invariant bridge from the typical-GB baseline */}
      {data.steps && data.premium_baseline != null && premium != null && (() => {
        const maxAbs = Math.max(1, ...data.steps.map((s) => Math.abs(s.step)));
        return (
          <div className="section" style={{ borderTop: 'none', paddingBottom: 0 }}>
            <span className="eyebrow">Why this price</span>
            <div className="waterfall" aria-label="Breakdown of the estimated premium by factor">
              <div className="wf-row wf-anchor">
                <span className="wf-label">Typical GB area</span>
                <span className="wf-amount">{gbp(data.premium_baseline)}</span>
              </div>
              {data.steps.map((s) => {
                const active = colorMode !== 'composite' && s.key === colorMode;
                const up = s.step >= 0;
                return (
                  <div key={s.key} className={`wf-row wf-step${active ? ' wf-active' : ''}`}>
                    <span className="wf-label">
                      {s.label}
                      {s.percentile != null && (
                        <span className="wf-pct">{ordinalPct(s.percentile)} pct</span>
                      )}
                      {s.withinScotland && <span className="diag-tag">within Scotland</span>}
                    </span>
                    <span className="wf-track">
                      <span className={`wf-bar ${up ? 'wf-up' : 'wf-down'}`}
                            style={{ width: `${(Math.abs(s.step) / maxAbs) * 50}%` }} />
                    </span>
                    <span className={`wf-delta ${up ? 'pos' : 'neg'}`}>
                      {up ? '+' : '−'}{gbp(Math.abs(s.step))}
                    </span>
                  </div>
                );
              })}
              <div className="wf-row wf-total">
                <span className="wf-label">This area</span>
                <span className="wf-amount" style={{ color }}>{gbp(premium)}</span>
              </div>
            </div>
            <p className="drivers-note">
              Each step is this area's factor versus a national-median area; the steps add up
              exactly to the estimate, and each factor's share is independent of ordering.
            </p>
          </div>
        );
      })()}
```

- [ ] **Step 3: Build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: type errors only from `RankingsPanel` consuming the new `dominantDriver` return (fixed in Task 12). If you did Task 10 already, complete Task 12 before expecting a clean build.

- [ ] **Step 4: Commit (DetailPanel only — utils/RankingsPanel commit in Task 12)**

```bash
git add frontend/src/DetailPanel.tsx
git commit -m "feat(ui): render the premium as an exact LMDI waterfall bridge"
```

### Task 12: Direction-aware rankings chip

**Files:**
- Modify: `frontend/src/RankingsPanel.tsx`

- [ ] **Step 1: Consume the new `dominantDriver` shape with a direction glyph**

In `RankingsPanel.tsx`, the `driver` const + chip render currently expect a string. Replace:

```tsx
          const driver = feature?.properties
            ? dominantDriver(feature.properties as Record<string, any>)
            : null;
```
keep as-is (it now returns `DominantDriver | null`), and replace the chip JSX:

```tsx
                  {driver && (
                    <span className="driver-chip">
                      {COMPONENT_LABELS[driver.key] ?? driver.key}
                    </span>
                  )}
```
with:

```tsx
                  {driver && (
                    <span className={`driver-chip ${driver.dir === 'up' ? 'chip-up' : 'chip-down'}`}>
                      {driver.dir === 'up' ? '▲' : '▼'} {COMPONENT_LABELS[driver.key] ?? driver.key}
                    </span>
                  )}
```

- [ ] **Step 2: Build + lint the whole frontend**

Run: `cd frontend && npm run build && npm run lint`
Expected: clean (Tasks 10, 11, 12 together type-check).

- [ ] **Step 3: Commit utils + RankingsPanel together**

```bash
git add frontend/src/utils.ts frontend/src/RankingsPanel.tsx
git commit -m "feat(ui): direction-aware dominant-driver chip (▲ dearer / ▼ cheaper)"
```

### Task 13: Waterfall styles

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Append waterfall styles**

Add at the end of `index.css` (reuse existing tokens; `--ink-faint: #8a8175` already exists):

```css
/* ---- Premium waterfall ---------------------------------------------------- */
.waterfall { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.wf-row { display: grid; grid-template-columns: 1fr 64px auto; align-items: center;
  gap: 8px; padding: 4px 0; font-size: 13px; }
.wf-label { display: flex; align-items: center; gap: 6px; color: var(--ink, #24211c);
  flex-wrap: wrap; }
.wf-pct { font-size: 11px; color: var(--ink-faint); opacity: .85; }
.wf-track { position: relative; height: 8px; }
.wf-bar { position: absolute; top: 0; height: 8px; border-radius: 2px; }
.wf-up { right: 50%; background: #c44536; }       /* dearer → grows left from centre */
.wf-down { left: 50%; background: #4f9d7f; }       /* cheaper → grows right from centre */
.wf-track::before { content: ''; position: absolute; left: 50%; top: -2px; height: 12px;
  width: 1px; background: rgba(0,0,0,.18); }
.wf-delta { font-variant-numeric: tabular-nums; font-weight: 600; }
.wf-delta.pos { color: #9e2a2b; }
.wf-delta.neg { color: #2f6f57; }
.wf-anchor, .wf-total { grid-template-columns: 1fr auto; font-weight: 700; }
.wf-anchor { color: #6b675f; border-bottom: 1px dashed rgba(0,0,0,.12); }
.wf-total { border-top: 1px solid rgba(0,0,0,.18); margin-top: 2px; padding-top: 8px;
  font-size: 15px; }
.wf-amount { font-variant-numeric: tabular-nums; }
.wf-active .wf-label { font-weight: 700; }
.chip-up { color: #9e2a2b; }
.chip-down { color: #2f6f57; }
```

- [ ] **Step 2: Manual smoke test**

Run: `cd frontend && npm run dev`
Open the local URL; click the "Least expensive" ranking #1 (Wiltshire 039C) and confirm: anchor "Typical GB area £537", five signed steps that visually + numerically add up, total "This area £193". Repeat for Tower Hamlets (dear) and a Glasgow Data Zone (▼/▲ chip + "within Scotland" tag on crime).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "style(ui): diverging premium-waterfall + direction-chip styling"
```

---

## Phase 4 — Polish

### Task 14: Responsive + legibility pass

**Files:**
- Modify: `frontend/src/index.css` (existing responsive blocks)

- [ ] **Step 1: Ensure the waterfall reads on narrow screens**

In the existing mobile media query (search `@media` in `index.css`), add:

```css
@media (max-width: 560px) {
  .wf-row { grid-template-columns: 1fr auto; }
  .wf-track { display: none; }            /* keep the signed £ + percentile, drop the bar */
}
```

- [ ] **Step 2: Manual smoke at mobile width**

Run: `cd frontend && npm run dev`; narrow the window < 560px; confirm the waterfall, search, rankings and map remain usable.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "style(ui): responsive waterfall + mobile legibility"
```

### Task 15: Copy + accessibility tie-off

**Files:**
- Modify: `frontend/src/AboutPanel.tsx`

- [ ] **Step 1: Align About copy with AUDIT.md**

In `AboutPanel.tsx`, confirm the `aadf_intensity` and Scotland-crime descriptions match the AUDIT.md wording (within-Scotland crime ranking; AADF as the density replacement; Scotland HAS local demographics). Adjust copy only if inconsistent — no structural change.

- [ ] **Step 2: Build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit (only if changed)**

```bash
git add frontend/src/AboutPanel.tsx
git commit -m "polish(ui): about copy aligned with the audit"
```

### Task 16: Final verification

- [ ] **Step 1: Full backend test suite**

Run: `make test`
Expected: all green, including `test_build_risk_index.py`, `test_serve_consistency.py`, `test_api.py`.

- [ ] **Step 2: Production frontend build**

Run: `cd frontend && npm run build`
Expected: succeeds; `frontend/dist/` produced.

- [ ] **Step 3: Confirm the deployed-asset parity**

Run:
```bash
python3 -c "
import json
a=json.load(open('frontend/public/data/areas.geojson'))['features']
prem=[f['properties']['calibrated_premium'] for f in a if f['properties'].get('calibrated_premium') is not None]
print('areas',len(prem),'min',min(prem),'max',max(prem),'baseline',a[0]['properties']['premium_baseline'])
"
```
Expected: `areas 41729 min 193 max 1542 baseline 537`.

- [ ] **Step 4: Working tree clean**

```bash
git status   # expect clean
```

---

## Self-review checklist (done before handing off)

- **Spec coverage:** A1 audit → Task 1. A2 guard → Task 8. B LMDI bake → Tasks 2–7. B client render → Tasks 9–13. §5.6 API parity → Task 6. C polish → Tasks 14–15. Verification → Task 16. ✓
- **`_contrib` meaning change consumers:** `DetailPanel` (Task 11), `RankingsPanel.dominantDriver` (Tasks 10+12), FastAPI `/api/risk` (Task 6). ✓
- **Type consistency:** `WaterfallStep`/`premium_baseline`/`steps` defined in Task 9, consumed in Tasks 10–11. `DominantDriver` defined in Task 10, consumed in Task 12. `decompose_premium` signature defined in Task 3, tested in Task 2. ✓
- **Blocker fixed:** `.to_numpy().copy()` (Task 3) avoids the pandas-3.x read-only crash; `full_int` rounded once. ✓
- **Order-invariance:** LMDI (Task 3) + permutation test (Task 2). ✓
- **Build-gating:** mandatory `drivers` deletion (Task 11 Step 1); Tasks 10+12 committed together to keep builds green. ✓
- **Precision close:** 1-dp driver percentiles (Task 5) make the premium reproducible (Task 8). ✓
- **CSS valid:** `--ink-faint` token, no invalid hex. ✓
- **No placeholders:** all code blocks complete. ✓
