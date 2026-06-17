# Showcase Plan — Frontend Polish + GitHub Pages Deployment

> Goal: turn the working model into a credible, public **portfolio showcase**.
> Decisions (locked): **GitHub Pages** (static) · **editorial / data-journalism**
> visual direction · **simplified GeoJSON** (~3–5 MB, no new tooling).
> This is a frontend/deploy effort — the model and pipeline are unchanged.

---

## 0. The core constraint and how we beat it

GitHub Pages serves static files only — the FastAPI backend can't run. All four
endpoints the frontend uses are replaced client-side, with **no loss of function**:

| Today (server) | Static replacement |
|---|---|
| `GET /api/geojson` | static `public/data/areas.geojson` (simplified, ~3–5 MB) |
| `GET /api/risk?postcode=` | **postcodes.io** (free OGL API) → postcode's 2011 LSOA/DataZone code → look up the feature already in the loaded GeoJSON (premium + drivers are baked into its props) |
| `GET /api/rankings` | sort the loaded GeoJSON features client-side |
| `GET /api/methodology` | static `public/data/methodology.json` (trimmed `calibration.json`) |

A thin `src/api.ts` module exposes the same shapes (`getGeojson`, `lookupPostcode`,
`getRankings`, `getMethodology`) so `App.tsx` changes are minimal — just swap the
`fetch('/api/…')` calls for these functions.

---

## Sprint 1 — Static-ready data layer + deploy pipeline ✅ DONE

**Shipped:** `src/showcase/bake_static.py` (`make showcase-data`) bakes
`frontend/public/data/areas.geojson` (simplified to ~37 MB raw / **~4.8 MB gzip** —
simplify 180 m + 4 dp coords + lean integer props) and `methodology.json`.
`frontend/src/api.ts` replaces the four endpoints client-side; `App.tsx`,
`RankingsPanel.tsx`, `Sidebar.tsx` now call it (zero `/api/*` in the built JS,
verified). Vite `base` is `/london-insurance-risk/` under `GITHUB_PAGES=1`.
`.github/workflows/deploy-pages.yml` builds + deploys on push to `main`.

**Key deviation from the original plan — postcode lookup uses coordinates, not the
LSOA code.** postcodes.io's `codes.lsoa` is now the **2021/2022** census code, which
does **not** match our **2011** `area_code`s (verified: Edinburgh/Cardiff codes were
absent from our data). So `lookupPostcode` returns the postcode's **lat/long** and
`featureAtPoint` (new, in `utils.ts`) finds the containing area by **point-in-polygon**
— vintage-independent and uniform across nations. Aggressive simplification leaves
tiny gaps between dense-urban polygons, so it falls back to the **nearest area** when
no polygon contains the point (validated on WC1/EH1/EC1/SW1 — all resolve correctly).

### Original task breakdown (for reference)

1. **Bake static assets** (new `make showcase-data` target):
   - Simplify `data/processed/lsoa_risk.geojson.gz` geometries (geopandas
     `.simplify(tolerance)` + coordinate rounding to ~5 dp) → `frontend/public/data/areas.geojson`, target ≤ 5 MB. Keep only the props the UI needs (`area_code`, `area_name`, `calibrated_premium`, `premium_place_only`, `risk_index`, `quintile`, the `*_pct`/`*_val`/`*_contrib` fields).
   - Trim `reports/calibration.json` → `frontend/public/data/methodology.json`.
   - These derived files **are committed** (Pages needs them in the build); document that `make showcase-data` regenerates them.
2. **`src/api.ts` client shim** — implement the four functions above. postcodes.io: `GET https://api.postcodes.io/postcodes/{pc}` → `result.codes.lsoa` (this is the 2011 LSOA for E+W and the Data Zone `S01…` for Scotland, matching our `area_code`); also return `result.longitude/latitude` for the fly-to. Handle not-found / outcode-only / Scotland gracefully; cache the parsed GeoJSON in memory.
3. **Vite base path** — `base: process.env.GITHUB_PAGES ? '/london-insurance-risk/' : '/'` so dev keeps working; asset + data URLs respect it.
4. **GitHub Actions** — `.github/workflows/deploy-pages.yml`: build frontend, upload Pages artifact, deploy on push to `main` (and manual dispatch).
5. **Verify** the static build locally (`vite build && vite preview`) with the network tab confirming no `/api/*` calls remain.

