# M5.x — Visual & Informational Polish (Plan)

Planner notes for the coding agent. **Scope: the map/UI and how informative it is. Model work is
deferred.** No architectural changes — keep the data contract from `M5_CHANGES.md`. Anything marked
**(client-side)** needs no backend work, because the loaded GeoJSON is already the client-side data store.

---

## 0. Fix first — the "Filter map by" control

**Rename** the "Colour map by" control to **"Filter map by"**.

**The bug (flat single colour on every option except Risk).**
The composite view colours by `quintile` (which is in the GeoJSON, so it works). Each driver view colours by
that component's **percentile** property — `vehicle_crime_pct`, `road_casualties_pct`, `deprivation_pct`,
`population_density_pct`. They render as one flat block because **those `*_pct` fields aren't present in the
served GeoJSON**, so the colour expression falls back to 0 for every feature.

**Remediation (no new code — pipeline + verification):**
1. Confirm the updated `build_risk_index.py` (the one that bakes `{c}_val/_pct/_contrib`) is the version on
   disk.
2. Regenerate the data: `make features → risk → calibrate → risk`.
3. Verify in the browser devtools (Network → `/api/geojson`) that a feature's `properties` now contains the
   four `*_pct` fields. If they're there, the driver views will colour correctly with no frontend change.

**Then make the whole UI filter-aware** (this is the real feature, and what you asked for — visuals and
tooltips should follow the active filter):
- **Legend** reflects the active metric: its title shows the metric name; for a driver it shows a percentile
  scale (0–100th), for composite it shows the quintile scale. (See §1 legend redesign.)
- **Tooltip** shows the active metric for that area (value + percentile), *plus* the composite risk score for
  context. Use the baked `lsoa_name` as the tooltip heading, not the bare code.
- **On-map indicator**: a small persistent label (e.g. top-left of the map) — "Showing: Vehicle crime
  (percentile)" — so users don't forget the map is no longer composite risk.
- **Detail panel**: highlight/emphasise the row matching the active filter so the panel and map agree.
- **Transition**: animate the fill-colour change when the filter switches (feels intentional, not jarring).

**Acceptance:** every filter shows a real gradient; the legend, tooltip, on-map label, and detail panel all
update together when the filter changes; "Filter map by" is the control's label.

---

## 1. Quick wins — high value, low effort (P1)

**Legend as the informative centrepiece (client-side).** Right now it's a bare ramp. Make it a precise graded
scale: show the actual value/percentile breakpoints for each colour step, the active metric's name and units,
and a distinct **"no data"** swatch. This single element does a lot of the "looks good + informative" work.
```
Composite risk (quintile)            Vehicle crime (percentile)
[#] 0–20   lowest                    [gradient 0 ────────── 100]
[#] 20–40                            0th               100th pct
...                                  ▥ no data
[#] 80–100 highest
▥ no data
```

**Distribution context for the selected area (client-side).** The GeoJSON already holds every area's
score, so you can compute, with no backend, where the selected area sits in the London-wide distribution.
Show a one-line plain-language statement — *"Higher risk than 92% of London areas"* — and a small sparkline
of the distribution with a marker on this area. Do the same for the active filter metric. This turns a bare
number into meaning and is the strongest single "informative" upgrade.

**Deep-linkable URLs (client-side).** Encode the selected area and active filter in the query string, e.g.
`?area=<lsoa11cd>&filter=vehicle_crime`. On load, restore state (fly + select + set filter). No router
needed — read/write `URLSearchParams` via the history API. Makes views shareable and bookmarkable; great for
a portfolio link ("the riskiest area in London →").

**Honest no-data handling (small contract addition).** Areas missing a component (e.g. density) should render
in a distinct "no data" style (light hatch or neutral grey), and the tooltip/panel should say "no data" — not
imply 0. Convention: missing values stay `null` in the GeoJSON and map to the no-data category everywhere.

**Micro-polish (client-side).**
- Consistent number formatting everywhere (currency via the shared formatter, tabular numerals for all figures).
- A loading **skeleton** for the map while the (large) GeoJSON streams, instead of just a spinner.
- Smooth fly-to + colour transitions; respect `prefers-reduced-motion` (already in place).
- Focus management: when flying to an area, move keyboard focus to its detail panel.

