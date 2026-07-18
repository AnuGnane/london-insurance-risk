# Waves 1–2: Model Wave Completion + Vouched Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the flood/IMD-subdomain/uncertainty-interval model wave (one evidence-gate calibrate cycle), then formalize and refresh the Vouched district-premium bridge with provenance stamps and flip district scaling live.

**Architecture:** Wave 1 runs on the **main checkout** `/Users/anugnana/Library/Projects/london-insurance-risk` (branch `docs-finalize-transparency`, which carries the July implementation commits `43fb405`/`cfe74df`/`3af592d`/`a39321c`). It completes the ingest re-run, extends IMD sub-domains to full GB coverage (Wales WIMD + Scotland income — **mandatory before candidacy**: `calibrate.py:245` drops any anchor row with a NaN place feature), activates three gate candidates (`flood_risk`, `imd_crime`, `imd_income`), and runs one `make calibrate` cycle that simultaneously gates the candidates and generates the bootstrap+LOAO premium intervals. Wave 2 edits the Vouched contract (§3, meta-only provenance), stamps + regenerates `area-premiums.json` from the new model, adds a drift guard, and hands the flag flip to the founder.

**Tech Stack:** Python 3.11 (pandas, geopandas, statsmodels), pytest, ruff; Vite/React/TS frontend; Vouched side is stdlib-only Python + a frozen JSON contract.

**Spec:** `docs/superpowers/specs/2026-07-17-vouched-synergy-and-next-wave-design.md`

**Execution context notes (read first):**
- All Wave 1 commands run from `/Users/anugnana/Library/Projects/london-insurance-risk` (NOT the planning worktree). Python = the repo venv (`uv run python …` or `.venv/bin/python`).
- A long flood-intersection job (`python -m src.ingest.flood`, PID ~80236) may still be running. **Do not start Task 6 or re-run flood until it has exited.** Do not kill it.
- `src/common/esri.py` has uncommitted changes the running job may depend on. Do not touch/commit that file until Task 1 confirms the flood run completed successfully.
- Never run `make risk` alone after touching calibration — `make calibrate` is the only entry point used here (train/serve-skew guard).
- Never commit anything under `data/` or `reports/`.
- The founder reviews/creates PRs themselves; commit locally, don't push or open PRs unprompted.

---

### Task 1: Verify the flood ingest output

**Files:** none modified (verification only)

- [ ] **Step 1: Confirm the flood job has exited**

Run: `ps aux | grep "src.ingest.flood" | grep -v grep`
Expected: no output (job finished). If still running, STOP this plan and resume later — do not proceed to any step that touches the pipeline.

- [ ] **Step 2: Confirm it succeeded and inspect the output**

Run:
```bash
cd /Users/anugnana/Library/Projects/london-insurance-risk
uv run python - <<'EOF'
import pandas as pd, geopandas as gpd
f = pd.read_parquet("data/interim/flood.parquet")
b = gpd.read_parquet("data/interim/area_boundaries.parquet")[["area_code", "nation"]]
df = pd.DataFrame(b).merge(f, on="area_code", how="left")
print(df.groupby("nation")["flood_risk"].agg(["count", "mean", "max", lambda s: s.isna().sum()]))
assert set(df["nation"].unique()) == {"england", "wales", "scotland"}
for nation, g in df.groupby("nation"):
    assert g["flood_risk"].notna().sum() > 0, f"{nation} has NO flood coverage"
    vals = g["flood_risk"].dropna()
    assert vals.between(0, 1).all(), f"{nation} has flood_risk outside [0, 1]"
print("OK: all three nations have flood coverage")
EOF
```
Expected: per-nation stats print; all three nations have non-null coverage; values in [0, 1]. If `flood.parquet` doesn't exist or a nation is all-NaN, STOP and diagnose the flood run log before anything else (do NOT activate `flood_risk` in config).

- [ ] **Step 3: Commit the in-flight `esri.py` changes (only now that the run validated)**

Run: `git -C /Users/anugnana/Library/Projects/london-insurance-risk diff src/common/esri.py` — review the diff, then:
```bash
cd /Users/anugnana/Library/Projects/london-insurance-risk
uv run pytest tests/test_esri.py tests/test_flood.py -q
git add src/common/esri.py
git commit -m "fix(esri): refinements from the England RoFRS ingest run"
```
Expected: tests pass first; commit succeeds. If tests fail, apply superpowers:systematic-debugging before committing.

### Task 2: Wales WIMD sub-domains (income + community safety)

Wales currently has NO `imd_crime`/`imd_income` columns — activating the candidates without this task drops every Welsh anchor row from calibration.

**Files:**
- Modify: `src/ingest/imd.py` (`_wales()`, lines ~108–126; docstring)
- Test: `tests/test_imd.py` (create or extend)

