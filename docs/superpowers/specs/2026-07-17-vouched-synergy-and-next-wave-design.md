# Vouched synergy + next model wave — design

**Date:** 2026-07-17
**Status:** Approved (user, 2026-07-17)
**Scope:** Two repos — this one (`london-insurance-risk`) and Vouched (`~/Library/Projects/Car Marketplace/vouched`, the first-car marketplace live at vouched.autos).
**Supersedes/extends:** `2026-07-15-evolution-roadmap-design.md` (re-ranks its ladder; does not replace it) and `2026-07-15-phase4-flood-completion.md` (whose Tasks 1–6 shipped on the implementation branch via `43fb405`/`a39321c`; Wave 1 below is its Tasks 7–10 adjusted to reality).

---

## 1. Context at design time

- The flood ingest (`python -m src.ingest.flood`) is running on the main checkout (branch `docs-finalize-transparency`), which carries the July implementation commits: flood code complete for all 3 nations (`43fb405`, England Defra-SFTP ingest `a39321c`), uncertainty-band code (`cfe74df`), IMD crime/income sub-domain extraction (`3af592d`).
- `data/interim/` was wiped; only boundaries exist. `data/processed/` and `reports/calibration.json` are still the **June model** (Jun 21: n=106 anchors, R²=0.9168, LOAO MAE £88.77, Spearman 0.968, national avg £558.55).
- Vouched already consumes this model: `vouched/packages/tco-data/build_area_premiums.py` reads `data/processed/lsoa_risk.parquet` + the ONSPD zip from this repo via sibling paths and emitted `vouched/data/area-premiums.json` (commit `6b490d1`, 2026-07-15): 2,773 outward districts, `p` = postcode-count-weighted median annual £, `idx` = 0–100 risk index, `LONDON_BASE` £796 as scaling denominator. Script gates: ≥95% postcode-join coverage, 2,500–3,300 districts, every `p` in £150–£2,000, LONDON_BASE > DEFAULT.
- `estimate.ts` applies `annual × (p_district / p_LONDON_BASE)` behind `NEXT_PUBLIC_DISTRICT_SCALING` (build-time env; defaults **off**; production state lives in Vercel and only the founder can flip it).
- The Vouched `/data/*.json` contract is frozen at v1.3 (`vouched-workstream-split.md` §3); schema changes require editing §3 first with integrator (founder) approval.
- This planning worktree (`insurance-risk-model-expansion-a52aa5`) is behind the implementation branch and is retired after this spec lands; all execution happens on the main checkout.

## 2. Decisions taken (user, 2026-07-17)

