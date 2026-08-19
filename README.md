# GB Car-Insurance Risk Map

An expected **annual motor-insurance premium** for every small area in Great Britain —
41,729 LSOAs (England & Wales) and Data Zones (Scotland) — built entirely from **open
data** and calibrated against **published price indices** (WTW/Confused.com quarterly
index, MoneySuperMarket regional figures).

**Live map → https://anugnane.github.io/london-insurance-risk/** (static, GitHub Pages —
search any GB postcode).

A one-page write-up of the whole project, readable in a browser with no build step, lives
at [`docs/PROJECT_SUMMARY.html`](docs/PROJECT_SUMMARY.html).

This is a **territorial risk proxy, not a quote engine**: it uses no individual driver or
vehicle details. The 0–100 `risk_index` is simply the calibrated premium on a percentile
scale — one reconciled model, not two.

## Headline results (July 2026 calibration)

| Metric | Value |
|---|---:|
| Panel R² (log relative index, area-clustered SEs) | **0.9304** |
| Leave-one-area-out MAE (strict spatial hold-out) | **£76.51** |
| Temporal back-test MAE (fit ≤T, predict T+1) | **£69.76** |
| Spearman (predicted vs actual premium) | **0.974** |
| Matched anchor observations / areas | **106 / 30** (from a 137-row cited panel) |
| Modelled premium span across GB | **£186 – £1,578** |
| Honest 95% interval, median width | **£373** |
| National average pin (latest published quarter) | **£558.55** |

Full verification write-up — coefficients, tail reconstructions, sign checks, the 2026-07
evidence gate — is in [`AUDIT.md`](AUDIT.md).

## How it works

**Response.** The regression target is `log(area premium ÷ national average)`, normalised
per source × quarter. Modelling the *ratio* strips out the national price level and its
drift over time, isolating the effect of place. Absolute £ is reconstructed at the end by
pinning to the latest published national average (£558.55).

**Estimator.** Ordinary least squares with **area-clustered standard errors** (the panel is
repeated measures — the same area across up to 11 quarters), plus a source fixed effect
when a second anchor source is pooled. Deliberately small, because the calibration sample
honestly is: 106 observations across 30 areas. Ridge CV, leave-one-area-out and a temporal
back-test carry the argument rather than the in-sample fit.

**Features.** Everything enters as a **rank percentile (0–100)**, ranked **within
comparable groups** — within nation for the deprivation family, England+Wales vs Scotland
for crime (recording definitions differ). Percentiles bound extrapolation, so no outlier
area can blow its own prediction up, and they make three nations' incompatible source
scales comparable by construction.

```
log(premium ÷ national avg) = β₀
  + β·place[vehicle_crime, imd_crime, aadf_intensity]
  + β·composition[young_driver_share, cars_per_household]
```

**Evidence gate.** Nothing is in the premium model by intuition. A candidate must show an
independent partial correlation (p < 0.05) at acceptable collinearity (VIF < 10), or win a
leave-one-area-out head-to-head. The gate has said no more often than yes:
`population_density` was gated out and replaced by point-level AADF (which killed the
"it's just a density model" critique); `flood_risk` is wrong-signed for car premiums
(r = −0.94 — flood exposure tracks rurality, and rural is cheap), so it ships as a map
diagnostic and as banked evidence for a future home-insurance line; `imd_income` is
redundant within the deprivation family (VIF 33); `road_casualties` / KSI have no
independent signal once traffic exposure is controlled. In the 2026-07 wave **`imd_crime`
replaced overall deprivation** — with the crime sub-domain present, overall deprivation's
partial correlation collapses to +0.03 (p=0.78). `aadf_intensity` was kept on out-of-sample
evidence despite a marginal in-sample p=0.063: dropping it worsens LOAO MAE £76.51 → £82.54.
Per-feature verdicts: `reports/feature_analysis.md`.

**Place vs composition.** Demographics enter as **controls**, so the place coefficients are
estimated net of who lives there — and each area gets **three numbers**: the full premium,
a **place-only** counterfactual (composition held at the national median), and the
**composition uplift** between them. Composition alone explains more of the spread than
place alone. That's reported as a finding, not tuned away.

**Explainable to the pound.** The detail panel renders an exact, order-invariant **LMDI
(logarithmic-mean) waterfall**: a signed £ step per factor from the £537 baseline (every
feature at the median) to the area's estimate, with `baseline + Σ steps == premium`, no
residual. A serve-consistency test guards the served map against stale coefficients.