- [ ] **Step 1: Discover the WIMD domain fields (verify-then-code)**

Run:
```bash
curl -s "https://services9.arcgis.com/3DS2hBWXSllJ5p3H/arcgis/rest/services/Welsh_Index_of_Multiple_Deprivation_WIMD_2019_Overall/FeatureServer/0?f=pjson" | python3 -c "import json,sys; print([f['name'] for f in json.load(sys.stdin)['fields']])"
```
Expected: a field list. **Branch A** — if it contains per-domain rank fields (names like `income_rank` / `income`, `community_safety_rank` / `comm_safety`): note the exact names and use them in Step 3 via `out_fields`. **Branch B** — if only overall rank: list the org's services (`curl -s "https://services9.arcgis.com/3DS2hBWXSllJ5p3H/arcgis/rest/services?f=pjson"`), find the WIMD **Income** and **Community Safety** domain services, and fetch each with a second `fetch_arcgis_attributes` call. Record which branch + exact names in the commit message.

- [ ] **Step 2: Write the failing test**

In `tests/test_imd.py` (create the file with these imports if absent):
```python
import pandas as pd
import pytest

from src.ingest.imd import _within_nation_percentile


def test_wales_subdomain_columns_join():
    """Wales rows must carry imd_income_rank and imd_crime_rank so GB-wide
    candidate coverage is complete (calibrate drops NaN place-feature rows)."""
    from src.ingest.imd import WALES_DOMAIN_FIELDS
    assert "imd_income_rank" in WALES_DOMAIN_FIELDS.values()
    assert "imd_crime_rank" in WALES_DOMAIN_FIELDS.values()
```
Run: `uv run pytest tests/test_imd.py::test_wales_subdomain_columns_join -v`
Expected: FAIL with ImportError (`WALES_DOMAIN_FIELDS` not defined).

- [ ] **Step 3: Implement**

In `src/ingest/imd.py`, add a module-level constant mapping the ArcGIS field names discovered in Step 1 (adjust the keys to the real names):
```python
# WIMD 2019 domain ranks (Welsh Gov ArcGIS). Wales has no pure "crime" domain;
# COMMUNITY SAFETY (police-recorded crime + ASB + fire) is the closest analogue
# and is used as Wales's imd_crime. Within-nation percentile ranking means only
# the ordering matters, so the definitional difference is acceptable — documented
# here and in DATA_PROVENANCE_AND_TRANSFORMS.md.
WALES_DOMAIN_FIELDS = {
    "income_rank": "imd_income_rank",           # ← real field name from Step 1
    "community_safety_rank": "imd_crime_rank",  # ← real field name from Step 1
}
```
Extend `_wales()` to request and rename those fields. Branch A (fields on the Overall layer):
```python
def _wales() -> pd.DataFrame:
    fields = "lsoa_code,rank," + ",".join(WALES_DOMAIN_FIELDS)
    ranks = pd.DataFrame(
        fetch_arcgis_attributes(WIMD_OVERALL_URL, out_fields=fields, page_size=2000)
    ).rename(columns={"lsoa_code": "area_code", "rank": "deprivation_rank",
                      **WALES_DOMAIN_FIELDS})
    ...  # rest unchanged
```
Branch B (separate domain services): add the two service URLs as module constants, fetch each with `fetch_arcgis_attributes(url, out_fields="lsoa_code,rank", page_size=2000)`, rename `rank` to the target column, and left-merge onto `ranks` by `area_code`. Update the module docstring's Wales source lines either way.

- [ ] **Step 4: Run the test**

Run: `uv run pytest tests/test_imd.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/imd.py tests/test_imd.py
git commit -m "feat(imd): Wales WIMD income + community-safety domain ranks (2.3 candidates)"
```

### Task 3: Scotland SIMD income domain rank

**Files:**
- Modify: `src/ingest/imd.py` (`_scotland()`, lines ~129–152)
- Test: `tests/test_imd.py`

- [ ] **Step 1: Discover the SIMD income column name**

Run:
```bash
cd /Users/anugnana/Library/Projects/london-insurance-risk
python3 -c "import pandas as pd; print([c for c in pd.read_csv('data/raw/simd2020v2.csv', nrows=1).columns if 'ncome' in c or 'Rank' in c])"
```
Expected: column names print; find the income-domain rank (likely `SIMD2020_Income_Domain_Rank`). If the cached CSV is absent it re-downloads on ingest — in that case fetch the header via the URL in `SIMD_CSV_URL`.

- [ ] **Step 2: Write the failing test**

