# London Territory Risk Map — Improvement & Growth Roadmap

> Planning document covering where to take the project next: better model output, more
> data, new growth avenues, UK-wide expansion, and — the big one — how to actually
> **test/validate** the model given that the WTW/Confused index is so granular.
>
> Written against the current state described in `project_overview.md` (M0–M5 done:
> 4,881 London LSOAs, OLS calibration R²≈0.91 on 16 postcode-area anchors, FastAPI +
> React/MapLibre map). Read `PLAN.md` and `AGENTS.md` first.

---

## TL;DR — the honest diagnosis

You've built the hard part. The pipeline, spatial design, and calibration framing are
genuinely portfolio-grade. The two real weaknesses are both about **the anchor**, not the
risk layer:

1. **Calibration is thin (n=16).** With 16 postcode areas and 4 predictors, your R²=0.91
   is impressive but your individual betas are unstable — you already flag this. The single
   highest-leverage improvement is *more anchor rows*, and those rows already exist in the
   data you're using.
2. **Your "granularity problem" is backwards.** You worried the WTW/Confused index is *too*
   granular to test against. It's the opposite — the index is **coarser** than your LSOA
   model, and the granularity it *does* publish (towns + a 20-year quarterly archive) is the
   thing that unlocks both better testing and UK-wide expansion. Details in §3 and §4.

The rest of this doc is ordered by **return on effort**, not by milestone number.

---

## 1. The WTW / Confused index — what it actually publishes (this changes your plan)

I went through the Confused.com / WTW Car Insurance Price Index reporting. The index is
published at **three** geographic grains, not one, and it has a **20-year history**. This
matters because you've been treating it as "16 coarse postcode-area rows," when it's
actually a much richer anchor.

