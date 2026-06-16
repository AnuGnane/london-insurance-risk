# Phase 1 Implementation Plan — Methodology Switch + Demographic Controls + Significance Report

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Re-base the model on a *relative territorial index* and add Census demographic **controls**, so the model reports the **place effect** on a fixed-driver premium separately from the **composition effect**, plus a feature-significance report.

**Architecture:** New `census_demographics` ingest → merged into the feature table → `calibrate.py` fits `log(premium / national_avg)` on place features + composition controls → `build_risk_index.py` bakes three numbers (full headline, place/composition attribution, place-only counterfactual) → new `reports/feature_analysis.md`.

**Tech Stack:** Python 3.11, pandas, geopandas, statsmodels, scikit-learn, duckdb, requests; data from Nomis (E+W Census 2021) and NRS/statistics.gov.scot (Scotland Census 2022).

Scope: **no frontend changes** in Phase 1 (UI place/composition split is deferred to a later sub-phase per the design). Verified via API responses + reports.

---

### Task 1: Census demographics ingest (E+W)

**Files:**
- Create: `src/ingest/census_demographics.py`
- Test: `tests/test_census_demographics.py`

Features: `young_driver_share` (residents aged 17–24 ÷ residents 17+) and `cars_per_household`
(mean cars/vans per household). Source: Nomis bulk CSV — TS007A (age by single year / bands) and
TS045 (car/van availability) at LSOA 2021. **Discovery step first** (Nomis bulk-download URL + column
codes vary), mirroring how `scotland_crime.py` probed SPARQL before coding.

- [ ] **Step 1: Probe Nomis for the bulk-CSV endpoints and column codes**