```python
def test_scotland_income_domain_mapped():
    from src.ingest.imd import SCOTLAND_DOMAIN_FIELDS
    assert "imd_income_rank" in SCOTLAND_DOMAIN_FIELDS.values()
    assert "imd_crime_rank" in SCOTLAND_DOMAIN_FIELDS.values()
```
Run: `uv run pytest tests/test_imd.py::test_scotland_income_domain_mapped -v` — FAIL (not defined).

- [ ] **Step 3: Implement**

Refactor `_scotland()`'s inline `keep`-dict domain handling into a module constant, preserving the existing fallback-name pattern:
```python
# SIMD 2020v2 domain-rank columns → our names. Keys are tried in order (the NHS
# CSV has used both spellings across releases).
SCOTLAND_DOMAIN_FIELDS = {
    "SIMD_2020v2_Crime_Domain_Rank": "imd_crime_rank",
    "CrimeDomainRank": "imd_crime_rank",
    "SIMD2020_Income_Domain_Rank": "imd_income_rank",   # ← confirm vs Step 1
    "IncomeDomainRank": "imd_income_rank",
}
```
and in `_scotland()` replace the two `if/elif` lines with:
```python
    keep = {"DataZone": "area_code", "SIMD2020V2Rank": "deprivation_rank"}
    taken: set[str] = set()
    for src_col, dest in SCOTLAND_DOMAIN_FIELDS.items():
        if src_col in simd.columns and dest not in taken:
            keep[src_col] = dest
            taken.add(dest)
```

- [ ] **Step 4: Run tests** — `uv run pytest tests/test_imd.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/imd.py tests/test_imd.py
git commit -m "feat(imd): Scotland SIMD income domain rank (2.3 candidate)"
```

### Task 4: Within-nation percentiles for the sub-domains

**Files:**
- Modify: `src/ingest/imd.py` (`_within_nation_percentile`, lines ~155–164; `run()` `sub_cols` line ~182)
- Test: `tests/test_imd.py`

- [ ] **Step 1: Write the failing test**

```python
def test_within_nation_percentile_covers_subdomains():
    """Sub-domain ranks (1 = most deprived) become 0-1 percentiles, higher =
    worse, same convention as deprivation_pct."""
    df = pd.DataFrame({
        "deprivation_rank": [1, 2, 3, 4],
        "imd_crime_rank": [4, 3, 2, 1],
        "imd_income_rank": [1, 3, 2, 4],
    })
    out = _within_nation_percentile(df)
    assert out["deprivation_pct"].tolist() == pytest.approx([1.0, 2 / 3, 1 / 3, 0.0])
    assert out["imd_crime_pct"].tolist() == pytest.approx([0.0, 1 / 3, 2 / 3, 1.0])
    assert out["imd_income_pct"].iloc[0] == 1.0  # rank 1 = most deprived = 1.0
```
Run: `uv run pytest tests/test_imd.py::test_within_nation_percentile_covers_subdomains -v` — FAIL (`imd_crime_pct` KeyError).

- [ ] **Step 2: Implement**

Replace `_within_nation_percentile` with:
```python
_RANK_TO_PCT = {
    "deprivation_rank": "deprivation_pct",
    "imd_crime_rank": "imd_crime_pct",
    "imd_income_rank": "imd_income_pct",
}


def _within_nation_percentile(df: pd.DataFrame) -> pd.DataFrame:
    """Add 0–1 within-nation percentiles (higher = more deprived) for the overall
    rank and any sub-domain ranks present. Ranks are nation-specific (1 = most
    deprived); the percentile is what makes nations comparable."""
    df = df.copy()
    for rank_col, pct_col in _RANK_TO_PCT.items():
        if rank_col in df.columns:
            n = df[rank_col].max()
            df[pct_col] = (n - df[rank_col]) / (n - 1)
    return df
```
In `run()`, extend the sub-column pass-through list (line ~182):
```python
    sub_cols = ["imd_crime_rank", "imd_crime_score", "imd_crime_pct",
                "imd_income_rank", "imd_income_score", "imd_income_pct"]
```

- [ ] **Step 3: Run all imd tests** — `uv run pytest tests/test_imd.py -v` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ingest/imd.py tests/test_imd.py
git commit -m "feat(imd): within-nation percentiles for crime/income sub-domains"
```

### Task 5: Pass sub-domain features through the aggregate

**Files:**
- Modify: `src/transform/aggregate_to_lsoa.py` (deprivation slice, lines ~175–177; docstring)
- Test: `tests/test_aggregate_to_lsoa.py` (extend; check the existing test file name with `ls tests/`)

- [ ] **Step 1: Write the failing test**

Add to the aggregate test file (match its existing import style):
```python
def test_subdomain_passthrough_slice():
    from src.transform.aggregate_to_lsoa import deprivation_features
    import pandas as pd
    dep = pd.DataFrame({
        "area_code": ["A", "B"],
        "deprivation_pct": [0.2, 0.9],
        "imd_crime_pct": [0.1, 0.8],
        "imd_income_pct": [0.3, 0.7],
    })
    out = deprivation_features(dep)
    assert list(out.columns) == ["area_code", "deprivation", "imd_crime", "imd_income"]