1. **Gate bundling:** the next `make calibrate` evidence-gates **flood_risk + imd_crime + imd_income together** in one cycle. The gate scores candidates independently (partial correlation, VIF, sign, LOAO delta), so attribution stays per-feature.
2. **Vouched sync:** after the flood-era recalibration ships, **regenerate `area-premiums.json` and flip `NEXT_PUBLIC_DISTRICT_SCALING=1`** (founder flips in Vercel).
3. **Synergy builds:** all four approved — bridge provenance + drift guard, SEO data pack, map cross-links + share-card area line, quote-fairness baseline spec (design-only).
4. **Coupling approach:** *versioned data-contract bridge* — exporter stays on the Vouched side (Agent A territory, gates included); staleness made visible via provenance stamps + drift guard + a written refresh rule in both repos. Rejected: tight coupling (a `make` target here emitting Vouched's pack — breaks contract ownership, couples venvs) and bare runbook-only coupling (freshness by memory).

## 3. Wave 1 — finish the model wave in flight (this repo)

All on the main checkout. Never run `make risk` alone (train/serve-skew trap); `make calibrate` re-runs risk + showcase-data.

1. **Flood output check** (after the running job finishes): `data/interim/flood.parquet` has all three nations; areas outside any supplied extent are NaN, never zero-filled; per-nation coverage stats logged and sane (England from the 86 Defra RoFRS tiles, Scotland SEPA, Wales NRW).
2. **Re-run remaining ingests** (`make ingest`): crime (E+W + Scotland), STATS19, IMD (now emits crime/income sub-domains), census, traffic/AADF, ONSPD (also rebuilds `postcode_lookup.parquet`, needed by Wave 2). Raw caches survived, so mostly local-speed.
3. **Wire gate candidates in config:** uncomment `flood_risk` under `features.place` (safe once step 1 passes — activating with an all-NaN column would drop every calibration row) and add `imd_crime`/`imd_income` as place candidates (exact feature/column names to match what `3af592d`'s ingest emits in `deprivation.parquet`; resolved in the implementation plan). **Known wiring check:** `aggregate_to_lsoa.py` must pass the new IMD sub-domain columns through to `lsoa_features` — the ingest emits them; the join may not carry them yet.
4. **Evidence-gate run:** `make features && make calibrate`. This single cycle scores all three candidates into `reports/feature_analysis.md`, generates the bootstrap+LOAO premium intervals (`cfe74df` code) into the processed outputs, and re-runs risk + showcase-data. Read the verdicts; demote dropped candidates to `features.diagnostics`; if config changed, run `make calibrate` once more. A "no candidate survives" outcome is itself reportable — the gate exists to say no.
5. **Frontend:** wire the flood layer (as driver or diagnostic per the gate verdict — `ColorMode`/labels/sidebar/filter/about lists), and browser-verify the hero premium range ("£520–£640") renders from the new interval fields.
6. **Docs + hygiene:** update STATUS.md; write the `AUDIT.md` interval-width defence (bootstrap-only understates; LOAO widening is the honest correction); DATA_PROVENANCE entries for the three flood sources incl. the Defra SFTP runbook; close out PHASE4_PLAN.md. Commit the dirty tree only after the pipeline validates (`src/common/esri.py` has uncommitted changes the running job may depend on); reconcile the in-progress docs-reorg (root docs → `docs/superpowers/info/`). Founder creates the PR.

**Definition of done:** tests green, ruff clean, `make calibrate` artifacts current, map serves the new model, STATUS.md updated.

## 4. Wave 2 — formalize the bridge, regenerate, flip the flag (both repos)

1. **Contract edit** (`vouched-workstream-split.md` §3, founder approves as integrator): additive, meta-only provenance fields on `area-premiums.json` — `model_commit` (source repo git sha), `model_calibration_date`, `anchors_n`, `r_squared`. `areas`/`fallback_regions` schemas unchanged → `estimate.ts` untouched.
2. **Exporter update:** `build_area_premiums.py` reads `reports/calibration.json` (+ `git rev-parse HEAD` of the sibling repo) and writes the stamps.
3. **Drift guard:** extend `packages/tco-data/validate_contract.py` to require sane provenance fields; add a regeneration-time check that warns when `meta.model_commit` is behind the sibling repo's HEAD. Runs only where both repos exist (founder's machine) — never in Vercel CI.
4. **Regenerate** from the flood-era `lsoa_risk.parquet`. **Explicitly review the £150–£2,000 gate** against the new premium span — a recalibration may widen it, and a gate breach must be a conscious decision, not a silent constant edit. Commit on the Vouched side (founder merges as integrator).
5. **Activation:** founder sets `NEXT_PUBLIC_DISTRICT_SCALING=1` in Vercel and redeploys; spot-check several postcodes on the live Finder against the risk map (e.g. a London district vs a cheap Scottish one).
6. **Refresh rule, in writing, both repos:** *every model-changing ship in `london-insurance-risk` ⇒ regenerate the Vouched pack.* Recorded in this repo's CLAUDE.md/STATUS.md ship checklist and Vouched's HANDOVER.md.

## 5. Wave 3 — synergy builds

1. **SEO data pack** (Vouched side, `packages/tco-data`): a script emitting a markdown pack of citable figures — cheapest/dearest districts per major city, "London costs ×N your area" ratios, young-driver framing via Vouched's own age curve × district factor. Every figure traces to the model artifact (no-invented-figures rule carries over); Vouched language discipline holds (estimates, never quotes; telematics assumption stated). Powers the three launch articles; writing/publishing stays with the founder.
2. **Cross-links:** the Finder's area-factor bar links to the risk map ("why is my area factor 72?"). The map gains a small `?district=` deep-link handler (accept an outward district; centre/zoom via a district→centroid lookup baked at `showcase-data` time from ONSPD — deterministic, no runtime dependency) — deliberately the first sliver of ladder item 2.12. The share card gains "cheaper to insure than N% of GB" from the `idx` field it already receives (Agent B UI change, no contract impact).
3. **Quote-fairness baseline spec (design-only):** benchmark = district `p` × Vouched's car/age scaling; "fair range" = the map's `premium_low`/`premium_high` scaled the same way. Spec doc saved to Vouched's `docs/superpowers/specs/` when written; no build until D7's widget is scheduled.
4. **Vouched §9.1 "publish the risk map as a page":** cross-link to the deployed GitHub Pages map now; embed later via ladder 2.12 (iframe widget + PMTiles). Do **not** rebuild the map in Next.js.

## 6. Ladder re-rank (this repo, after Waves 1–2)

1. Finish 2.3's remainder — Scotland crime grain fix (SIMD crime-domain disaggregation), Moran's I diagnostic, urban/rural stratified check — one PR.
2. 2.4 comparison view (two-area waterfall delta).
3. **2.12 embeddable widget moves up** (Vouched Phase B demand; the `?district=` deep-link from Wave 3 is its first piece), pairing with 2.5 PMTiles.
4. Rest of the ladder unchanged; re-rank after each ship.

## 7. The long loop — real quotes close the circle

When Vouched's concierge phase captures `insurance_outcome_json` (what a buyer actually paid), log the map's predicted premium for that postcode/car/age alongside at capture time. The accumulating actuals-vs-predictions panel (a) validates the map at exact-postcode, young-driver grain, and (b) is a Month-5 insurer-pitch asset. Design note only — build when concierge starts. The existing 32 quotes are effectively one location and add no geographic signal; skipped for formal validation.

## 8. Out of scope / rejected

- Tight repo coupling (export target inside this repo) and monorepo moves.
- Rebuilding the map inside Vouched's Next.js app.
- Formal validation against the current 32-quote panel.
- Any further Vouched premium-model sophistication (their D7 stands; the map is the territorial factor, nothing more).
- A hosted public API (roadmap position unchanged: static contract only).

## 9. Risks & guards

| Risk | Guard |
|---|---|
| Flood gate run on a partially-ingested feature table | Wave 1 step 1 coverage check before config activation; NaN-not-zero contract |
| Stale premiums shipped (`risk` without `calibrate`) | Ship checklist wording; `make calibrate` is the only entry point used |
| Vouched pack silently stale after recalibration | Provenance stamps + drift warning + written refresh rule |
| Flood widens premium span past exporter's £-gate | Gate breach is a reviewed decision (Wave 2 step 4) |
| Contract creep ("just add a field") | All schema changes via §3 edit + integrator approval, provenance change included |
| SEO figures drift from published model | Pack is generated from artifacts, never hand-written |

## 10. Follow-ups noted for the founder (not part of this design)

- `vouched-plan-revision-2026-07-14.md` D6 ends with "Scraping allowed", contradicting §6's unchanged "no scraping" rule — reconcile before anyone acts on it.
- Vouched's `resolveConfidence` caps off `Boolean(district)` even when scaling didn't actually apply — worth a look when Agent B is next in `estimate.ts`.
- `project_status.md` (14 Jul) still describes `area-premiums.json` as a stub — superseded by `6b490d1`.

## Changelog

- 2026-07-17: Initial version, approved in-session (gate bundling; regenerate + flip; all four synergy builds; coupling approach B).