**Uncertainty.** Every area ships `premium_low`/`premium_high`: a 200-replication **cluster
bootstrap** resampling anchor *areas* (not rows — quarters within an area are correlated)
gives a median width of £241, which understates things because it captures only coefficient
uncertainty. Widening by the **LOAO residual variance** (σ_log = 0.113) — the model's error
on geography it was never fitted to — lifts the honest median width to **£373**.

## Pipeline

`make` targets are the source of truth for order:

| Stage | Command | What it does |
|---|---|---|
| M1 | `make ingest` | Ten source modules → `data/interim/*.parquet` (one per open source) |
| M2 | `make features` | `aggregate_to_lsoa` joins everything onto the boundary master list, one row per area |
| M3 | `make risk` | Percentile features + calibrated coefficients → `data/processed/lsoa_risk.{parquet,geojson.gz}` |
| M4 | `make calibrate` | Anchor-panel ingest + the regression and its full validation ladder, **then re-runs M3 and the static bake** |
| bake | `make showcase-data` | Topology-aware simplification → `frontend/public/data/*.geojson` (what the map actually serves) |

> **The trap:** `make risk` has no dependency on `reports/calibration.json`'s timestamp, so
> running it alone after touching calibration or coefficients can ship **stale premiums**
> (this has bitten before — a train/serve-skew bug). After anything model-changing, always
> run `make calibrate`, which re-runs risk and the bake for you. Never a bare `make risk`.

`make api` serves a local FastAPI dev app; the deployed site is fully static and doesn't
use it. `make showcase-tiles` bakes LSOA PMTiles for the Vouched map.
`reports/calibration.json` is git-ignored — it's derived, regenerate it with `make calibrate`.

## Data sources

All Open Government Licence v3.0 (or OGL-compatible public statistics). "Open" spans five
very different access routes, from a one-click download to a credentialed SFTP drop that
had to be requested by email.

| Source | Publisher | Licence | Access route | Feeds |
|---|---|---|---|---|
| LSOA / Data Zone boundaries + ONSPD postcodes | ONS Open Geography Portal · ScotGov | OGL v3 | ArcGIS REST + bulk ZIP | Spatial backbone; postcode search (2.6M postcodes) |
| Street-level vehicle crime (E+W) | data.police.uk | OGL v3 | Bulk S3 archive (36 months) | `vehicle_crime` (England & Wales) |
| Recorded Crime in Scotland | statistics.gov.scot | OGL v3 | **SPARQL** linked-data endpoint | `vehicle_crime` (Scotland), council grain → Data Zone by population |
| IoD2019 (England) | MHCLG | OGL v3 | Bulk CSV (File 7) | `imd_crime` driver + deprivation diagnostic |
| WIMD 2019 (Wales) | Welsh Government | OGL v3 | **Official `data_WG` ArcGIS org** (the previously used org was decommissioned mid-2026) | `imd_crime` (Community Safety domain, the documented nearest analogue) |
| SIMD 2020v2 (Scotland) | Scottish Government · NHS Scotland | OGL v3 | Ranks workbook + open-data CSV | `imd_crime` + deprivation diagnostic |
| AADF traffic count points | DfT | OGL v3 | Bulk ZIP (~22k GB points) | `aadf_intensity` (mean flow within 2 km of each centroid) |
| Census 2021 (E+W) / 2022 (Scotland) | ONS via Nomis · NRS via UK Data Service | OGL v3 | Bulk table download | `young_driver_share`, `cars_per_household` |
| STATS19 road collisions | DfT | OGL v3 | Bulk CSV | Diagnostics (severity-weighted casualties, KSI rate) |
| Flood extents — England | Environment Agency (RoFRS / NaFRA2) | OGL v3 | **Not a public download**: requested from Defra by email → credentialed **SFTP**, 83-tile geodatabase (326k features); credentials git-ignored | `flood_risk` diagnostic |
| Flood extents — Wales / Scotland | NRW (DataMapWales) · SEPA | OGL v3 | WFS · ArcGIS REST | `flood_risk` diagnostic |
| DfT local-authority road traffic | DfT | OGL v3 | Bulk CSV | `traffic_per_capita` diagnostic (the demoted v1) |
| **Price index (calibration anchor)** | WTW/Confused.com · MoneySuperMarket | Published figures, cited per row | Hand transcription | The £ ground truth — a 137-row panel, **no-invented-figures rule** |

> Contains public sector information licensed under the Open Government Licence v3.0.

Every transform — why each source was chosen and exactly what turned it into a feature — is
documented in [`DATA_PROVENANCE_AND_TRANSFORMS.md`](DATA_PROVENANCE_AND_TRANSFORMS.md).

