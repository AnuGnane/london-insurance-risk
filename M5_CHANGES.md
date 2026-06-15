# M5 Implementation — Change Log (frontend + backend)

Companion to `M5_PLAN.md`. The plan was the spec; this records **what was actually built** and,
most importantly, **the data contract the frontend and backend now share**. Read the "Conventions to
preserve" section before changing anything — several of these encode bug fixes.

---

## The one architectural decision

**The loaded GeoJSON is the client-side data store.** `App.tsx` fetches `/api/geojson` once, keeps the
`FeatureCollection` in state, and builds an O(1) `Map<lsoa11cd, feature>` lookup. Everything else reads
from that:

- **Clicking a map area** hydrates the detail panel straight from `feature.properties` — no network call.
- **Searching a postcode** calls `/api/risk` to resolve postcode → LSOA, then flies to that LSOA by
  computing its bounds from geometry already on the client (`featureBounds`).
- **Recolouring by a driver** swaps the map's paint expression to read a different baked property.

This is why the backend had to start **baking richer properties into the GeoJSON** (see backend changes) —
the map can only show on click what the GeoJSON carries.

---

## Frontend changes (`src/`)

### `utils.ts` — NEW
Shared helpers, no new dependencies:
- `COMPONENT_KEYS`, `COMPONENT_LABELS` — the 4 components and their display names.
- `gbp(n)` — formats GBP with thousands separators (`1180 → "£1,180"`).
- `readQuintile(props)` — reads `quintile ?? risk_bucket` (tolerates either backend name).
- `buildLookup(fc)` — `Map<lsoa11cd, Feature>` for instant click/search hydration.
- `featureBounds(feature)` — bounding box of a (Multi)Polygon, used for client-side fly-to.
- `boundsCentre(b)` — centre point, used to drop the marker.
- `featureToDetail(props)` — normalises GeoJSON feature properties into the `AreaDetail` shape the panel
  renders (reads `{key}_val / _pct / _contrib`). Used by the click and ranking paths.

### `types.ts` — EXTENDED
- `RiskData` and `RankingArea` gained optional `lng`/`lat` (used if the backend ever returns exact points).
- Added `LsoaProps` (the GeoJSON feature property shape), `AreaDetail` + `AreaDetailComponent` (the unified
  detail shape rendered whether the area was reached by search, click, or ranking), `ColorMode`, and
  `FocusTarget` (`{ bounds?, center?, nonce }` — the `nonce` forces a re-fly even to the same place).

### `App.tsx` — MAJOR REFACTOR
- Loads the GeoJSON once into state; memoises the lookup.
- Unified selection state: a single `detail: AreaDetail | null` drives the panel and the map highlight,
  fed identically by search, map click, and ranking click (previously these were inconsistent and map
  clicks just `console.log`ged).
- `handleSearch` → `/api/risk`, builds `AreaDetail` (prefers the rich API payload, falls back to feature
  props), then `focusLsoa`.
- `handleMapClick` → hydrates `AreaDetail` from feature props (no network), then `focusLsoa`.
- `handleSelectRanking` → hydrates from the lookup when the LSOA is present, else flies to passed coords.
- `focusLsoa(lsoa, exact?)` computes bounds from the feature and sets `focus` + `marker`.
- `clearDetail` returns to the rankings list.

### `MapView.tsx` — REFACTOR
- Source now takes the in-memory `data={geojson}` object (not a `/api/geojson` URL), so the app controls it.
- **Fly-to** via a `useEffect` on `focus.nonce` → `fitBounds` (or `flyTo` for a bare centre).
- **Driver colouring**: `fillColor(mode)` returns either a discrete quintile `match`
  (`coalesce(quintile, risk_bucket)`) for composite, or a continuous `interpolate` on `{mode}_pct` for a
  single driver.
- **Hover tooltip**: `setFeatureState` for the fill highlight **plus** a `<Popup>` showing LSOA + risk score.
- **Selection highlight**: a line layer filtered by `selectedLsoa`.
- Added `<Marker>` (searched/selected area), `<NavigationControl>`, a `map-toast` for load/error states,
  and a legend that adapts (discrete swatches for composite, gradient for a driver).

### `DetailPanel.tsx` — REFACTOR
- Renders the unified `AreaDetail`. Components are **sorted by contribution** (biggest driver first).
- **Bug fix**: bar width is now `contribution / maxContrib * 100` (the old `contribution * 100 * 2.5`
  magic number assumed contribution was a 0–1 fraction; it is actually points-of-the-index — see contract).
- Shows risk circle + quintile, model expected premium, WTW actual, and the model-vs-actual delta.
- Degrades gracefully: if a feature carries no component fields, it shows a short note instead of breaking.

### `RankingsPanel.tsx` — REFACTOR
- Calls `/api/rankings?n=10&order=desc|asc`; **Most/Least toggle** added.
- Items are now real `<button>`s (keyboard/focus accessible), with `gbp` formatting; passes coords up if present.

### `Sidebar.tsx` — REFACTOR
- Added the **driver toggle** (segmented control → `colorMode`).
- Added a **methodology panel** (local component) that fetches `/api/methodology`, surfaces the calibration
  R² and weights, and **auto-hides if the endpoint 404s**.
