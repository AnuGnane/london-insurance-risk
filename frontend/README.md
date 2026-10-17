# Frontend: the GB car-insurance risk map

Vite + React + TypeScript + MapLibre. A fully static site: it reads baked files from
`public/data/` and resolves postcodes through postcodes.io, so no backend runs in
production. It deploys to https://anugnane.github.io/london-insurance-risk/ through
`.github/workflows/deploy-pages.yml` on pushes to `main` that touch `frontend/**`,
`docs/PROJECT_SUMMARY.html` or that workflow.

## Scripts (`package.json`)

| Script | What it runs |
|--------|--------------|
| `npm run dev` | `vite`, the dev server with hot reload |
| `npm run build` | `tsc -b && vite build`, then `scripts/copy-methodology.mjs` (copies `docs/PROJECT_SUMMARY.html` to `dist/methodology.html`) and `scripts/og-image.mjs` (renders the share card to `dist/og.png`) |
| `npm run lint` | `eslint .` |
| `npm test` | `vitest run` |
| `npm run preview` | `vite preview`, serves `dist/` |

### `GITHUB_PAGES=1`

Pages serves the site under `/london-insurance-risk/`. With `GITHUB_PAGES` set,
`vite.config.ts` uses that as the base path; without it (local dev) the base is `/`.
The deploy and CI both build with it, so build the same way to check what ships:

```
GITHUB_PAGES=1 npm run build
```

### The og-image skip path

`scripts/og-image.mjs` renders the card with Playwright's Chromium. A share image is a
nicety, so if Chromium or the render fails the script logs
`og-image: skipped, no dist/og.png (...)` and exits 0: the build, and the deploy, never
break on it. It exits 1 only when `dist/` is missing (run `vite build` first).

## The gate

Run before every merge (see `HOLIDAY.md`); `.github/workflows/ci.yml` runs the same
checks on each PR:

```
uv sync --extra dev
uv run pytest -q
uv run ruff check
cd frontend && npm ci && npm run lint && npm test && GITHUB_PAGES=1 npm run build
```

## The committed data files

`public/data/` holds what the site serves. These files are baked on Anu's Mac from the
real pipeline data (`data/` and `reports/` are git-ignored) and are never edited by hand:

| File | Baked by | Used for |
|------|----------|----------|
| `areas.geojson` | `make showcase-data` (`src/showcase/bake_static.py`) | Every area's geometry, premium, band, percentiles and driver contributions: search, rankings, detail panel |
| `methodology.json` | `make showcase-data` (a trimmed `reports/calibration.json`) | The model figures shown in the app and on the share card |
| `lsoa-risk.pmtiles` | `make showcase-tiles` | The vector tiles drawn first, before the GeoJSON arrives (also read by the Vouched map) |

After a model change, re-run `make calibrate` on the Mac (it re-runs `risk` and
`showcase-data`), then `make showcase-tiles`; see `CLAUDE.md`.

## Tests and what each pins

| File | Pins |
|------|------|
| `src/api.test.ts` | `getRankings` ordering and its nation filter, `getMethodology`, `getGeojson`'s streaming and progress, `tilesUrl` and `examplePairs` |
| `src/colors.test.ts` | Each step of the colour ramp and quintile fill gets darker (CIE L*), so the scale reads without colour; WCAG AA contrast for legend labels and faint ink; `index.css` tokens mirror the JS colours, keep hard-coded colours out, and define a dark scheme |
| `src/keyboard.test.ts` | Arrow, Home/End and type-ahead index maths for the rankings and segmented controls |
| `src/layout.test.ts` | `index.css` uses only the breakpoints and tap sizes declared in `layout.ts`; map fit padding and camera |
| `src/locate.test.ts` | "Near me": finding the area containing a point, the nearest-edge fallback and its threshold |
| `src/methodology.test.ts` | The figures on `docs/PROJECT_SUMMARY.html` (served as `methodology.html`) match the committed data |
| `src/noTypedCount.test.ts` | No component types the priced-area count in as a literal |
| `src/postcode.test.ts` | Postcode normalising and parsing, Northern Ireland detection, `resolvePostcode`'s error mapping and the recent searches |
| `src/search.test.ts` | A compare cancelled during its lookup never pins its result or replaces the main area |
| `src/serveConsistency.test.ts` | The baked GeoJSON rebuilds each premium from its baseline plus the five driver steps (frontend half of `tests/test_serve_consistency.py`) |
| `src/url.test.ts` | The share URL codec: `parseShareUrl`, `buildShareUrl` and the valid filters |
| `src/utils.test.ts` | Formatting (`gbp`, `ordinalPct`, figures), bounds and point-in-area helpers, premium bands and ramp, the detail/explain/compare text, nation and ranking group, and that About covers every colour mode |
| `scripts/og-template.test.mjs` | The share card shows the figures from `methodology.json`, leaves out any it lacks, and takes its colours from `index.css` |
