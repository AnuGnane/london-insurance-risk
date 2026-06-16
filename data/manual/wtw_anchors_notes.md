# WTW / Confused.com Car Insurance Price Index — Anchor Panel Notes

## Summary statistics

| Metric | Value |
|---|---|
| Total rows | 137 |
| Distinct area names | 44 |
| Quarters covered | 2023-Q3, 2024-Q1 through 2025-Q4, 2026-Q1 (10 quarters) |
| Grain: region | 89 rows |
| Grain: postcode_area | 17 rows |
| Grain: town | 22 rows |
| Grain: national (UK) | 9 rows |
| Source: confused_pdf | 28 rows |
| Source: press | 109 rows |

---

## Quarters covered and row counts

| Quarter | Rows | Notes |
|---|---|---|
| 2023-Q3 | 5 | Historical figures from Q3 2024 comparison table (insurance-edge.net) |
| 2024-Q1 | 10 | insurance-edge.net April 2024 article + confused.com PDF |
| 2024-Q2 | 14 | actuarialpost.co.uk + confused.com Q2 2024 PDF + Q2 2025 comparison columns |
| 2024-Q3 | 16 | insurance-edge.net October 2024 article + confused.com press release |
| 2024-Q4 | 12 | confused.com Q4 2024 PDF (local file) + insurancebusinessmag.com + claimsmag.co.uk |
| 2025-Q1 | 9 | confused.com Q1 2025 PDF (local file) + insurancebusinessmag.com |
| 2025-Q2 | 14 | confused.com Q2 2025 PDF (local file) + insurance-edge.net June 2025 article |
| 2025-Q3 | 19 | confused.com Q3 2025 PDF + insurance-edge.net September 2025 article |
| 2025-Q4 | 14 | claimsmag.co.uk January 2026 article (November 2025 data) |
| 2026-Q1 | 24 | confused.com Q1 2026 PDF (local file) + live confused.com regional page |

---

## Source URLs

### Primary PDFs (local files parsed with pdfplumber)

- **Q4 2024** (local filename `q1-2024.pdf` — note: the filename is misleading; content is Q4 2024):
  `https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q4-2024/price-index-doc-q12024v2.pdf`
- **Q1 2025**: `https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q1-2025/price-index-doc-q12025.pdf`
- **Q2 2025**: `https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q2-2025/price-index-q2-2025.pdf`
- **Q1 2026**: `https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q1-2026/confused-q1-2026-car-price-index-doc.pdf`
- **Q2 2024** (downloaded during task): `https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q2-2024/q2-2024-car-price-index-report.pdf`
- **Q3 2025** (fetched during task): `https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q3-2025/q3-2025-car-price-index-report.pdf`
- **Q1 2024** (fetched during task): `https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q1-2024/price-index-doc-q12024.pdf`

### Press sources

- **insurance-edge.net Q1 2024**: `https://insurance-edge.net/2024/04/18/rate-of-car-insurance-premium-inflation-is-falling-says-confused-com/`
- **actuarialpost.co.uk Q2 2024**: `https://www.actuarialpost.co.uk/article/car-insurance-premiums-downward-trend-continues-23693.htm`
- **confused.com Q3 2024 press release**: `https://www.confused.com/press/releases/2024/q3-2024-price-index`
- **insurance-edge.net Q3 2024**: `https://insurance-edge.net/2024/10/14/car-premiums-soften-slightly-says-confused-com-data/`
- **insurancebusinessmag.com Q4 2024**: `https://www.insurancebusinessmag.com/uk/news/auto-motor/uk-car-insurance-costs-plunge--biggest-drop-in-a-decade-520607.aspx`
- **Mondaq Q4 2024**: `https://www.mondaq.com/uk/insurance-laws-and-products/1580384/confusedcom-car-insurance-price-index-q4-2024`
- **insurancebusinessmag.com Q1 2025**: `https://www.insurancebusinessmag.com/uk/news/auto-motor/uk-car-insurance-premiums-post-highest-annual-fall-since-2014-529519.aspx`
- **insurance-edge.net Q2 2025**: `https://insurance-edge.net/2025/06/20/latest-car-premiums-info-from-wtw-confused-com/`
- **insurancebusinessmag.com Q2 2025**: `https://www.insurancebusinessmag.com/uk/news/auto-motor/uk-car-insurance-premiums-tumble-539716.aspx`
- **insurance-edge.net Q3 2025**: `https://insurance-edge.net/2025/09/17/latest-confused-com-index-says-motor-premiums-are-falling/`
- **claimsmag.co.uk Q4 2025**: `https://claimsmag.co.uk/2026/01/uk-car-insurance-premiums-continue-to-slide-with-13-annual-fall/`
- **Live confused.com regional page (Q1 2026)**: `https://www.confused.com/compare-car-insurance/average-car-insurance-cost-uk`