- Added a **"← Back to rankings"** link when a detail is shown.

### `index.css` — UPDATED
Kept the existing visual language (Inter, the YlOrRd ramp, card system) and **added** styles for: segmented
controls, the methodology panel, back link, hover popup (overrides MapLibre defaults), map toast, marker pin,
`component-meta`, `search-error`, a **mobile breakpoint** (`max-width: 768px`, stacks panel under map), and
**`prefers-reduced-motion`** support.

### Cleanup
`App.css`, `hero.png`, `vite.svg`, `react.svg` are leftover Vite template assets and can be deleted —
nothing imports them.

---

## Backend changes

### `build_risk_index.py` (M3) — ENRICHED OUTPUT
- New `enrich_components()` bakes, per component, `{c}_val`, `{c}_pct`, `{c}_contrib`, plus a `quintile`
  alias of `risk_bucket`. The contribution formula **mirrors `/api/risk` exactly**, so a click and a search
  show identical numbers.
- New `add_calibrated_premium()` bakes `calibrated_premium` per LSOA **if `reports/calibration.json` exists**
  (so it appears on click; search computes it live regardless).
- Carries `lsoa_name` from the boundaries (friendlier titles + ranking labels).
- Writes **two artefacts**: the **full enriched Parquet** (`lsoa_risk.parquet`, read by the API) and a
  **slim, gzipped GeoJSON** (`lsoa_risk.geojson.gz`, served to the map — only the properties the UI uses,
  geometry simplified, gzipped). The gz output fixes the previous mismatch where the API served a `.gz`
  that the build never produced.

### `main.py` (FastAPI) — POLISH + FIXES
- Startup moved from the deprecated `@app.on_event` to a **lifespan** handler.
- `estimate_premium()` helper factored out (was duplicated in `/api/risk` and `/api/rankings`).
- `/api/geojson` serves the `.gz` with `Content-Encoding: gzip` and a `Cache-Control` header, **falling
  back** to a plain `.geojson` if the gz isn't built.
- `/api/rankings` gained the **`order=asc|desc`** param (drives the Most/Least toggle).
- Uses the baked `{c}_pct` if present, else computes it.
- CORS `allow_credentials=False` (a wildcard origin with credentials is invalid; the app uses no cookies).

---

## The shared data contract (the glue — keep frontend and backend in sync)

### GeoJSON feature properties (slim, served by `/api/geojson`)
```
lsoa11cd           string
risk_index         number (0–100)
quintile           int (1–5)
lsoa_name          string   (optional)
calibrated_premium int      (optional — present after calibrate + re-run of `make risk`)
{c}_val            number   raw component value
{c}_pct            number   percentile 0–100  (drives the driver-toggle colouring)
{c}_contrib        number   points contributed to risk_index
   for each c in: vehicle_crime, road_casualties, deprivation, population_density
```

### `GET /api/risk?postcode=`
```
{ postcode, lsoa11cd, risk_index, quintile,
  components: { <component>: { value, percentile, contribution } },
  calibrated_premium_estimate, postcode_area, wtw_anchor_premium? }
```

### `GET /api/rankings?n=&order=asc|desc`
```
[ { code (lsoa11cd), name, risk_index, quintile, calibrated_premium }, ... ]
```

### `GET /api/methodology`
```
{ weights, normalisation, calibration: { r_squared, coefficients, backfit_weights? } }
```

---

## Conventions to preserve (don't undo these)

1. **Contribution is points-of-the-index, not a 0–1 fraction.** Under percentile normalisation the four
   contributions sum to `risk_index`. The frontend bar and "X pts to score" label rely on this.
2. **`quintile` vs `risk_bucket`**: the frontend reads `quintile ?? risk_bucket`. Keep emitting `quintile`.
3. **The API never recomputes the index** — it reads precomputed artefacts only. Modelling stays in M3/M4.
4. **The GeoJSON is deliberately slim**; the full feature set lives in the Parquet for the API. Don't fatten
   the GeoJSON with columns the UI doesn't use.
5. **Click reads from the in-memory GeoJSON (no network).** Keep new per-LSOA fields baked into the GeoJSON
   rather than adding a per-click endpoint, unless there's a reason to change the architecture.

---

## Outstanding (to be fully wired)

1. **Persist `reports/calibration.json`** from the calibrate step (statsmodels OLS with `add_constant`):
   ```python
   import json
   (ROOT / "reports").mkdir(exist_ok=True)
   (ROOT / "reports" / "calibration.json").write_text(json.dumps({
       "r_squared": float(model.rsquared),
       "coefficients": model.params.round(4).to_dict(),  # includes "const"
   }, indent=2))
   ```
   Without it, premiums are £0 and the methodology R² is null.

2. **Vite dev proxy** so `/api/*` reaches uvicorn (`vite.config.ts`):
   ```ts
   server: { proxy: { '/api': 'http://localhost:8000' } }
   ```

3. **Run order:** `make features → risk → calibrate → risk`. The second `risk` bakes `calibrated_premium`
   into the GeoJSON so it shows on click (search shows it regardless).