## Coverage

| Nation | Areas | Crime | Collisions | Deprivation | Calibrated premium |
|---|---:|:---:|:---:|:---:|:---:|
| England | 32,844 | data.police.uk | ✓ | IoD 2019 | ✓ |
| Wales | 1,909 | data.police.uk | ✓ | WIMD 2019 | ✓ |
| Scotland | 6,976 | Recorded Crime in Scotland | ✓ | SIMD 2020v2 | ✓ |

All 41,729 GB areas carry a calibrated premium — there are no null premiums.

## What it doesn't claim

- **Validation grain ≠ prediction grain.** The model validates at postcode-area / region
  grain (where published premiums exist) and predicts at LSOA grain. Per-LSOA figures are
  principled extrapolation — directionally strong rankings, not quotes. This is the single
  most important caveat.
- **Small anchor sample, by design.** 106 matched observations is what honestly exists in
  public. Hence a linear model and the emphasis on hold-outs.
- **Ecological inference.** Area aggregates predict area premiums; nothing here supports
  individual-level conclusions (MAUP applies).
- **Known blind spot.** Wealthy-but-central areas can under-price: deprivation-family
  signals are low there while real premiums are driven by unmodelled factors (vehicle
  values, congestion, claims cost).
- **Scotland caveats.** Crime arrives at council grain and is disaggregated by population,
  so there's no within-council variation; Scottish anchors validate at a thinner sample
  than E+W.
- **Northern Ireland is excluded** — data.police.uk and STATS19 both omit NI, so an NI area
  would carry only half its features.
- **The anchor is a market average,** transcribed from published indices, not claims data.

## Quickstart

```bash
uv sync                       # or: python -m venv .venv && source .venv/bin/activate && pip install -e .
cp .env.example .env

make ingest                   # ~20+ min first run; downloads several GB into data/raw
make features
make calibrate                # fits the model, then re-runs risk + showcase-data for you

pytest -q                     # or: make test
ruff check src
```

Run the map locally:

```bash
docker compose up --build     # mounts ./data and ./reports — no re-ingest inside the image
# then open http://localhost:8000

# or, frontend only:
cd frontend && npm run dev
```

The public build is fully static: `cd frontend && GITHUB_PAGES=1 npm run build`, deployed by
`.github/workflows/deploy-pages.yml` on every push to `main`. Postcode search resolves
client-side (postcodes.io for coordinates + point-in-polygon, because postcodes.io now
returns 2021/2022 codes that don't match the model's 2011 areas — so it matches on location,
not code).

## Layout

```
config/config.yaml        weights, years, feature buckets, paths — single source of truth
src/ingest/               one module per source → data/interim/*.parquet
src/transform/            aggregate_to_lsoa.py (M2) · build_risk_index.py (M3)
src/calibrate/            wtw_index.py (anchor panel) · calibrate.py (regression + validation ladder)
src/showcase/             bake_static.py (served GeoJSON) · bake_tiles.py (PMTiles)
src/api/main.py           FastAPI — local dev only
frontend/                 Vite + React + TypeScript + MapLibre GL
tests/                    pytest, roughly one file per module
data/                     git-ignored — never commit
```

## Docs

| Doc | What's in it |
|---|---|
| [`docs/PROJECT_SUMMARY.html`](docs/PROJECT_SUMMARY.html) | Shareable one-page write-up — open it in any browser |
| [`AUDIT.md`](AUDIT.md) | Model verification: coefficients, tail reconstructions, sign checks, uncertainty, the 2026-07 evidence gate |
| [`DATA_PROVENANCE_AND_TRANSFORMS.md`](DATA_PROVENANCE_AND_TRANSFORMS.md) | Every source, why it was chosen, the exact transform and normalisation |
| [`docs/superpowers/info/PROJECT_TECHNICAL_OVERVIEW.md`](docs/superpowers/info/PROJECT_TECHNICAL_OVERVIEW.md) | Model maths, architecture, evolution decisions |
| [`docs/superpowers/info/STATUS.md`](docs/superpowers/info/STATUS.md) | Current state, per-phase completion log, known limitations |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | Working agreement and conventions for coding agents |

Phase plans and older design docs under `docs/superpowers/` are dated historical records —
where they disagree with `AUDIT.md` (2026-07 addendum) or `STATUS.md`, those two win.

## Elsewhere

The model also powers the postcode-district premium estimates behind
[vouched.autos](https://vouched.autos)'s First-Car Finder, via a frozen data contract with
provenance stamps (model commit, calibration date, n, R²) — every model-changing ship here
regenerates that pack.