def test_subdomain_passthrough_absent_columns_ok():
    from src.transform.aggregate_to_lsoa import deprivation_features
    import pandas as pd
    dep = pd.DataFrame({"area_code": ["A"], "deprivation_pct": [0.5]})
    out = deprivation_features(dep)
    assert list(out.columns) == ["area_code", "deprivation"]
```
Run: `uv run pytest tests/test_aggregate_to_lsoa.py -k subdomain -v` — FAIL (no `deprivation_features`).

- [ ] **Step 2: Implement**

In `aggregate_to_lsoa.py`, add a pure function above `run()`:
```python
def deprivation_features(dep: pd.DataFrame) -> pd.DataFrame:
    """Slice the deprivation table to model feature columns: the overall
    within-nation percentile plus any IMD sub-domain percentiles present
    (roadmap 2.3 evidence-gate candidates). Pure function."""
    rename = {"deprivation_pct": "deprivation",
              "imd_crime_pct": "imd_crime",
              "imd_income_pct": "imd_income"}
    cols = ["area_code"] + [c for c in rename if c in dep.columns]
    return dep[cols].rename(columns=rename)
```
and replace lines ~175–177 (`deprivation = dep[["area_code", "deprivation_pct"]].rename(...)`) with:
```python
    deprivation = deprivation_features(dep)
```
Add `imd_crime` / `imd_income` to the docstring's column list.

- [ ] **Step 3: Run tests** — `uv run pytest tests/test_aggregate_to_lsoa.py -v` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/transform/aggregate_to_lsoa.py tests/test_aggregate_to_lsoa.py
git commit -m "feat(features): pass IMD crime/income sub-domain percentiles to the feature table"
```

### Task 6: Re-run the ingests (everything except flood)

`make ingest` would re-run the expensive flood intersections — run the modules individually instead.

**Files:** none (pipeline execution)

- [ ] **Step 1: Run the remaining ingest modules** (boundaries + flood already done)

```bash
cd /Users/anugnana/Library/Projects/london-insurance-risk
for m in onspd police_crime stats19 imd scotland_crime census_demographics traffic aadf; do
  uv run python -m src.ingest.$m || break
done
```
Expected: each module logs and writes its interim parquet; most read from `data/raw/` caches. police.uk is rate-limited — if `police_crime` starts long network fetches, let it run (cached responses make re-runs fast). This step can take a while; run it in the background and monitor.

- [ ] **Step 2: Verify the interim table set is complete**

```bash
ls data/interim/
```
Expected (at minimum): `area_boundaries.parquet`, `postcode_lookup.parquet`, `vehicle_crime.parquet`, `scotland_vehicle_crime.parquet`, `collisions.parquet`, `deprivation.parquet`, `demographics.parquet`, `traffic.parquet`, `aadf.parquet`, `flood.parquet`.

- [ ] **Step 3: Verify GB-wide candidate coverage (the anchor-row-drop guard)**

```bash
uv run python - <<'EOF'
import pandas as pd
dep = pd.read_parquet("data/interim/deprivation.parquet")
cov = dep.groupby("nation")[["imd_crime_pct", "imd_income_pct"]].apply(lambda g: g.notna().mean())
print(cov)
assert (cov > 0.95).all().all(), "sub-domain coverage gap — would drop anchor rows in calibrate"
print("OK: imd_crime/imd_income covered in all three nations")
EOF
```
Expected: `OK`. If a nation fails, go back to Tasks 2/3 — do NOT proceed to config activation.

- [ ] **Step 4: Commit** — nothing to commit (data is git-ignored). Note ingest completion in the session log.

### Task 7: Activate the three gate candidates in config

**Files:**
- Modify: `config/config.yaml` (features.place, ~line 54; calibration block)

- [ ] **Step 1: Edit `features.place`**

Replace the commented `flood_risk` block (the 4 comment lines starting `# - flood_risk`) with active entries:
```yaml
  place:
    - vehicle_crime
    - deprivation
    - aadf_intensity
    # Evidence-gate CANDIDATES (2026-07 cycle) — keep/demote per
    # reports/feature_analysis.md after `make calibrate`:
    - flood_risk     # Phase 4: share of area in High/Medium flood zone, within-nation ranked
    - imd_crime      # IoD2019 crime / SIMD crime / WIMD community-safety, within-nation pct
    - imd_income     # IoD2019 income / SIMD income / WIMD income, within-nation pct
```

