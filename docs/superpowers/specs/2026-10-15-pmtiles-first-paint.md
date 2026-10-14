# PMTiles first paint: what the tiles carry, and how to draw them first

R-14 of the holiday queue (`HOLIDAY.md`). The check half of "streaming first paint":
read the committed `frontend/public/data/lsoa-risk.pmtiles`, compare it with what the
map's fill and popup need, and design R-15. No code or data file changes with this spec.

## How it was read

The archive was read in the cloud on 14 October 2026 with the `pmtiles` JS library
(`getHeader()`, `getMetadata()`, `getZxy()`), and tiles were decoded with
`@mapbox/vector-tile` + `pbf`. The throwaway script lived in the session scratchpad, not
in the repo (it needs two libraries the frontend does not depend on). Tile sizes below are
the decoded tile bytes; "gzipped" re-compresses them with Node's `zlib`, which is roughly
what the archive stores (`tileCompression` = gzip) and what crosses the wire.
`src/showcase/bake_tiles.py` was read for the tippecanoe flags.

## What the archive is

| | |
|---|---|
| File | `frontend/public/data/lsoa-risk.pmtiles`, 43.9 MB |
| Baked by | `make showcase-tiles` → `src/showcase/bake_tiles.py` (tippecanoe, from the already-baked `areas.geojson`) |
| Layer | `lsoa` (one vector layer) |
| Zoom range | 4 to 12 (header `minZoom` 4, `maxZoom` 12) |
| Tile type / compression | MVT, gzip (internal directories gzip too) |
| Bounds | −8.65, 49.87 to 1.76, 60.85 (GB) |
| Tiles | 11,333 addressed, 11,276 entries |
| tippecanoe flags | `--layer=lsoa --minimum-zoom=4 --maximum-zoom=12 --coalesce-densest-as-needed --extend-zooms-if-still-dropping --simplification=10`, no `-x`/`-y` |
| Served | GitHub Pages answers range requests on the live file (`curl -r 0-126` → `206`, `accept-ranges: bytes`, `access-control-allow-origin: *`), which is what a `pmtiles://` source needs |

## Attributes against what the map needs

Every one of the 26 `areas.geojson` properties is a field of the `lsoa` layer
(`vector_layers[0].fields`), so nothing is missing:

`lsoa11cd`, `lsoa_name`, `quintile`, `risk_index`, `calibrated_premium`, `premium_low`,
`premium_high`, `premium_baseline`, `premium_place_only`, the `*_pct` for every layer
(`vehicle_crime`, `imd_crime`, `aadf_intensity`, `young_driver_share`,
`cars_per_household`, `deprivation`, `imd_income`, `flood_risk`, `road_casualties`,
`population_density`, `traffic_per_capita`, `ksi_collisions_per_billion_vehicle_miles`),
and the five `*_contrib`.

| Map need | Fields | In the tiles |
|---|---|---|
| Base fill (premium quintile) | `quintile` (`MapView.tsx` `fillColor('composite')`) | yes, never null |
| Colour modes (`?filter=`) | `<mode>_pct` | yes, all twelve |
| Hover popup | `lsoa11cd`, `lsoa_name`, `quintile`, `calibrated_premium`, the mode's `*_pct` | yes |
| Tap card | `lsoa11cd`, `lsoa_name`, `quintile`, `calibrated_premium` | yes |
| Selection / compare outlines | `lsoa11cd` | yes |
| Detail panel waterfall | `premium_baseline`, `*_contrib` | yes (but the panel reads the GeoJSON lookup, see design) |

`young_driver_share_pct` and `cars_per_household_pct` are null on some tile features. They
are null in `areas.geojson` too: 1,110 of 41,729 areas lack them (1,034 in England, 72 in
Wales, 4 in Scotland). The map already draws those as "no data", so this is not a tile defect.

## The real catch: low zooms drop areas

`--coalesce-densest-as-needed` keeps every tile under tippecanoe's size limit by merging
or dropping features where the tile is too dense. Each kept feature keeps a single area's
attributes. These are sampled tiles, comparing the features in each tile with the
`areas.geojson` areas whose first vertex falls inside it:

| Tile | Features (distinct `lsoa11cd`) | Areas starting in the tile |
|---|---|---|
| South England z4 7/5 | 5,754 | 31,034 |
| South England z5 15/10 | 6,333 | 31,034 |
| London z6 31/21 | 5,531 | 15,573 |
| London z7 63/42 | 5,474 | 12,559 |
| London z8 127/85 | 5,556 | 6,440 |
| London z9 255/170 | 4,591 | 4,259 |
| Glasgow z6 31/19 | 1,525 | 5,678 |
| Glasgow z8 124/79 | 1,098 | 1,348 |
| Cardiff z7 62/42 | 1,415 | 1,903 |

