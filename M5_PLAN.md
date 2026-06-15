# M5 — API & Interactive Map: Build Plan

Read after `PLAN.md` and `AGENTS.md`. **M1–M4 are complete.** The risk index and calibration
outputs already exist in `data/processed/`. **M5 is a presentation layer over precomputed data —
it is NOT more modelling.** Do not recompute the index, features, or calibration in the API.

Artifacts that already exist and must be reused as-is:
`lsoa_risk.geojson`, `lsoa_risk.parquet`, `postcode_lookup.parquet`, `wtw_anchors.csv`,
and the fitted regression coefficients from calibration (`reports/calibration.md`).

---

## Form factor (decided)

**FastAPI (thin) + React (Vite + TypeScript) + MapLibre GL JS**, shipped as a **single Docker
container**.

- **MapLibre, not Leaflet** — WebGL vector rendering stays smooth across ~4,881 LSOA polygons,
  supports data-driven styling, looks modern, and needs no access token. Basemap: a free no-key
  style such as **OpenFreeMap** (positron) or **CARTO** basemaps.
- **Single container** — FastAPI serves the built React bundle via `StaticFiles` *and* the `/api`
  routes, so there is one image to deploy to the homelab. Dev runs the Vite dev server + uvicorn
  with CORS.
- **Thin backend by design** — it serves precomputed data plus a postcode lookup. No heavy compute
  at request time; everything loads into memory once at startup.

> Fallback only if priorities change to "ship fastest, pure Python": Streamlit + pydeck. It caps
> the polish and gives no reusable API — avoid unless speed trumps everything.

---

## Architecture

```
React (MapLibre, Vite/TS) ──HTTP──► FastAPI ──(load once at startup)──► data/processed/*
```

At FastAPI startup, load all artifacts into memory (all small): the GeoJSON, the risk Parquet, the
postcode→LSOA lookup, the WTW anchors, and the fitted coefficients. Request handlers are then pure
lookups.

---

## API contract

- `GET /api/health` → `{ "status": "ok" }`
- `GET /api/geojson` → the LSOA choropleth `FeatureCollection` (simplified geometry, gzipped).
  Per-feature properties: `lsoa11cd, risk_index, quintile, vehicle_crime_rate, casualty_rate,
  imd_score, pop_density, calibrated_premium`.
- `GET /api/risk?postcode=<pc>` → resolve postcode → LSOA via the lookup; `404` if outside London.
  Returns:
  ```json
  {
    "postcode": "EN1 4QR",
    "lsoa11cd": "E01000123",
    "risk_index": 78.4,
    "quintile": 4,
    "components": {
      "vehicle_crime":   { "value": 12.3, "percentile": 82, "contribution": 28.7 },
      "casualties":      { "value": 4.1,  "percentile": 60, "contribution": 15.0 },
      "deprivation":     { "value": 24.0, "percentile": 71, "contribution": 10.7 },
      "pop_density":     { "value": 9100, "percentile": 88, "contribution":  8.8 }
    },
    "calibrated_premium_estimate": 1180,
    "postcode_area": "EN",
    "wtw_anchor_premium": 1093
  }
  ```
- `GET /api/rankings?level=lsoa|district&n=20&order=desc` → top/bottom-N areas by `risk_index`
  (drives the "areas at most risk" list). Each item: `{ code, name, risk_index, quintile,
  calibrated_premium }`.
- `GET /api/methodology` → static JSON summarising weights, normalisation method, calibration R²,
  and coefficients (drives a methodology panel from `config.yaml` + `calibration.md`).

CORS: allow the Vite dev origin in dev; same-origin in prod.

---

## Frontend — components & UX

### Core (MVP)
1. **MapView** (MapLibre): choropleth fill by quintile using a sequential ramp; hover tooltip
   (LSOA code + score); click selects an LSOA.
2. **SearchBar**: debounced postcode input → `/api/risk` → fly to the LSOA, highlight it, open the
   detail panel.
3. **DetailPanel — the model showcase.** Don't just print the score; show *why*. For each component
   render its raw value, its percentile, and its **weighted contribution** to the 0–100 index (a
   small horizontal bar per component). Show the **calibrated expected premium** and the **real WTW
   anchor** beside it. This is how the UI honours "focus on the model" — it makes the index legible
   rather than a black box.
4. **Legend + Disclaimer**: sequential colour key, plus a short, prominent "what this is / isn't"
   note (*relative territory risk, not a quote; a proxy, not a price*). Credibility matters for a
   portfolio piece.