- [ ] **Step 2: Sync `calibration.premium_features`** (documented as kept in sync with `features.place`) — add the same three names if that list is present in the `calibration:` block.

- [ ] **Step 3: Sanity-check config loads**

Run: `uv run python -c "from src.common.config import settings; print(settings['features']['place'])"`
Expected: six names print.

- [ ] **Step 4: Commit**

```bash
git add config/config.yaml
git commit -m "feat(config): activate flood_risk + imd_crime + imd_income as evidence-gate candidates"
```

### Task 8: The evidence-gate calibrate cycle

**Files:** none modified in this task except possibly `config/config.yaml` (demotions)

- [ ] **Step 1: Build features and run the gate**

```bash
cd /Users/anugnana/Library/Projects/london-insurance-risk
uv run make features && uv run make calibrate
```
Expected: `lsoa_features.parquet` rebuilds with `flood_risk`, `imd_crime`, `imd_income` columns; calibrate logs the panel fit, writes `reports/calibration.json`, `reports/feature_analysis.md`, `reports/premium_intervals.parquet`, then re-runs `build_risk_index` + `showcase-data`. Watch the log line `Dropped N matched rows missing a place feature` — **N must be 0** (any drop means a coverage gap; stop and fix before interpreting the fit).

- [ ] **Step 2: Read the verdicts**

Run: `cat reports/feature_analysis.md`
Record per candidate: partial r, partial p, VIF, verdict. Also compare headline metrics vs the June baseline (R² 0.9168, LOAO MAE £88.77): `cat reports/calibration.json | python3 -m json.tool | head -40`.

- [ ] **Step 3: Act on the verdicts**

For each candidate with verdict `weak` (or wrong-signed): move it from `features.place` to `features.diagnostics` in `config/config.yaml` with a one-line comment citing the numbers (mirror the Phase-3 KSI/traffic style in that file). Watch specifically for: `imd_income` collinear with `deprivation` (income is a large IMD component — VIF is the judge) and `imd_crime` collinear with `vehicle_crime`. If ANY demotion happened:
```bash
uv run make calibrate
git add config/config.yaml
git commit -m "model: evidence-gate verdicts — <kept list> kept, <demoted list> demoted to diagnostics"
```
If nothing was demoted, commit nothing here (config already committed in Task 7).

- [ ] **Step 4: Verify the intervals landed end-to-end**

```bash
uv run python - <<'EOF'
import pandas as pd
r = pd.read_parquet("data/processed/lsoa_risk.parquet")
assert {"premium_low", "premium_high", "calibrated_premium"} <= set(r.columns)
assert (r["premium_low"] <= r["calibrated_premium"]).all()
assert (r["calibrated_premium"] <= r["premium_high"]).all()
print("premium span:", int(r["calibrated_premium"].min()), "-", int(r["calibrated_premium"].max()))
print("median interval width:", int((r["premium_high"] - r["premium_low"]).median()))
EOF
```
Expected: assertions pass. **Record the premium span** — Wave 2 Task 12 needs it to review the Vouched £150–£2,000 gate.

- [ ] **Step 5: Full test suite + lint**

Run: `uv run pytest -q && uv run ruff check src tests`
Expected: all pass. (The served-map-vs-coefficients guard test from `bfc1cd9` must pass — it catches train/serve skew.)

### Task 9: Frontend — flood layer + verify intervals in the browser

**Files:**
- Modify: `frontend/src/types.ts` (ColorMode union), `frontend/src/utils.ts` (labels + driver/diagnostic lists), `frontend/src/Sidebar.tsx` (COLOR_MODES), `frontend/src/App.tsx` (validFilters), `frontend/src/AboutPanel.tsx` (DATA_SOURCES)

Exact member names below may have drifted — open each file and match its current shape; the edit intent is fixed.

- [ ] **Step 1: Wire `flood_risk` into the five lists**

- `types.ts`: add `| 'flood_risk'` to the `ColorMode` union.
- `utils.ts`: add `flood_risk: 'Flood risk'` to `COMPONENT_LABELS`. If the Task 8 verdict **kept** flood as a driver: add `'flood_risk'` to `MODEL_DRIVERS`, `WATERFALL_ORDER`, and `PLACE_KEYS`. If **demoted**: add it to `DIAGNOSTIC_LAYERS` instead.
- `Sidebar.tsx`: add the flood entry to `COLOR_MODES` (driver or diagnostic section per verdict).
- `App.tsx`: add `'flood_risk'` to the `validFilters` array.
- `AboutPanel.tsx`: add three source rows to `DATA_SOURCES` — EA Risk of Flooding from Rivers and Sea (Defra, OGL), SEPA Flood Maps (OGL), NRW Flood Risk (OGL).
- Do the same wiring for `imd_crime`/`imd_income` **only if kept** as drivers (kept candidates appear in the waterfall; demoted sub-domains stay off the map for now — they duplicate the deprivation layer visually).