From z9 every area is present, and the feature count exceeds the "starting in tile" count
because polygons cross tile edges. At z4 to z8, dense areas (London, the big cities) are
represented by a fraction of their areas. Each kept polygon covers ground that, in the
GeoJSON, belongs to several areas, and it is coloured by one of them. So:

- **As a first paint at national zoom, the tiles are good enough.** The colours are real
  baked quintiles, rural and suburban areas are near-complete, and the city cores read as
  the right band of colour. The map opens at zoom 5.2 (`MapView.tsx` `initialViewState`).
- **As something to hover, tap or select at z4 to z8, they are not.** A tap could land on
  a merged polygon and name an area the visitor did not tap. So the tile layer must not be
  interactive below z9, or interaction must keep coming from the GeoJSON layer, as it does today.

## Tile sizes

Over the GB bounds:

| Zoom | Tiles | Decoded | ~Gzipped | Largest tile ~gzipped |
|---|---|---|---|---|
| 4 | 3 | 1.2 MB | 0.60 MB | 394 kB |
| 5 | 3 | 1.3 MB | 0.65 MB | 433 kB |
| 6 | 10 | 2.2 MB | 1.17 MB | 426 kB |
| 7 | 24 | 3.2 MB | 1.76 MB | 413 kB |
| 8 | 65 | 6.8 MB | 3.70 MB | 401 kB |
| 12 (sampled) | — | 25–52 kB | — | — |

The opening view needs the z5 tiles, about 0.65 MB gzipped plus the header and root
directory (a few kB), against the ~8 MB gzipped `areas.geojson` it waits for today
(`HOLIDAY.md`). The biggest single tiles (~0.4 MB) are the South-of-England ones, so the
first colour lands after roughly one ~0.4 MB fetch on a phone.

## Verdict

**The tiles suffice for the base fill and every colour mode at first paint.** R-15 is a
cloud package, not a `needs-mac` re-bake. No `make showcase-tiles` change is needed for
it. The low-zoom coalescing limits interaction, not colour, and the design keeps
interaction on the GeoJSON.

## Design for R-15

1. **Dependency.** Add `pmtiles` (npm, 4.x, ~20 kB) as a runtime dependency (R-14's
   ruling, default yes). Register the protocol once at module load in `MapView.tsx`:
   `maplibregl.addProtocol('pmtiles', new Protocol().tile)`.
2. **Source and layers.** Add a vector source `lsoa-tiles` with
   `url: 'pmtiles://' + dataUrl('lsoa-risk.pmtiles')` and `promoteId: 'lsoa11cd'`. Draw
   a fill `lsoa-tiles-fill` (source-layer `lsoa`) with the same `fillColor(colorMode)`
   expression (it reads only `quintile` / `*_pct`, all present), plus a hairline layer.
   Mount them from the first render, before the GeoJSON has loaded.
3. **Swap when the GeoJSON is drawn.** Keep today's GeoJSON `Source` and its layers
   unchanged. When `areasDrawn` turns true (the existing `onSourceData` signal), hide the
   tile layers (`visibility: none`), or keep them under the GeoJSON fill, which covers
   them exactly. The end state is then identical to today: the panel, rankings, hover,
   tap card, selection and compare outlines and `?filter=` all keep reading the GeoJSON
   and its lookup.
4. **Interaction before the swap.** Leave `interactiveLayerIds` on the GeoJSON layer only,
   so nothing is hoverable or tappable on the coarse tiles. The R-8 readouts ("Loading map
   data…", "Drawing…") keep showing until the GeoJSON is drawn, so the visitor knows
   details are still coming. Optional later: make `lsoa-tiles-fill` interactive at
   `minzoom: 9` only, where every area is present.
5. **Light/dark.** The basemap switch reloads the style (R-6). The tile source and layers
   are declared as `react-map-gl` children like the GeoJSON ones, so they are re-added
   with it. `areasDrawn` is tracked per basemap, so the tiles show again until the GeoJSON
   re-tiles.
6. **Colour modes before the GeoJSON arrives.** Every `*_pct` is in the tiles, so no colour
   mode has to wait. A `?filter=` link colours from the tiles straight away.
7. **Measure.** Measure first-colour time before and after in headless Chromium, the way
   R-8 measured the panel. "First colour" means the first `sourcedata` with
   `isSourceLoaded` for `lsoa-tiles`, against today's first for `lsoa`. Use `vite preview`
   of the Pages build with network throttling to a phone profile.
8. **Tests.** Test any pure helper R-15 adds (say, a `tileLayerVisibility(areasDrawn)` or
   the source URL builder). The fill expression is shared, so it needs no new test.

Rulings for R-15: none beyond R-14's (`pmtiles` as a runtime dependency, default yes).
