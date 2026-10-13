# Holiday queue (13 to 23 October 2026)

Anu is away with a phone. Direction: **showpiece polish** of the live map. A cloud routine (`holiday-riskmap`, Opus, twice daily) works this queue one package at a time and merges its own work: nothing waits for approval (see **Merging**). A second routine (`holiday-queues`, Fable) refills the queue (see **Refill**).

Merging to `main` deploys https://anugnane.github.io/london-insurance-risk/ through `.github/workflows/deploy-pages.yml`, but only when the push touches `frontend/**` or that workflow (its `paths` filter). The workflow runs `npm ci` and `GITHUB_PAGES=1 npm run build` in `frontend/` and publishes `frontend/dist`; the Python pipeline is never deployed. A merge that only touches this file, docs or `src/` does not redeploy.

**The cloud has no data.** Everything under `data/` (except the tracked `data/manual/` anchor panel) and `reports/` is git-ignored, so `make ingest`, `features`, `risk`, `calibrate`, `showcase-data` and `showcase-tiles` cannot run there. What the site serves is committed: `frontend/public/data/areas.geojson` (52 MB, served gzipped at about 8 MB; every feature carries `lsoa11cd`, `lsoa_name`, `quintile`, `risk_index`, `calibrated_premium`, `premium_low`/`high`/`baseline`/`place_only`, and `*_pct` for every layer plus `*_contrib` for the five drivers), `methodology.json` and `lsoa-risk.pmtiles` (baked for the Vouched map; the frontend does not read it). In the cloud these three files are **read-only**.

## Hard rules

- `AGENTS.md`'s golden rules apply: never commit data, respect source terms, one spatial vintage, config over constants.
- Never commit anything under `data/` or `reports/`, and never `frontend/dist` or `node_modules`. `git add` explicit paths, never `git add -A`.
- Never hand-edit `frontend/public/data/*` (`areas.geojson`, `methodology.json`, `lsoa-risk.pmtiles`). They are baked by `make showcase-data` / `make showcase-tiles` on Anu's Mac.
- Config over constants: pipeline tunables live in `config/config.yaml` (read via `src/common/config.py`); frontend tunables (breakpoints, paddings, counts, colours) live in one module, not scattered through components.
- **needs-mac lane.** Anything that needs data (recalibration, a new feature into the model, re-baking the GeoJSON or tiles, adding a property to the baked files) is never done in the cloud. Open it as a PR titled `needs-mac: <what>` on `holiday/<id>` with the code change (if any) and the exact commands for Anu's Mac, including `CLAUDE.md`'s Vouched refresh rule when the model changes; do not merge it. At most one needs-mac PR open at a time; packages that depend on it stay blocked.
- No new runtime dependency without a ruling in the PR. Dev dependencies for tests are allowed (R-2 brings in the test runner).
- Never weaken or delete a test to get green. Never force-push; never rewrite `main`.

## The gate

Run on the branch's final commit, from a clean checkout, and paste the result lines into the PR:

```
uv sync --extra dev        # or: pip install -e '.[dev]'
uv run pytest -q           # data-free subset, see below
uv run ruff check
cd frontend && npm ci && npm run lint && GITHUB_PAGES=1 npm run build
```

**The data-free pytest subset** is the whole suite as it runs without `data/` and `reports/`: on 13 October a fresh clone gives `62 passed, 4 skipped`. The 4 skips are `tests/test_serve_consistency.py` (it needs `reports/calibration.json`); `tests/test_api.py`'s rankings/risk/geojson tests pass vacuously without data. A run fails the gate if passes go down or skips go up versus `main`. From R-2 on, `cd frontend && npm test` is part of the gate too.

**Until R-1 is ticked, `main` itself is red:** `ruff check` reports 1 error (an unused `TILES_NAME` import in `tests/test_bake_tiles.py`) and `npm run lint` 27 errors and 2 warnings. Before R-1 the rule is "no new findings versus `main`" (paste both counts); after R-1, both must be clean.

## One package a run

