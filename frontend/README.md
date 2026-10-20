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

## Source modules

Components are the `*.tsx` files in `src/`; the logic they share lives in plain modules,
most with their own test file (see below):

| Module | What it holds |
|--------|---------------|
| `announce.ts` | Live-region announcements that repeat when the same text is set twice |
| `api.ts` | The client-side data layer: rankings, the landing pairs and premium span, methodology, the streamed GeoJSON, the tiles URL |
| `callout.ts` | The landing's first-visit "What am I looking at" card: when it shows, its copy, its dismissal |
| `dataSources.ts` | "About the data": one entry per data source behind a colour mode |
| `keyboard.ts` | Roving-tabindex lists and type-ahead, and what Escape does |
| `layout.ts` | Layout tunables: breakpoints, sheet heights, tap size, timeouts, map fit padding and camera |
| `locate.ts` | "Near me": a browser location to the area it falls in |
| `postcode.ts` | Postcode normalising and validation, the postcodes.io lookup, recent searches |
| `search.ts` | Where a search's result goes when a compare is armed or cancelled |
| `theme.ts` | Light and dark basemaps, and the CSS tokens MapLibre needs |
| `types.ts` | The data shapes |
| `url.ts` | The share URL codec and the tab title (`pageTitle`) |
| `utils.ts` | Formatting, geometry helpers, premium bands, the detail/explain/compare text, the compare multiplier, p-values, nation counts, the methodology note |

## Tests and what each pins

| File | Pins |
|------|------|
| `src/announce.test.ts` | `announce` clears the region and sets the text after a pause, so a repeated message is read again |
| `src/api.test.ts` | `getRankings` ordering and its nation filter, `getMethodology`, `getGeojson`'s streaming and progress, `tilesUrl`, `examplePairs` and `premiumSpan` |
| `src/callout.test.ts` | When the first-visit card shows, that its sentences match `README.md` and the About intro, and how its dismissal is stored |
| `src/colors.test.ts` | Each step of the colour ramp and quintile fill gets darker (CIE L*), so the scale reads without colour; WCAG AA contrast for legend labels and faint ink; `index.css` tokens mirror the JS colours, keep hard-coded colours out, and define a dark scheme |
| `src/keyboard.test.ts` | Arrow, Home/End and type-ahead index maths for the rankings and segmented controls; `escapeAction` |
| `src/layout.test.ts` | `index.css` uses only the breakpoints, tap sizes and reserved heights declared in `layout.ts`; map fit padding and camera; what the detail section shows while a lookup runs |
| `src/locate.test.ts` | "Near me": finding the area containing a point, the nearest-edge fallback and its threshold |
| `src/methodology.test.ts` | The figures on `docs/PROJECT_SUMMARY.html` (served as `methodology.html`) match the committed data |
| `src/methodologyTables.test.ts` | The methodology block's lists are tables with captions and column headers; the feature table's p-value column goes through `formatP` |
| `src/methodology-style.test.ts` | The methodology page's ink, paper and accent tokens equal `index.css`'s (light and dark), and it uses the map's fonts and quintile fill |
| `src/noTypedCount.test.ts` | No component types the priced-area count in as a literal |
| `src/postcode.test.ts` | Postcode normalising and parsing, Northern Ireland detection, `resolvePostcode`'s error mapping and the recent searches |
| `src/search.test.ts` | A compare cancelled during its lookup never pins its result or replaces the main area |
| `src/selection.test.ts` | Every action that changes the panel bumps `selectionId`, so a late "Near me" fix drops itself; `clearDetail` is memoised, and Escape closes the panel and returns focus to the search box |
| `src/serveConsistency.test.ts` | The baked GeoJSON rebuilds each premium from its baseline plus the five driver steps (frontend half of `tests/test_serve_consistency.py`) |
| `src/url.test.ts` | The share URL codec: `parseShareUrl`, `buildShareUrl` and the valid filters; `pageTitle` |
| `src/utils.test.ts` | Formatting (`gbp`, `ordinalPct`, figures), bounds and point-in-area helpers, premium bands and ramp, the detail/explain/compare text and `premiumMultiplier`, `formatP`, `methodologyNote`, nation and ranking group, and that About covers every colour mode, counts areas by nation and gives the premium span from a prop |
| `src/waterfallTable.test.ts` | The premium waterfall is a table with a caption and headers, its bars hidden from screen readers but each bar cell read as a share of the largest step, and no `display` on a table element |
| `scripts/og-template.test.mjs` | The share card shows the figures from `methodology.json`, leaves out any it lacks, and takes its colours from `index.css` |