**"About the data" + driver definitions (mostly content).** A short, collapsible panel: one plain-language
sentence per driver and its source (vehicle crime → police.uk; collisions → DfT STATS19; deprivation → IMD
2019; density → ONS), plus the "proxy not a quote" framing. Builds trust and informs — and it's interview-ready.

---

## 2. Bigger informative features (P2)

**Compare two areas (client-side).** Let the user pin area A and area B (by search or click) and show their
risk + driver breakdowns side by side, with a one-line "B is riskier, mainly driven by vehicle crime." Both
areas' data is already in the lookup, so this is UI-only. High value for "informative."

**Borough aggregation + borough rankings.** A coarser lens that matches how people think ("Hackney is high").
Add a toggle: view/rank by **borough (LAD)** as well as LSOA. *Confirm first:* does the risk Parquet carry a
borough/LAD code per LSOA? If not, it's a small ingest add (ONSPD already has LSOA→LAD). Borough is the right
coarser unit because every LSOA nests cleanly in exactly one LAD (postcode districts don't, so avoid those
for aggregation).

**Postcode typeahead (needs a small endpoint — spec only).** As the user types, suggest matching postcodes.
Spec: `GET /api/postcodes/suggest?q=<prefix>&limit=8` over the existing indexed lookup. Add a "near me" option
(browser geolocation → nearest LSOA) for a nice touch.

**Methodology / calibration view.** A dedicated panel or route that surfaces the model story: the R² (0.909),
a **model-vs-market scatter** (calibrated premium vs the WTW anchor per postcode area), the weights, and the
data provenance. This is both informative and the most portfolio-valuable screen in the app. May need a small
`/api/calibration` payload from the M4 outputs.

**Rankings upgrades (client-side).** Tag each ranked area with its **dominant driver** (the largest
`*_contrib`) — e.g. a small "crime-driven" chip. Add a borough filter once the borough code exists, and a
"riskiest boroughs" toggle.

---

## 3. Stretch (P3)
- Pin/multi-select more than two areas to compare.
- Optional dark base-map style toggle (positron stays default; dark can make the ramp pop for demos).
- A short page-load moment that highlights the top-N riskiest areas before settling — orient the user.
- Full keyboard navigation across map, rankings, and legend.

---

## Visual direction (the "look good" part)

Keep the current light/positron direction — it lets the data be the hero, which is right for a risk map. Spend
the polish here, not on a reskin:
- **The legend and the driver-breakdown bars are the signature** — make them precise and beautiful (real
  breakpoints, clean alignment, tabular numbers). That's where the product earns trust.
- **Type hierarchy**: one clear scale; headings, labels, and data values clearly differentiated; numbers
  always tabular.
- **One restrained accent** for interactive chrome; let the YlOrRd ramp be the only "loud" colour, and only on
  the map.
- **Motion is quiet and purposeful** — fly-to, colour transitions, hover; nothing gratuitous.
- **No-data styling** is part of the design, not an afterthought.
- **Accessibility floor**: visible keyboard focus, colour never the only signal (always pair with the number),
  reduced-motion respected. Optional: the YlOrRd ramp is borderline at the extremes for some colour-blind
  users — worth a quick check against a colour-blind-safe sequential, but keep YlOrRd if you prefer its
  readability.

---

## To confirm (so I can sharpen later passes — non-blocking)
1. Does the risk Parquet/GeoJSON carry a **borough/LAD code** per LSOA? (Decides whether borough features are
   "free" or a small ingest add.)
2. Are the v2 frontend files applied **as-is**, or has the agent diverged? (Affects how I phrase later specs.)
3. Is there a **router** in the app, or should deep-linking use plain `URLSearchParams`?

---

## Suggested sequence
**§0 (fix + filter-aware UI) → P1 quick wins → P2 features → P3.** Do §0 and the legend redesign together —
they share the same "make the UI follow the active metric" work and give the biggest immediate lift.
