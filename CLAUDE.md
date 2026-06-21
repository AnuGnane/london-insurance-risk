# CLAUDE.md — project map for Claude Code

This file is Claude-specific orientation. The working agreement (rules, conventions,
definition-of-done) lives in `AGENTS.md` — read that too; it applies equally here.

## What this is

A GB-wide car-insurance territorial risk model, built from open data and calibrated
against published price indices (WTW/Confused.com, MoneySuperMarket). Ships as a
static interactive map (React + MapLibre) deployed to GitHub Pages. Started as a
London-only prototype, expanded to all of England, Wales and Scotland (Northern
Ireland excluded — no open crime source).

For deep technical context, in this priority order:
- `PROJECT_TECHNICAL_OVERVIEW.md` — model & maths, architecture, evolution decisions
- `DATA_PROVENANCE_AND_TRANSFORMS.md` — every data source, why chosen, exact transform
- `INTERVIEW_PREP_QA.md` — mock Q&A, useful as a fast model/architecture refresher
- `MODEL_REVIEW.md`, `ROADMAP.md`, `SHOWCASE_PLAN.md` — historical planning docs

## Pipeline (Makefile targets = the source of truth for order)

```
make ingest    # M1: src/ingest/*        -> data/interim/*.parquet  (raw sources)
make features  # M2: aggregate_to_lsoa   -> data/interim/lsoa_features.parquet
make risk      # M3: build_risk_index    -> data/processed/lsoa_risk.{parquet,geojson.gz}
make calibrate # M4: wtw_index + calibrate.py -> reports/calibration.json, then re-runs risk + showcase-data
make showcase-data # bake_static.py      -> frontend/public/data/*.geojson (what the map actually serves)
make api       # local-only FastAPI dev server (not used by the deployed static site)
make test      # pytest
```

**Known gap:** `make risk` does not depend on `reports/calibration.json`'s timestamp, so
running `risk` without `calibrate` afterward can ship stale premiums (this has happened
before — see the train/serve-skew bug in `INTERVIEW_PREP_QA.md` Q18). After touching
calibration or coefficients, always re-run `calibrate` (which re-runs `risk` and
`showcase-data` for you), don't just run `risk` alone.

`reports/calibration.json` is git-ignored — it's a derived artifact, regenerate with
`make calibrate`, don't expect it to exist after a fresh clone until you do.

## Where things live

- `src/ingest/` — one module per data source (boundaries, police_crime, scotland_crime,
  stats19, imd, census_demographics, traffic, aadf, flood, onspd). Each is independently
  runnable, pure-function core + isolated I/O in `run()`/`main()`.
- `src/transform/` — `aggregate_to_lsoa.py` (M2 joins), `build_risk_index.py` (M3:
  percentile features, premium reconstruction from coefficients, GeoJSON output).
- `src/calibrate/` — `wtw_index.py` (anchor panel ingest), `calibrate.py` (the regression:
  OLS on log relative-index, clustered SEs, ridge CV, LOAO, temporal back-test, VIF/partial
  correlation feature gating).
- `src/showcase/bake_static.py` — produces the topology-aware-simplified, mapshaper-based
  GeoJSON actually served by the frontend. Do not edit `frontend/public/data/*.geojson`
  by hand; regenerate via `make showcase-data`.
- `src/common/config.py` + `config/config.yaml` — all years, weights, region codes,
  normalisation method. Never hard-code these in a module (per `AGENTS.md`).
- `frontend/` — Vite + React + TypeScript + MapLibre. `npm run dev` / `npm run build` /
  `npm run lint` from inside `frontend/`.
- `tests/` — pytest, one file roughly per ingest/transform module; run with `make test`.

## Conventions Claude should follow here

- Geometry: **EPSG:27700** (British National Grid) for all spatial maths; reproject to
  **EPSG:4326** only at final GeoJSON/map output. Getting this backwards silently produces
  wrong distances/areas without erroring.
- `shapely.make_valid` must be the **last** geometry operation in any pipeline — re-rounding
  or re-simplifying coordinates after it can re-collapse repaired vertices and re-break
  validity (bit us once on 2 Scottish areas; see git history of `bake_static.py`).
- Crime and deprivation features are ranked **within comparable group** (nation, or
  England+Wales vs Scotland for crime) — never compare these across groups on absolute scale.
- Diagnostics (`traffic_per_capita`, `road_casualties`, `ksi_*`, `population_density`) are
  shown on the map but are intentionally excluded from the premium model (evidence-gated out
  via VIF/partial-correlation) — don't reintroduce them as drivers without re-running that gate.
- The WTW/anchor panel has a strict **no-invented-figures** rule: every premium figure must
  trace to an explicitly published, cited source.

## Workflow notes

- Never commit anything under `data/` (git-ignored) or `reports/calibration.json` (also
  git-ignored, derived).
- The user reviews and creates PRs themselves — use `gh` only for small, requested pushes,
  not unprompted.