*Outcome: the existing UI runs fully static and is live on a public URL.*

---

## Sprint 2 — Editorial visual redesign ✅ DONE

**Shipped — "The Price of Place".** Direction chosen via a 4-way editorial design panel
(FT / Economist / NYT-Upshot / fintech lenses) judged on polish · intuitive UX · data
integrity. Synthesised winner: **Fraunces display + Inter UI**, a warm **amber→crimson
sequential £ ramp** (colourblind-safe, monotonic lightness), **ink hero £** (the map
carries the colour), hairline "ledger" panel structure, and a **£-keyed legend with a
"£558 GB-avg" notch** echoed through the detail sparkline.

- **Design tokens** rebuilt in `index.css` (paper/ink palette, ramp, type scale,
  radius/shadow ladders, focus rings, reduced-motion, contrast). Dead `App.css` deleted.
- **Masthead** — serif title + standfirst + an honest metric line (R² 0.917 · ±£89 ·
  41,729 areas *mapped* — kept distinct from the calibration n=106).
- **Map** — quiet positron basemap, warm choropleth, ink selected-outline, editorial
  hover popup, filter pill with reset.
- **Legend** — £-keyed quintile ramp with live boundary ticks + the GB-average notch;
  continuous percentile ramp for driver views.
- **Detail card** — quintile-aware lede, ink hero £, index `/100` + quintile pill, the
  **three numbers** strip (full / place-only / composition uplift), distribution with
  the avg notch, and a per-driver £ breakdown that **separates the 5 model drivers from
  the 4 map diagnostics** (tagged) for credibility.
- **Methodology panel** rebuilt to surface the real metrics (R² · LOAO £ · Spearman),
  the per-feature partial-r/VIF table, and the MoneySuperMarket cross-source check.
- **States** — map + sidebar skeletons, clean inline search errors.
- **Responsive + a11y** — desktop split / mobile stacked, focus-visible rings, aria
  labels + roles, `prefers-reduced-motion` and `prefers-contrast`.
- **Geometry** — re-baked with `set_precision(valid_output)` (120 m simplify, 10 m snap,
  5 dp) to repair the simplification self-intersections that rendered small urban areas
  as spikes (174 → 0 invalid polygons); ≈ 42 MB raw / **6.1 MB gzip**. Fly-to zoom capped.

---

## Sprint 3 — Showcase functionality

1. **⭐ Compare two areas** — the project's origin story (London ~£7k vs Rugby ~£2k). A compare mode: two postcode inputs → side-by-side premium + driver breakdown + the spatial multiplier ("≈ N× more"). This is the single most compelling demo and maps straight onto the data we already expose.
2. **Guided landing** — first load focuses on (or offers a one-click) London-vs-Rugby comparison, with a short "what am I looking at" callout.
3. **Postcode UX** — validation, recent searches, optional "use my location" (geolocation → nearest area centroid).
4. **Deep links** — ensure `?area=…&filter=…&compare=…` restore state for sharing.
5. **Rankings panel** — most/least expensive areas (client-side), each clickable to fly the map.
6. **Methodology/About showcase** — surface the *substance*: validation metrics (R² 0.917, LOAO £89, Spearman 0.97), the feature-significance table, spatial-multiplier checks, the cross-source (MSM) agreement, and the honest grain caveat. This is what makes it read as rigorous, not just pretty.

---

## Risks / caveats

- **postcodes.io dependency** — external free API (OGL, generous limits). If down, search degrades but the map still works; consider a tiny bundled outcode→area fallback later.
- **Static snapshot** — data updates require `make showcase-data` + redeploy (fine for a showcase).
- **GeoJSON size** — simplified to ~3–5 MB; if first paint still drags, PMTiles is the upgrade path (deferred per the map-data decision).
- **Repo size** — committing a ~5 MB GeoJSON is acceptable; keep it the only large committed artifact.

## Sequencing

Sprint 1 (deploy foundation, ~half day) → live static site → Sprint 2 (visual
redesign, ~1–2 days) → Sprint 3 (compare + showcase features, ~1–2 days). Each
sprint is independently shippable; the site is public and improving after Sprint 1.