### Strong additions (recommended — cheap on precomputed data)
5. **RankingsPanel** — "Areas at most risk": top-N list from `/api/rankings` (this is the literal
   original brief). Click an item → fly to that area.
6. **Price context** — surface the calibration as a headline, e.g. *"This index explains 91% of the
   variance in real average premiums across London postcode areas (WTW/Confused)."* Show
   `calibrated_premium` in the DetailPanel next to the risk score, tying risk → money.

### Stretch (optional)
7. **LayerToggle** — recolour the map by a single driver (crime / casualties / deprivation /
   density) to reveal which factor dominates where. Another model-legibility win.
8. **WeightsToggle** — switch expert-weighted vs calibration-fitted index (if both exist) to show
   methodological rigour.
9. **Compare** two postcodes side by side.
10. **Methodology page** rendering `calibration.md`.

### Out of scope (unchanged)
Live multi-aggregator quote scraping (Compare the Market / MoneySuperMarket / Confused / GoCompare).

---

## Design direction (intentional, not templated)

- **Aesthetic**: clean, editorial data-viz. Muted basemap (positron-style); let the data carry the
  colour.
- **Palette**: a **sequential** ramp for risk (low → high), e.g. ColorBrewer `YlOrRd` or a custom
  5-step. **Not** a diverging scheme — risk has a natural low→high order with no meaningful midpoint.
  Keep UI chrome neutral (near-black text, off-white panels, one restrained accent).
- **Typography**: a single clean sans (Inter or a system stack); clear hierarchy; **tabular
  numerals** for scores and premiums.
- **Layout**: map-dominant; a side panel for search + detail + rankings; generous whitespace;
  responsive enough to demo on both a laptop and a phone.
- **Motion**: subtle fly-to on selection; avoid gratuitous animation.
- **Accessibility**: verify the ramp is colour-blind-safe, and always pair colour with the numeric
  score so meaning never relies on hue alone.

---

## Performance / data prep

- ~4,881 un-simplified LSOA polygons is a heavy payload. **Pre-simplify** geometry (mapshaper,
  ~10–20%, preserving topology) before/at build, and serve **gzipped**. Consider TopoJSON to shrink
  further.
- **Scalable upgrade (polish)**: generate vector tiles as **PMTiles** (tippecanoe) and load them
  statically in MapLibre via the pmtiles protocol — buttery performance, no tile server. Optional;
  simplified GeoJSON is fine for the MVP.
- Load processed artifacts once at startup; keep request handlers pure lookups.

---

## Deployment

- **Single multi-stage Dockerfile**: stage 1 builds the React bundle; stage 2 (python-slim)
  installs deps, copies the bundle, runs `uvicorn` serving `StaticFiles` + `/api`. Deploy to the
  homelab.
- `docker-compose.yml` for one-command local run; `.env` for any config.
- **Dev**: `npm run dev` (Vite) + `uvicorn src.api.main:app --reload`, with CORS allowing the Vite
  origin.

---

## Milestones

- **M5.1 Backend** — implement `/api/health`, `/api/geojson`, `/api/risk`; load artifacts at
  startup; smoke test each endpoint.
- **M5.2 Geometry prep** — simplify + serve the GeoJSON; verify payload size and that the map
  renders.
- **M5.3 Frontend skeleton** — Vite + TS + MapLibre rendering the choropleth + legend.
- **M5.4 Search + DetailPanel** — postcode search wired to `/api/risk`, with per-component
  contributions and the calibrated premium.
- **M5.5 Rankings** — `/api/rankings` + the "areas at most risk" panel with fly-to.
- **M5.6 Design pass** — palette, type, layout, disclaimer, methodology surface.
- **M5.7 Dockerise** — single container + compose; deploy to the homelab.
- **M5.x (optional)** — layer toggle / weights toggle / compare / methodology page / PMTiles.

---

## Definition of done (M5 MVP)

- Map of London renders the risk choropleth smoothly.
- Typing a London postcode shows its risk score, quintile, per-component contributions, and a
  calibrated premium with the WTW context.
- "Areas at most risk" lists the top-N and navigates to them.
- A clear disclaimer states it is a risk proxy, not a quote.
- Runs locally via `docker compose` and as a single container on the homelab.
- New endpoints have smoke tests.

---

## Conventions (same as AGENTS.md)

- The API reads only from `data/processed/`; **never recompute the index** in the API.
- All config lives in `config.yaml`; no hard-coded weights or paths.
- Type hints, `ruff` clean, `logging` not `print`; tests in `tests/`.
- Don't commit `data/` or `node_modules/`.