Run (discovery, not committed):
```bash
# TS045 car/van availability, LSOA 2021, bulk CSV
curl -sL "https://www.nomisweb.co.uk/api/v01/dataset/NM_2063_1.bulk.csv?time=latest&measures=20100&geography=TYPE151" -o /tmp/ts045.csv && head -3 /tmp/ts045.csv && wc -l /tmp/ts045.csv
# TS007A age structure, LSOA 2021
curl -sL "https://www.nomisweb.co.uk/api/v01/dataset/NM_2020_1.bulk.csv?time=latest&measures=20100&geography=TYPE151" -o /tmp/ts007.csv && head -3 /tmp/ts007.csv
```
Expected: CSVs with an LSOA `geography code` column and category columns. Confirm the dataset ids
(`NM_2063_1` = TS045, `NM_2020_1` = TS007A — verify against https://www.nomisweb.co.uk/sources/census_2021_bulk) and the exact age-band / car-count column headers. Record the real ids/columns before coding.

- [ ] **Step 2: Write the failing test (pure transform on a fixture)**

```python
# tests/test_census_demographics.py
import pandas as pd
from src.ingest.census_demographics import derive_young_driver_share, derive_cars_per_household

def test_young_driver_share():
    # 17-24 band = 200, total 17+ = 1000 -> 0.20
    age = pd.DataFrame({"area_code": ["E01000001"], "age_17_24": [200], "age_17_plus": [1000]})
    out = derive_young_driver_share(age)
    assert abs(out.loc[0, "young_driver_share"] - 0.20) < 1e-9

def test_cars_per_household():
    # households: 10 with 0, 20 with 1, 5 with 2, 1 with 3+  => (0+20+10+3)/36
    cars = pd.DataFrame({"area_code": ["E01000001"], "hh_0": [10], "hh_1": [20], "hh_2": [5], "hh_3plus": [1]})
    out = derive_cars_per_household(cars)
    assert abs(out.loc[0, "cars_per_household"] - (33/36)) < 1e-9
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/test_census_demographics.py -q`
Expected: FAIL (functions not defined).

- [ ] **Step 4: Implement the pure transforms + fetchers**

Implement `derive_young_driver_share(df)` and `derive_cars_per_household(df)` as pure functions matching
the test. Add `_fetch_nomis_bulk(dataset_id) -> pd.DataFrame` using `src.common.http.get_with_retry`,
parsing the real columns found in Step 1; map age bands to `age_17_24`/`age_17_plus` and car bands to
`hh_0/1/2/3plus` (treat "3+" inclusive, weight 3 — conservative, documented). `run()` writes
`data/interim/demographics.parquet` with columns `area_code, nation, young_driver_share, cars_per_household`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_census_demographics.py -q`
Expected: PASS.

- [ ] **Step 6: Run the ingest for real (E+W) and sanity-check**

Run: `uv run python -m src.ingest.census_demographics`
Expected: ~35,672 E+W rows; `young_driver_share` median ≈ 0.10–0.13, `cars_per_household` median ≈ 1.1–1.3.

- [ ] **Step 7: Commit**

```bash
git add src/ingest/census_demographics.py tests/test_census_demographics.py
git commit -m "feat: ingest Census 2021 demographic controls (E+W)"
```

---

### Task 2: Scotland demographics — DEFERRED to Phase 2

**Decision (2026-06-16, in-flight):** Scotland's Census 2022 car/age is published on **2022 Data Zones**,
but the model keys on **2011 Data Zones**; statistics.gov.scot doesn't expose a boundary-matched 2011
census table cleanly. Rather than build a 2011↔2022 DZ crosswalk now, Scotland demographics move to
**Phase 2** — where Scottish *premium anchors* also arrive, so Scotland first becomes validatable. The
calibration fit is unaffected (the WTW panel is E+W only).

To keep Scotland priced in the meantime, **Task 7's reconstruction holds missing composition controls
at the national mean** (percentile 50), so a Scottish area's headline equals its *place-only* premium
("priced at national-average demographics"). Documented as a Phase-1 limitation. No code in this task.

---

### Task 3: Declare feature buckets in config

**Files:**
- Modify: `config/config.yaml`

- [ ] **Step 1: Add a `features` block tagging each as place vs composition**

```yaml
features:
  place: [vehicle_crime, deprivation, population_density]   # road_casualties re-added in Phase 3
  composition: [young_driver_share, cars_per_household]
```
Keep `risk_index.weights` for the no-calibration fallback. Add under `calibration:` a
`response: relative_index` flag and `premium_features` continues to list the PLACE features used in the
headline model (now read from `features.place`).

- [ ] **Step 2: Commit**

```bash
git add config/config.yaml
git commit -m "feat: declare place/composition feature buckets in config"
```

---

### Task 4: Merge demographics into the feature table

**Files:**
- Modify: `src/transform/aggregate_to_lsoa.py`
- Test: `tests/test_aggregate.py` (add a case)

- [ ] **Step 1: Add a failing test that demographics columns land in the feature table**

```python
def test_demographics_merged(tmp_features):
    # build features with a stubbed demographics.parquet present
    feats = run_and_load()  # helper that runs aggregate on fixtures
    assert {"young_driver_share", "cars_per_household"}.issubset(feats.columns)
```
(If `tests/test_aggregate.py` lacks fixtures, add a minimal one writing tiny parquets to a tmp interim dir.)

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_aggregate.py -q` → FAIL.

- [ ] **Step 3: Implement the merge**

In `run()`, after the existing merges, read `demographics.parquet` (if present) and left-merge on
`area_code`. Demographics are GB-comparable (Census definitions consistent within nation); no zero-fill —
leave NaN if a source is missing and let the percentile/reweight handle it.

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_aggregate.py -q` → PASS.

- [ ] **Step 5: Run aggregate for real**

Run: `uv run python -m src.transform.aggregate_to_lsoa`
Expected: feature table now has the two demographic columns, 41,729 rows.

- [ ] **Step 6: Commit**

```bash
git add src/transform/aggregate_to_lsoa.py tests/test_aggregate.py
git commit -m "feat: merge demographic controls into the feature table"
```

---

### Task 5: Relative-index response + composition controls in calibration

**Files:**
- Modify: `src/calibrate/calibrate.py`
- Test: `tests/test_calibrate.py` (add cases)

- [ ] **Step 1: Add failing tests for the new pieces**

```python
def test_relative_index_response():
    import pandas as pd
    from src.calibrate.calibrate import to_relative_index
    panel = pd.DataFrame({"quarter": ["2024-Q1","2024-Q1"], "avg_premium_gbp": [1500, 500]})
    out = to_relative_index(panel)
    # national avg for the quarter = 1000 -> indices 1.5 and 0.5
    assert abs(out.loc[0, "premium_index"] - 1.5) < 1e-9
    assert abs(out.loc[1, "premium_index"] - 0.5) < 1e-9

def test_bucketed_features_split():
    from src.calibrate.calibrate import PLACE_COLS, COMPOSITION_COLS
    assert "vehicle_crime_pct" in PLACE_COLS
    assert "young_driver_share_pct" in COMPOSITION_COLS
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_calibrate.py -q` → FAIL.

- [ ] **Step 3: Implement**

- `to_relative_index(panel)`: per quarter, `national_avg = mean(avg_premium_gbp)` (or weighted);
  `premium_index = avg_premium_gbp / national_avg`. Persist the per-quarter national averages to
  `reports/calibration.json` so `build_risk_index` can reconstruct £.
- Read buckets from config: `PLACE_COLS = [f"{f}_pct" for f in features.place]`,
  `COMPOSITION_COLS = [f"{f}_pct" for f in features.composition]`.
- `_panel_ols`: regress `log(premium_index) ~ PLACE_COLS + COMPOSITION_COLS + C(source)`
  (source FE — single source for now, so it drops out). Cluster SEs by area as today.
- Coefficients persisted keyed by `{feature}_pct`, tagged with bucket. Keep ridge CV / LOAO / temporal,
  now predicting the index (convert MAE back to £ via the national average for reporting).

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_calibrate.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibrate/calibrate.py tests/test_calibrate.py
git commit -m "feat: relative-index response + place/composition controls in calibration"
```

---

### Task 6: Feature-significance report + spatial-multiplier checks

**Files:**
- Modify: `src/calibrate/calibrate.py`
- Create (output): `reports/feature_analysis.md`

- [ ] **Step 1: Implement `feature_analysis(matched)`**

For each feature in PLACE ∪ COMPOSITION: univariate Pearson + Spearman vs `premium_index`; partial
correlation controlling the others; VIF (`statsmodels.stats.outliers_influence.variance_inflation_factor`);
OLS p-value; keep/drop verdict (significant at .05 AND VIF<10). Plus a place-vs-composition variance
decomposition: R² of place-only model, composition-only model, and full model.

- [ ] **Step 2: Implement `spatial_multiplier_checks(coefs, pca, national_avg)`**

For named pairs (e.g. WC London "WC" vs Rugby "CV"; Inner London vs South West) compute predicted index
ratio and compare to published ratios in the panel where available. Write a small table.

- [ ] **Step 3: Write both into `reports/feature_analysis.md` and extend `calibration.md`**

- [ ] **Step 4: Run calibrate and eyeball the report**

Run: `uv run python -m src.calibrate.calibrate && sed -n '1,40p' reports/feature_analysis.md`
Expected: a table with correlations/VIF/p-values/verdicts and the variance decomposition.

- [ ] **Step 5: Commit**

```bash
git add src/calibrate/calibrate.py reports/feature_analysis.md reports/calibration.md
git commit -m "feat: feature-significance report + spatial-multiplier checks"
```

---

### Task 7: Bake the three numbers in build_risk_index + API

**Files:**
- Modify: `src/transform/build_risk_index.py`, `src/api/main.py`
- Test: `tests/test_api.py` (extend)

- [ ] **Step 1: Implement reconstruction in `build_risk_index`**

From persisted coefs (index space) + national average:
- `premium_full_£ = national_avg × exp(const + Σ place + Σ composition)`
- `premium_place_only_£ = national_avg × exp(const + Σ place + Σ composition_at_national_mean)`
  (composition pct held at 50 — the percentile mean — i.e. national-average demographics)
- attribution: `place_£` and `composition_£` such that they explain `premium_full − national_avg×exp(const)`.
Bake `calibrated_premium` (= full), `premium_place_only`, and `{feature}_contrib` (£) for all features.
`risk_index` stays the percentile of `calibrated_premium`.

- [ ] **Step 2: Extend `/api/risk` to return the three numbers**

Add `premium_place_only` and a `composition`/`place` split alongside the existing `components`. Keep
NaN-safe (`_num`).

- [ ] **Step 3: Add/extend API test**

```python
def test_risk_has_place_only(client):
    r = client.get("/api/risk", params={"postcode": "E1 6AN"}).json()
    assert "premium_place_only" in r
    assert r["calibrated_premium_estimate"] is not None
```

- [ ] **Step 4: Run pipeline + tests + lint**

Run:
```bash
uv run python -m src.transform.build_risk_index
uv run pytest -q && uv run ruff check src/
```
Expected: PASS, clean; premiums bounded; 0 nulls.

- [ ] **Step 5: Commit**

```bash
git add src/transform/build_risk_index.py src/api/main.py tests/test_api.py
git commit -m "feat: bake full/place-only/attribution premiums; expose via API"
```

---

### Task 8: Update docs + verify end to end

**Files:**
- Modify: `README.md`, `STATUS.md`, `MODEL_REVIEW.md`

- [ ] **Step 1: Update calibration numbers, feature list (controls), and the place/composition framing.**
- [ ] **Step 2: Full verification**

Run:
```bash
uv run pytest -q && uv run ruff check src/
uv run python3 -c "from fastapi.testclient import TestClient; from src.api.main import app;\
import json;\
c=TestClient(app); c.__enter__();\
print({k: c.get('/api/risk', params={'postcode':p}).json().get('calibrated_premium_estimate') for k,p in {'Lon':'WC1A 1AA','Rugby':'CV21 2AA'}.items()})"
```
Expected: London premium materially > Rugby (reproduces the spatial spread that motivated the project).

- [ ] **Step 3: Commit**

```bash
git add README.md STATUS.md MODEL_REVIEW.md
git commit -m "docs: document relative-index model + place/composition split"
```

---

## Self-review notes

- **Spec coverage:** demographic controls (T1–T2,T4), place/composition split + three numbers (T5,T7),
  relative index (T5), significance report (T6), spatial-multiplier check (T6,T8). Anchors/traffic/flood
  are later phases by design — not in this plan.
- **Type consistency:** coefficients keyed `{feature}_pct` throughout; `PLACE_COLS`/`COMPOSITION_COLS`
  derived from `config.features`; `national_avg` persisted in `calibration.json` and consumed by
  `build_risk_index`.
- **Deferred:** frontend place/composition UI (later sub-phase); Scotland anchors (Phase 2).