1. `git fetch origin`. A package is **done** when its box below is ticked on `main`. It is **blocked** when a package it depends on is not done, or when it waits on an open needs-mac PR.
2. **Resume first.** A branch `holiday/<id>` (or `claude/holiday-<id>`) on origin that is not merged into `main` is an unfinished run, most likely cut off by a usage limit. Check it out, read its commits and PR, finish it under **Merging**, and only then consider a new package. Never leave a second unfinished branch behind. (An open `needs-mac:` PR is not unfinished; leave it for Anu.)
3. Take the first package that is neither done nor blocked. If there is none, write one line saying so and stop; `holiday-queues` refills.
4. Branch from `origin/main` as `holiday/<id>` (if the push is refused, `claude/holiday-<id>`). Small commits in the repo's style: conventional subjects (`feat(ui): ...`, `fix: ...`, `test: ...`, `docs: ...`).
5. Tick the package's box here in the same branch.
6. Open the PR with the body below, then follow **Merging**.
7. **Time left?** A run whose package has merged and deployed with time to spare goes back to step 1 and takes the next ready package. Never start one it cannot finish: one unfinished branch at most.

A ruling is a decision only Anu can make. Do not block on it: pick a default, state it in the PR, and carry on. The default stands; if Anu comments on the PR or writes in the **Inbox**, the next refill turns that into a package.

## Merging

A merge deploys, so the gate is the whole protection.