---

## Coverage gaps

### Missing quarters for key regions
- **Leeds / Sheffield**: Missing Q1 2024, Q1 2025, Q3 2025, Q4 2025 (only 5 quarters of 10 total)
- **Outer London**: Missing Q1 2024, Q1 2026 (labeled as `London - Outer` in 2026-Q1 live page — likely the same geography but different naming)
- **West Midlands**: Missing 2026-Q1 (the 2026-Q1 live page uses `Midlands - West` £859, which may correspond; see ambiguity note below)
- **North West**: Only 4 quarters (Q2 2024, Q3 2024, Q3 2025, Q1 2026)
- **Central Scotland**: Only 3 quarters (Q1 2024, Q2 2024, Q1 2026)
- **Scottish Borders**: Only 3 quarters (Q4 2024, Q3 2025, Q1 2026)

### Missing Q3 2024 for some regions
The Q3 2024 full press table (5 most expensive regions) covers Inner London, Outer London, West Midlands, Manchester/Merseyside, Leeds/Sheffield and South West — but does not include Northern Ireland full-table figure for Q3 2024. The Northern Ireland Q3 2024 figure (£929) comes from the Q3 2025 insurance-edge comparison column.

### No Q2 2024 regional data for Outer London
The Outer London figure for Q2 2024 (£1,168) comes from the Q2 2025 insurance-edge comparison table's "2024-May" column, not from the official Q2 2024 report.

### 2025-Q1 missing Leeds/Sheffield
No published figure for Leeds/Sheffield in Q1 2025 was found in any source.

---

## Area name ambiguities and postcode mappings

| area_name (in CSV) | Notes on ambiguity | postcode_area used |
|---|---|---|
| `West Central London` | Postcode area WC — explicitly labeled as the highest-cost postcode area in the UK by WTW | WC |
| `Central London` | Q1 2024 only — labeled "Central London" in insurance-edge; likely EC (City/East Central) postcode area | EC |
| `North West London` | Q1 2024 only — labeled "North West London" in insurance-edge; postcode area NW | NW |
| `London City` | Q3 2024 — from confused.com press release, described as biggest drop; likely EC postcode area | EC |
| `South West London` | Q1 2025 — from insurancebusinessmag; postcode area SW | SW |
| `London - Outer` | 2026-Q1 from live page; may be same as `Outer London` used in other quarters — kept separate as published | (blank) |
| `Midlands - West` | 2026-Q1 from live page (£859); may correspond to `West Midlands` in earlier quarters | (blank) |
| `Leeds and Sheffield` | Used in Q3 2025 PDF; normalized to `Leeds / Sheffield` for consistency | (blank) |
| `Llandrindod Wells` | Rural Wales town; postcode area LD | LD |
| `Liverpool` | Labeled as "Manchester/Merseyside postcode area of Liverpool" in Q3 2025 insurance-edge; postcode area L | L |
| `Warrington` | Labeled as "Manchester/Merseyside postcode area" in Q3 2025 insurance-edge; postcode area WA | WA |
| `Bolton` | Manchester/Merseyside sub-area; postcode area BL | BL |
| `Exeter` | South West town; postcode area EX | EX |
| `Torquay` | South West town; postcode area TQ | TQ |
| `Dorchester` | South West town; postcode area DT | DT |
| `Truro` | South West town; postcode area TR | TR |
| `Perth` | Scottish town; postcode area PH | PH |
| `Isle of Man` | Not a postcode area — Crown Dependency; postcode IM | IM |
| `Wigan` | Greater Manchester town; postcode area WN | WN |
| `Oldham` | Greater Manchester town; postcode area OL | OL |
| `Falkirk` | Mentioned in Q1 2026 PDF as having premium rises (£33 increase in past 3 months) — but no absolute value published | FK |
| `Chelmsford` | Mentioned in Q1 2026 PDF as having premium rises (£16 increase in past 3 months) — but no absolute value published | CM |