**Grain 1 — Regions** (~13 reporting regions). Inner London, Outer London, West Midlands,
Manchester/Merseyside, Leeds/Sheffield, South West, Central Scotland, Wales splits, Northern
Ireland, etc. ([Confused.com price index](https://www.confused.com/compare-car-insurance/average-car-insurance-cost-uk),
[insurance-edge Q2 2025 table](https://insurance-edge.net/2025/09/17/latest-confused-com-index-says-motor-premiums-are-falling/))

**Grain 2 — Postcode areas** (the 2-letter prefixes — what you currently use; e.g. WC, E, SW).
WTW consistently calls out **West Central London (WC)** as the single most expensive postcode
area in the country (£1,394–£1,738 over recent quarters). ([Insurance Business](https://www.insurancebusinessmag.com/uk/news/auto-motor/uk-car-insurance-costs-decline-for-third-straight-quarter-509505.aspx))

**Grain 3 — Named towns / cities** (this is the one you missed). The quarterly reports name
specific towns with average premiums: Liverpool (£819), Warrington (£678), Torquay (£477),
Dorchester (£481), Exeter (£484), Llandrindod Wells (£467, cheapest town in UK), Falkirk,
Chelmsford. ([insurance-edge Q2 2025](https://insurance-edge.net/2025/09/17/latest-confused-com-index-says-motor-premiums-are-falling/),
[Q1 2026 report](https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q1-2026/confused-q1-2026-car-price-index-doc.pdf))

**Grain 4 (the hidden one) — Time.** The index "began in 2006" and is published quarterly,
with a [historic archive of every quarterly PDF](https://www.confused.com/-/media/confused/price-index/historic-price-index/).
The Q1 2024, Q1 2025, and Q1 2026 PDFs are all live at predictable URLs. Each quarter is a
*fresh independent measurement* of the same regions/areas.

### Why this reframes your "is testing a bigger undertaking?" question

Your instinct ("the index is so granular, validating against it is a big undertaking") is the
opposite of the truth. The index is **coarser** than your model — it stops at postcode-area /
named-town, while you model at LSOA (4,881 units). You can never get LSOA-level ground truth
from it, and that's *fine and expected* — you already say so in your limitations. What you
*can* do cheaply is **multiply your anchor rows** along two axes you weren't using:

- **Across space:** add the named-town and region rows, not just the 16 postcode areas.
- **Across time:** add the same areas from multiple quarters of the archive.

That turns "16 observations" into "potentially hundreds" without scraping anything — it's all
in published PDFs. See §3 for the concrete plan.

---

## 2. Highest-leverage improvements (do these first)

Ranked by (impact on credibility) ÷ (effort). Each maps to your existing module layout.

### 2.1 ⭐ Pool the price index across quarters → fix the n=16 problem
**Effort: low. Impact: high. This is the single best thing to do next.**

Right now `wtw_anchors.csv` is one snapshot, 16 rows. Instead, transcribe the **same London
postcode areas + regions across the last ~8 quarters** of the [historic archive](https://www.confused.com/-/media/confused/price-index/historic-price-index/).
That gives you a panel: `(postcode_area, quarter) → avg_premium`.

- Add a `quarter` column and a quarter fixed-effect (or just a national-trend control) to the
  OLS in `calibrate.py`. National premiums fell from £995 (Q4 2023) → £711 (Q1 2026)
  ([Q1 2026 report](https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q1-2026/confused-q1-2026-car-price-index-doc.pdf)),
  so you *must* control for the time trend or it'll contaminate the cross-sectional signal.
- This stabilises the betas you currently flag as unstable, and lets you say "validated across
  N quarters of published data" — a much stronger claim than a single snapshot.
- It also gives you a free **time-series feature** for the UX wishlist (year-on-year risk
  change) later.

> Note on rigour: pooling the same areas across quarters is *repeated measures*, not 100 fully
> independent observations. Use clustered standard errors (cluster by postcode_area) so you
> don't overstate significance. statsmodels supports this directly.

### 2.2 ⭐ Add the named-town anchors → more spatial coverage for free
WTW publishes town-level premiums (Liverpool, Warrington, Torquay, Exeter, Falkirk,
Chelmsford, etc.). Map each named town to its postcode district(s), roll your LSOA features up
to that district, and add those as extra calibration rows. This is the bridge to district-grain
validation you flagged as a "maybe" in `project_overview.md §7` — it's actually available now,
just buried in the PDF prose rather than a clean table.

### 2.3 ⭐ Regularised + cross-validated regression
You already identified this. With a pooled panel (2.1) you can do it properly:
- Ridge/Lasso with k-fold CV (`sklearn`), report CV-R² not just in-sample R².
- **Spatial/temporal hold-out:** leave out one postcode area entirely (or one quarter) and
  predict it — this tests generalisation, which in-sample R²=0.91 does *not*. This is the
  "real" test of your model and the answer to "how do I test this?": **predict held-out areas
  you didn't fit on, and report the error.**
- Keep the interpretable OLS alongside for the coefficient story.

### 2.4 Spatial autocorrelation diagnostics (Moran's I)
Adjacent LSOAs are correlated; ignoring it overstates significance. Add a `PySAL/esda`
Moran's I test on `risk_index` residuals, and mention a spatial-lag model as future work.
Cheap to add, signals statistical maturity in a showcase.

### 2.5 Longer crime window + vehicle denominator
- Extend police.uk vehicle-crime from 12 → 36 months (smooths seasonality). data.police.uk
  bulk download supports multi-year, all-force. ([data.police.uk/data](https://data.police.uk/data/))
- Swap population denominator for **licensed vehicles** (DfT VEH0125) where you normalise
  vehicle crime — you already scoped this; it's a more honest exposure base than residents.

---

## 3. New data avenues (grow the feature set)

Each of these is open, joins to LSOA or postcode, and addresses a gap you already listed.

| New feature | Source | Grain | Why it helps | Effort |
|---|---|---|---|---|
| **Uninsured-driver hotspots** | [MIB published hotspots](https://www.mib.org.uk/media-centre/news/2023/november/top-15-areas-for-uninsured-driving-revealed-as-police-launch-week-of-action-to-keep-roads-safe/) | postcode district | Strong direct premium driver; insurers price uninsured-claim risk heavily | Low (small published list) — ask MIB for fuller dataset for more coverage |
| **Car/van availability** | [ONS Census 2021 TS045](https://www.ons.gov.uk/datasets/TS045/editions/2021/versions/1) | LSOA (2021) | Vehicles-per-household = a real exposure denominator and risk signal | Low |
| **Method of travel to work** | [Census 2021 (car/van commute)](https://www.nomisweb.co.uk/datasets/c2021rm001) | LSOA (2021) | Car-commute share proxies mileage/exposure | Low |
| **EV / vehicle age & type mix** | DfT VEH licensing tables | LA / postcode district | Repair-cost and theft-profile differences | Medium |
| **Flood risk** | Environment Agency flood zones | polygon | Weather/flood claim correlation | Medium (spatial join) |
| **Deprivation domains (not just overall)** | IMD 2019 File 7 (already downloaded) | LSOA 2011 | You already have crime/income domains in the file — try them as separate features | Trivial |

**Quick win inside data you already hold:** your `imd.py` already pulls the Income + Crime
domain scores. Test those as standalone predictors instead of only the overall IMD — almost
zero effort, possibly better signal.

**The 2011 → 2021 vintage bridge** unlocks the Census 2021 features above. ONS publishes an
official [LSOA 2011 → LSOA 2021 best-fit lookup](https://www.data.gov.uk/dataset/) (34,753 →
34,628 LSOAs). Use it explicitly (per `AGENTS.md` rule 4) — don't silently mix vintages.

---

## 4. UK-wide expansion — feasibility & how to do it

Short answer: **yes, this is very doable**, and it's the most impressive single direction for a
portfolio piece ("national territory-rating model"). It's mostly a scaling exercise, not new
science, because every source you use is already national.

### Scale reality check
- London = **4,881 LSOAs**. England = **~32,800 LSOAs** (England+Wales ≈ 34,753 at 2011
  vintage). ([ONS statistical geographies](https://www.ons.gov.uk/methodology/geography/ukgeographies/statisticalgeographies))
  So ~7× the rows — `duckdb`/`geopandas` handle this on a laptop fine; the GeoJSON gets big
  (~14MB+), so you'll need vector tiles, not one in-browser blob (see §5).
- All four core sources are already national: police.uk (all forces, bulk download), STATS19
  (GB-wide), IMD 2019 (all England), ONS boundaries/NSPL (UK). The *only* London-specific thing
  in your code is the `region_code = E12000007` filter — making it UK-wide is largely removing
  or parameterising that filter.

### Calibration gets *easier*, not harder, at national scale
This is the payoff. Your anchor coverage is currently 16 London areas. National calibration
unlocks the **full regional table** (~13 regions: South West £499, Inner London £1,149,
West Midlands, Manchester/Merseyside, Scotland splits, Wales, NI...) plus all the named towns.
([insurance-edge regional table](https://insurance-edge.net/2025/09/17/latest-confused-com-index-says-motor-premiums-are-falling/))
The top-to-bottom spread is >£850/yr nationally vs a compressed range within London — **more
variance in the target = a better, more testable regression.** Going UK-wide is partly *how you
solve* the n=16 problem.

### Recommended phased expansion
1. **Phase A — parameterise region.** Make `region_code` a config list. Run for one extra
   region first (e.g. West Midlands) to shake out hardcoded London assumptions.
2. **Phase B — England-wide ingest + features.** Re-run M1–M3 nationally. Watch for: STATS19
   `lsoa_of_accident_location` coverage outside cities; police.uk forces with patchy months.
3. **Phase C — national calibration** on the full regional + town anchor set (now n in the
   dozens-to-hundreds with pooling). This is where your headline number gets genuinely robust.
4. **Phase D — Scotland/Wales/NI** only if wanted: IMD is *separate* per nation (SIMD for
   Scotland, WIMD for Wales, NIMDM for NI) with different methodologies, so the deprivation
   feature isn't directly comparable across borders. Easiest honest scope = **England + Wales**
   first; treat Scotland/NI as a clearly-caveated stretch goal.

### The one real gotcha
Cross-border deprivation comparability (England IMD ≠ Scottish SIMD ≠ Welsh WIMD). Either
percentile-rank deprivation *within each nation* before combining, or scope v2 to England+Wales
and say so. Everything else scales cleanly.

---

## 5. Product / engineering scaling (needed once you go national)

- **Vector tiles instead of one GeoJSON blob.** Your current architecture loads the whole
  GeoJSON into the browser (~2MB gzip for London). At ~33k LSOAs that's ~14MB+ — too big.
  Generate `.pmtiles` (tippecanoe → PMTiles, serves statically, no tile server) and let
  MapLibre stream them. Keeps the snappy client-side feel without the payload.
- **Pre-aggregated roll-up layers** (borough / postcode-district / region) as separate tile
  sets so the map can zoom from national → local without rendering 33k polygons at once. This
  also delivers the "borough toggle" and "compare two areas" features on your wishlist.
- **Postcode typeahead** off the NSPL lookup; **"near me"** via browser geolocation → nearest
  LSOA centroid. Both small, both on your list.

---

## 6. How to test the model — direct answer to your question

You asked: *"unsure how to test this as the WTW/Confused index is so granular — would that be
a bigger undertaking?"* Here's the concrete testing ladder, cheapest first:

1. **Sign & sanity checks (have):** all betas positive, R² reported. Keep.
2. **Hold-out generalisation (do next, ~half a day):** leave out one postcode area / one
   quarter, predict it, report MAE in £. *This* is "testing" — does it predict areas it never
   saw? In-sample R²=0.91 does not answer that.
3. **Temporal back-test (cheap, high-impact):** fit on quarters up to T, predict quarter T+1
   from the archive, compare to published actuals. A clean, defensible validation story.
4. **Cross-grain consistency:** your LSOA scores, rolled up to postcode area, should rank-order
   the WTW postcode-area premiums correctly. Report Spearman rank correlation — robust to the
   fact you can't match absolute £ at LSOA grain.
5. **External convergent validity:** check your high-risk LSOAs against the independent MIB
   uninsured-hotspot list and any Quotezone/other regional figures — agreement from a *different*
   dataset is strong evidence you're not just fitting WTW's quirks.

The granularity mismatch is not a blocker — you validate at the grain the anchor publishes
(area/region/town) and are explicit that LSOA precision is a modelled extrapolation. That
honesty is itself a showcase talking point.

---

## 7. Suggested sequencing

**Sprint 1 (model credibility, ~days):** pool price index across quarters (2.1) + add town
anchors (2.2) + hold-out & temporal back-test (§6.2–6.3) + clustered SEs. → turns n=16 into a
robust panel and gives you a real validation story.

**Sprint 2 (data depth, ~days):** IMD domains quick win + Census 2021 car availability via the
2011→2021 bridge (3) + 36-month crime window + Moran's I (2.4).

**Sprint 3 (UK-wide, ~1–2 weeks):** parameterise region → England+Wales ingest → national
calibration on full regional/town anchors (§4) → PMTiles + roll-up layers (§5).

**Sprint 4 (product polish):** borough/district toggle, compare-two-areas, postcode typeahead,
time-series risk change.

---

## 8. Open questions for you
- **Scope of UK-wide:** England-only, England+Wales, or full UK (accepting the SIMD/WIMD
  caveat)? This decides how much of §4 Phase D you take on.
- **Archive depth for pooling:** how many quarters back are you willing to transcribe? Even
  4–8 quarters transforms the calibration.
- **Form factor priority:** is the next push about *model rigour* (Sprints 1–2) or *reach/scale*
  (Sprint 3)? Both are valuable; pick the one that matches whether you're optimising for an
  interview talking point (rigour) or a "wow" demo (national map).

---

*Sources: Confused.com / WTW Car Insurance Price Index reports and historic archive; ONS Open
Geography & Census 2021; data.police.uk; MIB; DfT STATS19 & VEH licensing — all linked inline
above. Contains public sector information licensed under the Open Government Licence v3.0.*