1. **The gate is green** on the branch's final commit (above), pasted into the PR. Once R-1 has added the PR workflow, its checks must be green too.
2. **Review before merging.** Reread the whole diff (`git diff origin/main...HEAD`) as a reviewer would, with a subagent (the Task/Agent tool) if available: anything the package did not ask for, any test weakened or deleted, anything under `data/`, `reports/` or `frontend/public/data/`, any tunable hard-coded in a component, any behaviour change on desktop the package did not ask for. Fix what it finds; rerun the gate.
3. **Rebase on `origin/main`** just before merging. If the rebase touched a file, rerun the gate.
4. **Merge** with the GitHub MCP tool (`merge_pull_request`, method `merge`, matching the repo's merge commits). `gh` is not logged in in the cloud and GraphQL is blocked, so do not reach for either. If the MCP merge is unavailable, `git push origin HEAD:main` after the rebase (a fast-forward); GitHub marks the PR merged. Delete the branch.
5. **After the merge**, if the merge touched `frontend/**` or the workflow, wait for the "Deploy showcase to GitHub Pages" run (the GitHub MCP tool can list workflow runs; otherwise three minutes, a deploy takes about two and a quarter), then `curl -sI https://anugnane.github.io/london-insurance-risk/` and, for the new build, the hashed JS asset named in the served `index.html` (`curl -s .../ | grep -o 'assets/index-[^"]*\.js'`, then `curl -sI` it) plus any new file the package added. If the site is broken, open a revert PR of the merge commit and merge that too; say so in the notification.
6. **Report:** the PR is the record for the phone. Finish with one push notification: the package id, merged, the gate line, and what to try on the phone.

### PR body

```
## For the phone
**What:** two or three lines.
**Gate:** pytest result line, ruff result, `npm run lint` result, `npm run build` result (and `npm test` from R-2).
**Try it:** what to do on the phone once it is live (which postcode, which tap, what to look for).
**Rulings:** numbered; each with a default marked. "None" when there are none.
**Risk:** one line.
```

## Refill

Done by `holiday-queues`, not by the package runs. When fewer than two packages are ready, add up to three, each sized for one Opus run, each data-free, each with files, dependencies, a ruling with a default where one is needed, and a "Try it" line. Sources in order: the **Inbox**, comments on merged PRs, leftovers a PR named, then the candidates below. Prefer what someone opening the link on a phone would notice. Commit on `holiday/refill-<date>`, merge under **Merging** (the gate still runs; nothing deploys), and stop.

Candidates: a nation filter on the rankings (England / Wales / Scotland from the `lsoa11cd` prefix); compare two areas side by side; keyboard navigation of the rankings and the map; an `og:image` generated at build time (no binary committed); streaming first paint from the committed `lsoa-risk.pmtiles` (first check its attributes with `npx pmtiles show`; if it lacks what the fill and popup need, that is a needs-mac re-bake, not a cloud package).

## Queue

- [x] **R-1 Green gate and PR checks.** `main` fails its own linters. Fix `ruff check` (the unused `TILES_NAME` import in `tests/test_bake_tiles.py`) and every `npm run lint` finding without changing behaviour: 20 `no-explicit-any` (`utils.ts` 8, `MapView.tsx` 7, `api.ts` 2, `App.tsx`, `types.ts`, `RankingsPanel.tsx`), 2 `ban-ts-comment` (`MapView.tsx`'s `@ts-ignore` on the `react-map-gl/maplibre` import and the `fill-color-transition` paint key), 3 `react-hooks/set-state-in-effect` (`App.tsx` 2, `RankingsPanel.tsx` 1, where `useMemo` replaces the effect), 2 `react-hooks/immutability` (`App.tsx` calls `focusLsoa` and `setPendingArea` before they are declared) and 2 `exhaustive-deps` warnings (`App.tsx`, `MapView.tsx`). Real types, not `unknown` casts everywhere; no rule switched off in `eslint.config.js`; at most two inline disables, each with a one-line reason. Add `.github/workflows/ci.yml` on `pull_request`: a Python job (`uv sync --extra dev`, `uv run ruff check`, `uv run pytest -q`) and a frontend job (`npm ci`, `npm run lint`, `GITHUB_PAGES=1 npm run build`). Try it: nothing should look different; search E1 6AN, tap a ranking, switch the colour mode, open a shared `?area=` link.
- [x] **R-2 Frontend unit tests.** Depends on R-1. Add Vitest (dev dependency, pinned) and `npm test` (`vitest run`), and a step in the R-1 CI job. Tests in `frontend/src/*.test.ts` for the pure helpers in `utils.ts` and `api.ts`: `gbp`, `ordinalPct` (11th/12th/13th, 21st, 22nd), `featureBounds`, `featureAtPoint` (inside, inside a hole, the nearest-area fallback for a point in a simplification gap), `quintilePremiumBands`, `premiumToRampPos`, `computeDistribution`, `featureToDetail`, `dominantDriver`, `getRankings`, and `getMethodology` shaping the committed `methodology.json` (fetch stubbed). One test reads a sample of features from the committed `areas.geojson` and asserts `premium_baseline + Σ *_contrib == calibrated_premium` within £1 for each, the frontend half of the serve-consistency guard that the cloud can run. The gate gains `npm test`. Ruling: component tests with jsdom and Testing Library now or later (default: later; pure functions only here).
- [ ] **R-3 Phone layout and touch.** Depends on R-1. At 390x844 and 360x740 (the `max-width: 820px` and `560px` blocks in `index.css`): the map/sheet split uses `dvh` with a `vh` fallback so the iOS toolbar does not crop it; the sheet gets a drag handle or a toggle with collapsed (masthead and search) and expanded states, and expands when an area is selected; `viewport-fit=cover` in `index.html` plus `env(safe-area-inset-*)` padding; tap targets at least 44 CSS px for the colour-mode buttons, ranking rows, disclosure toggles and "Back to rankings"; the search input at 16 px or more so iOS does not zoom on focus. The hover popup is mouse-only, so on `(hover: none)` a tap on the map shows a compact name-and-£ card for the tapped area even with the sheet collapsed. `MapView`'s `fitBounds` padding (120 today) scales to the viewport and leaves room for the sheet; the legend compacts or collapses so it never covers the zoom control or the MapLibre attribution. Desktop unchanged. Breakpoints and paddings in one module. If a headless Chromium is available, measure at both viewports and list what was measured in the PR (screenshots are not committed); if not, say so under Risk. Ruling: the sheet's first state on a phone (default: collapsed to masthead and search, map about 60 percent).
- [ ] **R-4 Postcode search that forgives, and links that share.** Depends on R-2. A new `frontend/src/postcode.ts` with tests: normalise input (trim, upper-case, collapse spaces, insert the space before the inward code), validate the UK format before any network call, and accept an outcode alone (`E1`, `SW1A`, via `https://api.postcodes.io/outcodes/<code>`; the panel says "district centre"). Distinct messages for a malformed postcode, not found, Northern Ireland (`BT`, the model excludes NI and says why), offline or network failure, and rate limiting (429). A visible search button with a busy state and a clear (×) button; recent searches (last 5 successful) under the input when it is focused and empty, stored in `localStorage` inside try/catch so the app works when storage throws, with a "clear" link. Sharing: a postcode selection puts `?pc=` in the URL beside the existing `?area=` and `?filter=` (`App.tsx`'s `updateUrl`), restored on load (falling back to `area` if postcodes.io fails); a Share button in the detail panel uses `navigator.share` where available, else copies the link and shows "Link copied". Ruling: whether recents persist across sessions (default: yes, 5 entries, clearable).
- [ ] **R-5 Explain this score.** Depends on R-2. `DetailPanel.tsx` already has the LMDI waterfall ("Why this price"); make it read for a stranger. A pure `explainArea(steps, baseline, premium)` in `utils.ts` (tested) writes one plain sentence: the largest one or two factors pushing the price up and the largest pulling it down, with percentile and £ ("Dearer than a typical GB area mainly because of young drivers (91st percentile, +£142) and crime deprivation (+£88); more cars per household pulls it back £40."). Under it, the five drivers as percentile dots on a 0 to 100 track with the GB median at 50, grouped "Place" and "Who lives there", keeping the Scotland flag on vehicle crime. Tapping a driver colours the map by it (tap again for premium): add `young_driver_share` and `cars_per_household` to `ColorMode`, `COLOR_MODES` and the URL's valid filters (both `*_pct` fields are already in the GeoJSON). A short "What is a percentile?" disclosure. No number in the panel changes. Ruling: when a factor is named in the sentence (default: only if its step is at least £10).
- [ ] **R-6 A legend that works without colour, and dark mode.** Depends on R-3 (both edit `index.css` and the legend). Legend: the five quintile segments carry Q1 to Q5 and their £ ranges as text, the selected area's quintile is marked on the legend by position, and the legend has a text alternative for screen readers; the waterfall's up/down rows carry an arrow as well as red/green. A test asserts that `RAMP` and `QUINTILE_FILL` get monotonically darker (CIE L*), so the scale reads in greyscale and for colour-blind viewers. Dark mode under `prefers-color-scheme: dark`: the `--paper`/`--ink`/`--rule` token family redefined, the hard-coded hexes in the `.wf-*`, `.chip-*` and popup rules moved to tokens, the basemap switched to Carto Dark Matter (`https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`) by a `matchMedia` listener, area outlines and the selected outline from tokens, and a dark `theme-color` meta. Ruling: a manual light/dark toggle (default: none, follow the system).
- [ ] **R-7 Methodology page on the site.** Depends on R-1. `docs/PROJECT_SUMMARY.html` is the project's write-up but is not deployed (Pages publishes `frontend/dist`). Make the frontend build copy it to `dist/methodology.html` (a small script run by `npm run build`, so the gate builds what deploys) and add `docs/PROJECT_SUMMARY.html` to the deploy workflow's `paths`. Refresh it against `methodology.json`, `README.md` and `AUDIT.md`: every figure (R², LOAO MAE, temporal MAE, Spearman, n, the £ span, the interval width) checked and corrected, a link back to the map, and links to `AUDIT.md` and `DATA_PROVENANCE_AND_TRANSFORMS.md` on GitHub. The map's masthead gets a "How it works" link to it, and `README.md`'s docs table the live URL. No new figure without a source in those files. Try it: on the phone, tap "How it works", read, come back to the map.
- [ ] **R-8 Lighthouse performance and accessibility pass.** Depends on R-3 and R-6. Measure mobile Lighthouse before and after: `npx lighthouse` against `npx vite preview` of the Pages build if Chrome runs in the sandbox, otherwise the PageSpeed Insights API on the live URL (`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=...&strategy=mobile&category=performance&category=accessibility`); paste both score sets. Fixes within reach without data: lazy-load the map chunk (`maplibre-gl` is about 1 MB, 273 kB gzipped) so the masthead and search paint first; `preconnect` to `basemaps.cartocdn.com` and `api.postcodes.io`; a loading readout for the GeoJSON download; landmarks (`main`, `aside`), an `aria-label` on the map region, heading order, and a skip link; contrast of `--ink-faint` (#8a8175 on #fbf7f0 is below 4.5:1 for small text). The baked data stays as it is. Ruling: darkening `--ink-faint` to pass AA (default: yes).

## Inbox

Notes from Anu's phone land here, newest last.

- (empty)