**Note**: Falkirk and Chelmsford are referenced in the Q1 2026 PDF only with quarterly *changes* (not absolute premiums), so they are excluded from the panel per the no-invented-figures constraint.

---

## Key file note
The local file `/home/user/workspace/wtw_pdfs/q1-2024.pdf` contains the **Q4 2024** report (its internal title reads "Q4 2024"). The filename appears to have been mislabeled when downloaded. The actual Q1 2024 PDF was separately fetched from:
`https://www.confused.com/-/media/confused/price-index/historic-price-index/price-index-q1-2024/price-index-doc-q12024.pdf`

---

## Timing note for press comparison tables
Several insurance-edge.net articles report a "comparison table" showing "2024-May" vs "2025-May" (or "2024-August" vs "2025-August"). These mid-quarter snapshots were assigned to the nearest calendar quarter:
- "2024-May" → 2024-Q2
- "2024-August" → 2024-Q3
- "2024-November" → 2024-Q4
- "2025-May" → 2025-Q2
- "2025-August" → 2025-Q3
- "2025-November" → 2025-Q4

This means some quarterly entries may reflect a specific month rather than a true quarterly average. Official PDF values are preferred where available; press-sourced figures fill gaps.

---

## Scottish region definitions (Phase 2)

The four Confused/WTW Scottish regions in the panel (`Central Scotland`,
`East & North East Scotland`, `Highlands & Islands`, `Scottish Borders`) are now
matched to the model (see `REGION_POSTCODE_AREAS` in `calibrate.py`). Confused
does **not** publish the postcode-area composition of its regions, but the
postcode geography of Scotland is fact, so each Scottish postcode area is
assigned to exactly one region by standard geography (a clean partition — every
Scottish postcode area used once, none shared; CA/Carlisle is an English area and
excluded):

| Region | Postcode areas | Rationale |
|---|---|---|
| Central Scotland | G, ML, PA, KA, FK | Greater Glasgow + central belt |
| East & North East Scotland | EH, KY, DD, AB, PH | Edinburgh, Fife, Tayside, Aberdeen, Perth |
| Highlands & Islands | IV, KW, ZE, HS | Inverness, Orkney, Shetland, Western Isles |
| Scottish Borders | TD, DG | Borders + Dumfries & Galloway (southern Scotland) |

These rows validate **place-only** (Scotland's demographic composition controls
are deferred — held at the national mean): the figures are published premiums and
the place features (crime via statistics.gov.scot, SIMD deprivation, density) are
all present. Fit is good — Scottish anchors' mean abs error (~£39) is below the
overall panel (~£73). Borders/Highlands are near-exact; Central Scotland is mildly
over-predicted (~£75).

**Ambiguous assignments** (documented, low-impact at percentile basis): `PH`
(Perth) is east-central — grouped with the east/NE; `PA` (Paisley) includes some
Clyde islands but is centred on the mainland central belt; `DG` (Dumfries) is
south-west — grouped with Borders as "southern Scotland".

## The `source` column

The panel now carries a brand-level `source` column (distinct from `source_type`,
which is press/pdf provenance). All current rows are `confused` (Confused.com/WTW
Price Index). When a second anchor brand (e.g. MoneySuperMarket/ABI) is added, it
gets its own `source` value and the calibration adds a per-source fixed effect
(`C(source)` in the OLS) to absorb methodology-level differences — comparing the
*spatial pattern* across sources, not absolute levels. No second source has been
transcribed yet (it requires real published figures — see the no-invented-figures
rule below).

## Data integrity
- All figures are explicitly published in the cited sources.
- No figures were estimated, interpolated, or inferred from percentage changes.
- Where the same (area, quarter) appeared in multiple sources with different values, the official Confused.com PDF was preferred; otherwise the first-encountered press source was retained.