- [ ] **Step 2: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Browser-verify (preview tools, not manual)**

Start the frontend dev server via the preview tooling, then: (a) map renders, flood layer selectable and colours sensibly (coastal/estuary areas high); (b) click an area — the hero shows the point premium **and** the range line ("£520–£640"); (c) the waterfall still sums exactly (baseline + steps = premium); (d) no console errors. Screenshot as proof.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(ui): flood layer + gate-outcome wiring; intervals verified in browser"
```

### Task 10: Docs close-out + hygiene

**Files:**
- Modify: `STATUS.md` (or its moved location under `docs/superpowers/info/`), `AUDIT.md`, `DATA_PROVENANCE_AND_TRANSFORMS.md`, `PHASE4_PLAN.md`
- The dirty docs-reorg (root docs deleted, `docs/superpowers/info/` untracked) is ANOTHER session's in-progress work — inspect `git status`; if the reorg looks complete and consistent, commit it as its own `docs:` commit; if unclear, leave it and flag to the founder in the final report.

- [ ] **Step 1: STATUS.md** — Phase 4 flood COMPLETE (gate outcome + numbers), uncertainty bands COMPLETE, IMD sub-domains gate outcome, new calibration headline (n, R², LOAO MAE vs June baseline).

- [ ] **Step 2: AUDIT.md interval defence** — add a section: bootstrap-only intervals capture coefficient uncertainty only and would understate at LSOA grain; the LOAO residual-variance widening is the honest extrapolation correction; state the median interval width and the widening ratio from `reports/calibration.json`'s bootstrap block.

- [ ] **Step 3: DATA_PROVENANCE_AND_TRANSFORMS.md** — entries for: EA RoFRS via Defra SFTP GDB tiles (include the SFTP runbook: request → credentials → 83-tile download → `RoFRS_4band` extraction → `england_rofrs_combined.parquet` cache; credentials are git-ignored per `7b04e54`/`1423cad`), SEPA ArcGIS REST, NRW WFS, WIMD domain ranks (community-safety-as-crime caveat), SIMD income domain.

- [ ] **Step 4: PHASE4_PLAN.md** — mark complete, one-paragraph outcome summary pointing at the spec + feature_analysis.

- [ ] **Step 5: Final verification + commit**

```bash
uv run pytest -q && uv run ruff check src tests
git add STATUS.md AUDIT.md DATA_PROVENANCE_AND_TRANSFORMS.md PHASE4_PLAN.md
git commit -m "docs: Phase 4 + uncertainty bands + 2.3 candidates close-out"
```
Founder reviews and creates the PR (do not push unprompted). **Wave 1 done.**

---

### Task 11: Vouched contract edit — provenance meta fields (§3)

**Files:**
- Modify: `/Users/anugnana/Library/Projects/Car Marketplace/vouched-workstream-split.md` (§3.1 area-premiums section, ~line 67)

- [ ] **Step 1: Add the provenance amendment to §3.1**

Directly after the §3.1 schema code block and its three bullet points, insert:
```markdown
*Amended 18 Jul 2026 (integrator-approved, additive, meta-only — v1.3 areas/fallback_regions
schemas unchanged):* `meta` additionally carries provenance so staleness against the source
model is detectable: `model_commit` (git sha of the london-insurance-risk commit the export
was built from), `model_calibration_date` (ISO date of that repo's reports/calibration.json),
`anchors_n` (int), `r_squared` (float). `validate_contract.py` checks their presence and shape.
Refresh rule: every model-changing ship in london-insurance-risk ⇒ regenerate this file.
```

- [ ] **Step 2: Founder approval gate** — this edit IS the integrator-approval artifact; the founder approved it in the 2026-07-17 design session (spec §2 decision 3 + §4.1). Confirm the wording matches, then proceed. No git commit — the workstream doc lives outside the Vouched repo.

### Task 12: Stamp + regenerate area-premiums.json

**Files:**
- Modify: `/Users/anugnana/Library/Projects/Car Marketplace/vouched/packages/tco-data/build_area_premiums.py`

- [ ] **Step 1: Add provenance inputs to the script**

After the existing `ONSPD_ZIP` constant block, add:
```python
RISK_REPO = Path(
    os.environ.get("RISK_REPO", HERE / "../../../../london-insurance-risk")
).resolve()
CALIBRATION_JSON = RISK_REPO / "reports" / "calibration.json"


def model_provenance() -> dict:
    """Provenance stamps per contract §3.1 amendment (18 Jul 2026): the source
    model's commit + calibration headline, so staleness is detectable."""
    import subprocess
    commit = subprocess.run(
        ["git", "-C", str(RISK_REPO), "rev-parse", "--short=12", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    calib = json.loads(CALIBRATION_JSON.read_text())
    return {
        "model_commit": commit,
        "model_calibration_date": calib.get("generated", calib.get("date", "")),
        "anchors_n": int(calib["n_matched"]),
        "r_squared": round(float(calib["r_squared"]), 4),
    }
```
(Verify the calibration.json key names — `n_matched` and `r_squared` per the June artifact; if the date key differs, use the actual one and note it in the commit message.)

In `build()`, merge the stamps into `meta` and make the R² text dynamic:
```python
    prov = model_provenance()
    out = {
        "meta": {
            "base_profile": "30yo, 5yrs NCB, comprehensive, group 15 car, parked on street",
            "calibrated_to": (
                f"london-insurance-risk GB model (Confused/WTW + MSM anchors, "
                f"R2={prov['r_squared']}, n={prov['anchors_n']}) — see that repo's docs"
            ),
            "generated": date.today().isoformat(),
            **prov,
            "method": (  # unchanged text
                ...
            ),
            "status": "Phase A-2: district scaling ACTIVE data",
        },
        ...
    }
```

- [ ] **Step 2: Review the £-gate against the new premium span** (recorded in Wave 1 Task 8 Step 4). If the new span breaches £150–£2,000: STOP, surface the numbers to the founder, and only widen the band constant as an explicit reviewed decision with a comment stating the new model span. Otherwise leave the gate as is and update the docstring's span note (`model spans £193–£1,542`) to the new numbers.

- [ ] **Step 3: Regenerate**

```bash
cd "/Users/anugnana/Library/Projects/Car Marketplace/vouched/packages/tco-data"
/Users/anugnana/Library/Projects/london-insurance-risk/.venv/bin/python build_area_premiums.py
```
Expected: gates pass; the summary prints coverage %, LONDON_BASE, SCOTLAND, DEFAULT and the sample districts (N9, N20, G12, …). Compare against the previous values (LONDON_BASE £796, SCOTLAND £462, DEFAULT £488) — shifts should be modest and explainable by the flood/sub-domain recalibration; large swings (>±20% on LONDON_BASE) are a stop-and-investigate signal.

### Task 13: Drift guard in validate_contract.py

**Files:**
- Modify: `/Users/anugnana/Library/Projects/Car Marketplace/vouched/packages/tco-data/validate_contract.py` (`check_area_premiums`, lines ~88–102)

- [ ] **Step 1: Add provenance checks**

Extend `check_area_premiums()` after the existing `meta` presence check:
```python
    meta = ap.get("meta", {})
    if not re.match(r"^[0-9a-f]{7,40}$", str(meta.get("model_commit", ""))):
        err("area-premiums.meta.model_commit: missing or not a git sha")
    if not re.match(r"^\d{4}-\d{2}-\d{2}", str(meta.get("model_calibration_date", ""))):
        err("area-premiums.meta.model_calibration_date: missing or not ISO date")
    if not (isinstance(meta.get("anchors_n"), int) and meta["anchors_n"] > 0):
        err("area-premiums.meta.anchors_n: missing or not a positive int")
    r2 = meta.get("r_squared")
    if not (isinstance(r2, (int, float)) and 0 < r2 <= 1):
        err("area-premiums.meta.r_squared: missing or outside (0, 1]")
```
Add `import re` to the imports.

- [ ] **Step 2: Add the freshness warning (warn, not fail — cross-repo, founder-machine only)**

At the bottom of `check_area_premiums()`:
```python
    # Freshness (warning only): compare the stamp to the sibling repo's HEAD.
    # Runs only where both repos exist; CI never has the sibling repo.
    risk_repo = Path(__file__).parent / "../../../../london-insurance-risk"
    if (risk_repo / ".git").exists():
        import subprocess
        head = subprocess.run(
            ["git", "-C", str(risk_repo.resolve()), "rev-parse", "--short=12", "HEAD"],
            capture_output=True, text=True,
        ).stdout.strip()
        if head and not head.startswith(str(meta.get("model_commit", ""))[:12]):
            print(f"  WARNING: area-premiums built from {meta.get('model_commit')} "
                  f"but risk repo HEAD is {head} — consider regenerating")
```

- [ ] **Step 3: Run the validator**

Run: `python3 validate_contract.py` (from `packages/tco-data/`)
Expected: `Contract validation passed…` with no errors (the freshly regenerated file carries the stamps); the freshness warning only appears if the risk repo moved since Task 12.

- [ ] **Step 4: Commit (Vouched repo)**

```bash
cd "/Users/anugnana/Library/Projects/Car Marketplace/vouched"
git add data/area-premiums.json packages/tco-data/build_area_premiums.py packages/tco-data/validate_contract.py
git commit -m "feat(data): regenerate district premiums from flood-era model + provenance stamps & drift guard (§3.1 amendment 18 Jul)"
```
Also run the Vouched test suite first: `npm test` (estimate.ts consumes `areas` and `fallback_regions` only — the meta additions must not break the 47 tests). The founder merges/pushes.

### Task 14: Refresh rule in both repos' docs

**Files:**
- Modify: `/Users/anugnana/Library/Projects/london-insurance-risk/CLAUDE.md` (Workflow notes) and `STATUS.md`
- Modify: `/Users/anugnana/Library/Projects/Car Marketplace/vouched/HANDOVER.md`

- [ ] **Step 1: This repo** — add to CLAUDE.md's "Workflow notes":
```markdown
- **Vouched bridge refresh rule:** every model-changing ship (anything that alters
  `reports/calibration.json` or `data/processed/lsoa_risk.parquet`) must be followed by
  regenerating the Vouched district pack: run
  `vouched/packages/tco-data/build_area_premiums.py` with this repo's venv, then
  `validate_contract.py`. The export carries `model_commit` provenance; the validator
  warns when it's stale.
```
Mirror one line in STATUS.md's ship checklist.

- [ ] **Step 2: Vouched** — add a matching paragraph to HANDOVER.md (district scaling now ACTIVE-data; regeneration owned by the risk-repo side per the refresh rule; flag state lives in Vercel).

- [ ] **Step 3: Commit** — risk repo: `git add CLAUDE.md STATUS.md && git commit -m "docs: Vouched bridge refresh rule"`. Vouched repo: `git add HANDOVER.md && git commit -m "docs: district-scaling refresh rule + activation note"`.

### Task 15: Flag flip + live verification (founder in the loop)

**Files:** none (Vercel dashboard + browser verification)

- [ ] **Step 1: FOUNDER ACTION** — set `NEXT_PUBLIC_DISTRICT_SCALING=1` in the Vercel project env and redeploy vouched.autos. (Build-time env — a redeploy is required.) The agent cannot and must not do this; pause and request it.

- [ ] **Step 2: Live spot-check** (after redeploy): on vouched.autos's finder, run the same car/age with postcodes in ~4 districts spanning the range (e.g. N9 vs N20 vs G12 vs a rural AB district) and confirm: estimates move with postcode, the area-factor bar appears, ratios match `area-premiums.json` (`p_district / p_LONDON_BASE`), and the Finder copy switched to the scaling-active wording.

- [ ] **Step 3: Update `project_status.md`** (`/Users/anugnana/Library/Projects/Car Marketplace/project_status.md`): mark area premiums ACTIVE (data + flag), correcting the stale "stub" description, with a pointer to the §3.1 amendment. **Waves 1–2 done.**

---

## Self-review notes

- **Spec coverage:** §3 Wave 1 steps 1–6 → Tasks 1–10 (step 3's IMD wire-through = Tasks 2–5; the spec's "exact names resolved in the plan" resolved to `imd_crime`/`imd_income` with WIMD community-safety as Wales's crime analogue). §4 Wave 2 steps 1–6 → Tasks 11–15. Spec §9 risks each map to a concrete guard step (Task 1 Step 2, Task 6 Step 3, Task 8 Step 1 drop-count check, Task 12 Step 2 £-gate, Task 13 drift guard). Wave 3 and the ladder re-rank are intentionally out of this plan.
- **Placeholders:** discovery-dependent names (WIMD ArcGIS fields, SIMD income column, frontend list members, calibration.json date key) are deliberate verify-then-code checkpoints with explicit discovery commands and both branches specified — not TBDs.
- **Type consistency:** feature base-names `imd_crime`/`imd_income` flow ingest (`imd_crime_pct` 0–1) → aggregate (renamed `imd_crime`) → config place list → calibrate (`imd_crime_pct` 0–100 percentile basis, suffix re-applied by `_cols`) — the double `_pct` life-cycle mirrors `deprivation` exactly, no `_SOURCE_GROUPS` entry needed (inputs are already within-nation). `flood_risk` keeps its existing `_SOURCE_GROUPS` entry from `43fb405`.
- **Known sequencing constraints:** Task 1 gates everything (flood job may still be running); Task 6 Step 3 gates Task 7; Task 8 Step 4's span gates Task 12 Step 2; Task 15 Step 1 is founder-only.
