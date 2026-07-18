# Phase 4 Flood Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 4 — populate `flood_risk` (share of each area in a High/Medium flood zone) for all three nations, then let the calibration evidence gate decide whether it is a premium driver or a map diagnostic.

**Architecture:** Scotland (SEPA ArcGIS REST) and Wales (NRW/DataMapWales WFS) are fetched automatically into `data/raw/flood/<nation>/` as GeoParquet; England has no scriptable full-extent endpoint (the old EA ArcGIS service is dead, mid-NaFRA2 migration) so it stays a documented manual drop-in via the Defra DSP download UI. The existing `flood.py` scaffold is fixed (three latent bugs: band-filter-after-geometry-strip, zero-fill for missing nations, overlap double-count), extended to per-nation processing, and `build_risk_index` gains within-nation percentile ranking for `flood_risk` (three regulators, incomparable bandings — SEPA Medium = 1-in-200 vs EA Medium = 1-in-100).

**Tech Stack:** Python 3.11, geopandas/shapely 2 (EPSG:27700 for all area maths), existing `src/common/http.py` retry helpers, pytest, React/TypeScript frontend (mode lists only).

**Verified endpoints (2026-07-15):**
- SEPA ArcGIS REST: `https://map.sepa.org.uk/server/rest/services/Open/{River,Coastal}_Flooding_{High,Medium}_Likelihood/FeatureServer` (Esri JSON, maxRecordCount 2000, layer id varies per service — discovered at runtime; River Medium is id 1). OGL v3.0.
- NRW WFS (GeoServer): `https://datamap.gov.wales/geoserver/ows`, layer group `inspire-nrw:FloodRiskAssessmentWales`; expected layers `inspire-nrw:NRW_FLOOD_RISK_FROM_RIVERS` and `inspire-nrw:NRW_FLOOD_RISK_FROM_SEA` (verify in Task 5 — FRAW *replaced* RoFRS in Wales; bands High/Medium/Low). OGL.
- England: `https://environment.data.gov.uk/explore/96ab4342-82c1-4095-87f1-0082e8d84ef1?download=true` (interactive area-of-interest download; dataset revised 2026-06-18, NaFRA2-based). The 2020 `EA/RiskOfFloodingFromRiversAndSea/MapServer` returns HTTP 500 — do not use. OGL v3.0.

**Sequencing constraint:** `flood_risk` must NOT be activated in `features.place` until `data/interim/flood.parquet` covers **all three** nations — a place feature that is NaN for a nation drops that nation's anchor rows from the calibration panel (`src/calibrate/calibrate.py:247`). Tasks 1–6 are unconditional; Task 7 runs the fetches; Tasks 8–9 are conditional on full coverage.

---

### Task 1: Shared Esri geometry helpers (`src/common/esri.py`)

`boundaries.py` vendors an Esri-rings→shapely converter privately; the SEPA fetch needs the same conversion plus paged *geometry* queries (`src/common/http.py:fetch_arcgis_attributes` deliberately excludes geometry). Move the converter to `src/common/esri.py` and add a paged polygon fetch.

**Files:**
- Create: `src/common/esri.py`
- Create: `tests/test_esri.py`
- Modify: `src/ingest/boundaries.py:215-246` (remove `_ring_is_clockwise` + `_esri_rings_to_geom`, import instead)

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_esri.py
"""Tests for the shared Esri JSON geometry helpers."""
import geopandas as gpd

from src.common.esri import esri_features_to_gdf, esri_rings_to_geom

# Esri convention: clockwise = exterior, counter-clockwise = hole.
SQUARE_CW = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]
HOLE_CCW = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]


def test_esri_rings_to_geom_square_with_hole():
    geom = esri_rings_to_geom([SQUARE_CW, HOLE_CCW])
    assert abs(geom.area - (100 - 36)) < 1e-9


def test_esri_features_to_gdf_reads_pages_and_crs():
    page = {
        "spatialReference": {"wkid": 27700},
        "features": [
            {"geometry": {"rings": [SQUARE_CW]}},
            {"geometry": {"rings": []}},          # empty geometry → skipped
            {"attributes": {"x": 1}},              # no geometry → skipped
        ],
    }
    gdf = esri_features_to_gdf([page, page])
    assert isinstance(gdf, gpd.GeoDataFrame)
    assert len(gdf) == 2                            # one polygon per page
    assert gdf.crs.to_epsg() == 27700
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_esri.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.common.esri'`

- [ ] **Step 3: Create `src/common/esri.py`**

Move the two functions from `boundaries.py` **verbatim** (drop the leading underscore on `esri_rings_to_geom`; `_ring_is_clockwise` stays private) and add the page helpers:

```python
"""Shared Esri JSON geometry helpers.

`esri_rings_to_geom` is the arcgis2geojson winding-order algorithm vendored to
avoid an extra dependency (moved here from src/ingest/boundaries.py so flood.py
can reuse it). `fetch_arcgis_polygons` is the geometry-carrying sibling of
src/common/http.py:fetch_arcgis_attributes.
"""
from __future__ import annotations

import logging
import time

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon

from src.common.http import get_json_with_retry

log = logging.getLogger(__name__)


def _ring_is_clockwise(ring: list[list[float]]) -> bool:
    """Esri convention: clockwise rings are exteriors, counter-clockwise are holes."""
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += (x2 - x1) * (y2 + y1)
    return s > 0


def esri_rings_to_geom(rings: list[list[list[float]]]):
    """Convert an Esri polygon ``rings`` array to a shapely (Multi)Polygon.

    Esri packs all exterior rings and holes into one flat list; we split by
    winding order and assign each hole to the exterior that contains it. This is
    what arcgis2geojson does — vendored here to avoid an extra dependency and
    because the gov.scot geojson endpoint mis-serialises multi-island zones.
    """
    exteriors = [r for r in rings if len(r) >= 4 and _ring_is_clockwise(r)]
    holes = [r for r in rings if len(r) >= 4 and not _ring_is_clockwise(r)]
    if not exteriors:  # all CCW — treat each as its own polygon
        exteriors, holes = rings, []

    ext_polys = [Polygon(r) for r in exteriors]
    hole_assignment: list[list] = [[] for _ in ext_polys]
    for h in holes:
        rep = Polygon(h).representative_point()
        for i, ext in enumerate(ext_polys):
            if ext.contains(rep):
                hole_assignment[i].append(h)
                break

    polys = [Polygon(ext, hl) for ext, hl in zip(exteriors, hole_assignment)]
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def esri_features_to_gdf(pages: list[dict]) -> gpd.GeoDataFrame:
    """Esri JSON query pages → GeoDataFrame of polygons (pure).

    Features without polygon rings are skipped. CRS comes from the first page's
    spatialReference (defaults to EPSG:27700, this project's working CRS).
    """
    geoms = [
        esri_rings_to_geom(feat["geometry"]["rings"])
        for page in pages
        for feat in page.get("features", [])
        if feat.get("geometry", {}).get("rings")
    ]
    wkid = (pages[0].get("spatialReference") or {}).get("wkid", 27700) if pages else 27700
    return gpd.GeoDataFrame(geometry=geoms, crs=f"EPSG:{wkid}")


def fetch_arcgis_polygons(query_url: str, *, page_size: int = 2000) -> gpd.GeoDataFrame:
    """Page through an ArcGIS query endpoint returning polygon geometry.

    ``page_size`` must be <= the endpoint's maxRecordCount, or a capped first
    page looks like the final page (same caveat as fetch_arcgis_attributes).
    """
    pages, offset = [], 0
    while True:
        page = get_json_with_retry(query_url, {
            "where": "1=1", "outFields": "", "returnGeometry": "true",
            "outSR": 27700, "f": "json",
            "resultOffset": offset, "resultRecordCount": page_size,
        })
        n = len(page.get("features", []))
        if n:
            pages.append(page)
        offset += n
        if n < page_size and not page.get("exceededTransferLimit"):
            break
        time.sleep(0.3)
    return esri_features_to_gdf(pages)
```

- [ ] **Step 4: Re-point `boundaries.py`**

In `src/ingest/boundaries.py`: delete `_ring_is_clockwise` and `_esri_rings_to_geom` (lines 215–246), add `from src.common.esri import esri_rings_to_geom` to the imports, and change the single call site (line ~277) from `_esri_rings_to_geom(...)` to `esri_rings_to_geom(...)`. Remove `Polygon`/`MultiPolygon` from boundaries' shapely import **only if** now unused (check with ruff).

- [ ] **Step 5: Run tests + lint**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_esri.py -v && uv run ruff check src tests`
Expected: 2 PASS, ruff clean.

- [ ] **Step 6: Commit**

```bash
git add src/common/esri.py tests/test_esri.py src/ingest/boundaries.py
git commit -m "refactor: shared Esri rings->geom + paged polygon fetch in src/common/esri"
```

---

### Task 2: Fix the three scaffold bugs in `flood.py` (band filter, zero-fill, double-count)

Bugs, in the order the data flows:
1. `_load_nation_extents` strips to `gdf[["geometry"]]` **before** `_at_risk_extent` ever sees a band column → an England drop-in containing all four bands would include Low/Very Low. Filter per file at load, while the band column exists.
2. `flood_area_share` sums raw intersection pieces → overlapping extents (SEPA High ⊂ Medium; river/coastal overlap in estuaries) double-count. Dissolve intersections per area before measuring.
3. `run()` overlays **all** boundaries against whatever extents exist → nations without data get `flood_risk = 0.0` instead of staying absent/NaN ("missing → NaN, never silently zero" — the aggregate contract). Process per nation; emit rows only for nations with data.

**Files:**
- Modify: `src/ingest/flood.py`
- Test: `tests/test_flood.py`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_flood.py`)

```python
from src.ingest.flood import flood_shares_by_nation


def test_flood_area_share_does_not_double_count_overlaps():
    # High and Medium layers overlap exactly (High ⊂ Medium, as SEPA publishes
    # them) — the union still covers only the left half of A.
    flood = gpd.GeoDataFrame(
        geometry=[box(0, 0, 50, 100), box(0, 0, 50, 100)], crs=CRS
    )
    out = flood_area_share(_areas(), flood).set_index("area_code")
    assert abs(out.loc["A", "flood_risk"] - 0.5) < 1e-9


def _areas_two_nations():
    return gpd.GeoDataFrame(
        {"area_code": ["A", "B"], "nation": ["scotland", "england"]},
        geometry=[box(0, 0, 100, 100), box(200, 0, 300, 100)],
        crs=CRS,
    )


def test_flood_shares_by_nation_skips_nations_without_extents():
    # Only Scotland has extent data: England must contribute NO row (NaN after
    # the aggregate merge) — not a silent 0.0.
    extents = {"scotland": gpd.GeoDataFrame(geometry=[box(0, 0, 50, 100)], crs=CRS)}
    out = flood_shares_by_nation(_areas_two_nations(), extents)
    assert list(out["area_code"]) == ["A"]
    assert abs(out.set_index("area_code").loc["A", "flood_risk"] - 0.5) < 1e-9


def test_flood_shares_by_nation_empty_extents():
    out = flood_shares_by_nation(_areas_two_nations(), {})
    assert list(out.columns) == ["area_code", "flood_risk"]
    assert len(out) == 0
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_flood.py -v`
Expected: the 3 existing tests PASS; the new ones FAIL (`ImportError: cannot import name 'flood_shares_by_nation'` / double-count assertion error).

- [ ] **Step 3: Implement in `src/ingest/flood.py`**

(a) Add `"risk"` to the band candidates (the expected NRW/FRAW attribute) and band-transparency logging:

```python
_BAND_COL_CANDIDATES = ("prob_4band", "riskband", "risk_band", "band",
                        "likelihood", "class", "risk")
```

```python
def _at_risk_extent(flood: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Keep only High+Medium polygons if a recognised band column exists."""
    cols = {c.lower(): c for c in flood.columns}
    band = next((cols[c] for c in _BAND_COL_CANDIDATES if c in cols), None)
    if band is None:
        return flood
    vals = flood[band].astype(str).str.strip().str.lower()
    keep = vals.isin(_AT_RISK_VALUES)
    log.info("Band column %r: keeping %d/%d features (dropping values: %s)",
             band, int(keep.sum()), len(flood),
             sorted(vals[~keep].unique()) or "none")
    return flood[keep]
```

(b) Fix the double-count in `flood_area_share` — replace the groupby-sum with a per-area dissolve (overlapping intersection pieces union instead of adding):

```python
    inter = gpd.overlay(
        bnd[["area_code", "geometry"]], extent[["geometry"]], how="intersection"
    )
    flooded = inter.dissolve(by="area_code").geometry.area
```

(remove the `inter["_ipart"] = ...` and old `groupby` lines; the `out[...]` block below is unchanged — `flooded` is still a Series indexed by `area_code`).

(c) Replace `_load_nation_extents` with a per-nation dict that band-filters **per file** before stripping to geometry:

```python
NATIONS = ("england", "wales", "scotland")


def _load_nation_extents() -> dict[str, gpd.GeoDataFrame]:
    """Load pre-fetched flood-extent layers per nation from data/raw/flood/<nation>/.

    High+Medium filtering happens here, per source file, while the band column
    is still present; only the at-risk geometry is kept.
    """
    base = raw("flood")
    out: dict[str, gpd.GeoDataFrame] = {}
    for nation in NATIONS:
        ndir = base / nation
        if not ndir.exists():
            continue
        layers = []
        for fp in sorted(ndir.iterdir()):
            if fp.suffix.lower() not in (".gpkg", ".shp", ".geojson", ".json", ".parquet"):
                continue
            try:
                gdf = (gpd.read_parquet(fp) if fp.suffix.lower() == ".parquet"
                       else gpd.read_file(fp))
            except Exception as exc:  # noqa: BLE001
                log.warning("Could not read flood layer %s: %s", fp, exc)
                continue
            kept = _at_risk_extent(gdf)
            log.info("Loaded flood extent %s (%d features, %d at-risk)",
                     fp.name, len(gdf), len(kept))
            if len(kept):
                layers.append(kept[["geometry"]])
        if layers:
            out[nation] = gpd.GeoDataFrame(
                pd.concat(layers, ignore_index=True), crs=layers[0].crs)
    return out
```

(d) Add the per-nation pure function and rewrite `run()`:

```python
def flood_shares_by_nation(
    boundaries: gpd.GeoDataFrame,
    extents: dict[str, gpd.GeoDataFrame],
    chunk: int = 5000,
) -> pd.DataFrame:
    """flood_risk per area, only for nations with extent data. Pure.

    Nations absent from ``extents`` contribute NO rows — the aggregate merge
    then leaves them NaN (missing stays visibly missing, never a silent 0).
    Boundaries are processed in chunks to bound the overlay's memory use on the
    national extent layers.
    """
    parts = []
    for nation, ext in extents.items():
        bnd = boundaries[boundaries["nation"] == nation]
        for i in range(0, len(bnd), chunk):
            parts.append(flood_area_share(bnd.iloc[i:i + chunk], ext))
    if not parts:
        return pd.DataFrame({"area_code": pd.Series(dtype=str),
                             "flood_risk": pd.Series(dtype=float)})
    return pd.concat(parts, ignore_index=True)


def run() -> None:
    log.info("Ingesting flood-risk exposure (Phase 4)")
    extents = _load_nation_extents()
    missing = [n for n in NATIONS if n not in extents]
    if missing:
        log.warning(
            "No flood extents for %s under %s/<nation>/ — those nations stay "
            "unset (NaN). England is a manual download; see PHASE4_PLAN.md.",
            missing, raw("flood"),
        )
    if not extents:
        return

    boundaries = gpd.read_parquet(interim("area_boundaries.parquet"))
    out = flood_shares_by_nation(boundaries, extents)
    log.info(
        "Flood risk for %d areas | %.1f%% have any High/Medium flood area | "
        "share median=%.3f max=%.3f",
        len(out), (out["flood_risk"] > 0).mean() * 100,
        out["flood_risk"].median(), out["flood_risk"].max(),
    )
    write_parquet(out, interim("flood.parquet"))
    log.info("Wrote %s", interim("flood.parquet"))
```

- [ ] **Step 4: Run the full flood test file**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_flood.py -v`
Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/flood.py tests/test_flood.py
git commit -m "fix(flood): band-filter before geometry strip, dissolve overlaps, no zero-fill for missing nations"
```

---

### Task 3: Within-nation percentile ranking for `flood_risk` (`build_risk_index.py`)

Three regulators, incomparable bandings (SEPA High = 1-in-10 / Medium = 1-in-200; EA bands ~1-in-30 / 1-in-100) → rank within nation, exactly like `vehicle_crime` ranks within its source group. Generalise the existing crime-only special case into a per-feature map.

**Files:**
- Modify: `src/transform/build_risk_index.py:53-117` (`_CRIME_SOURCE_GROUP`, `_crime_groups`, `composite`, `enrich_components`)
- Test: `tests/test_build_risk_index.py`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_build_risk_index.py`, matching its existing import style)

```python
def test_feature_groups_flood_is_per_nation():
    from src.transform.build_risk_index import _feature_groups
    df = pd.DataFrame({"nation": ["england", "wales", "scotland", "england"]})
    groups = _feature_groups(df, "flood_risk")
    assert list(groups) == ["england", "wales", "scotland", "england"]
    # crime keeps its E+W-pooled grouping
    assert list(_feature_groups(df, "vehicle_crime")) == ["ew", "ew", "scotland", "ew"]
    # ungrouped features rank GB-wide
    assert _feature_groups(df, "deprivation") is None


def test_flood_pct_ranked_within_nation():
    from src.transform.build_risk_index import _feature_groups, normalise
    df = pd.DataFrame({
        "nation": ["england"] * 3 + ["scotland"] * 3,
        "flood_risk": [0.0, 0.1, 0.2, 0.0, 0.01, 0.02],
    })
    pct = normalise(df["flood_risk"], "percentile", _feature_groups(df, "flood_risk"))
    # Scotland's 0.02 max ranks as high within Scotland as England's 0.2 does
    # within England — absolute scales are never compared across nations.
    assert pct.iloc[2] == pct.iloc[5]
```

- [ ] **Step 2: Run to verify failure**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_build_risk_index.py -v`
Expected: new tests FAIL with `ImportError: cannot import name '_feature_groups'`; existing tests PASS.

- [ ] **Step 3: Implement**

Replace `_CRIME_SOURCE_GROUP` + `_crime_groups` (lines 53–62) with:

```python
# Features measured by nation-specific sources on incomparable scales → ranked
# within a comparability group before use. Maps feature -> (nation -> group).
_SOURCE_GROUPS: dict[str, dict[str, str]] = {
    # E+W crime is police.uk point data; Scotland is council-grain SPARQL counts.
    "vehicle_crime": {"england": "ew", "wales": "ew", "scotland": "scotland"},
    # Flood extents come from three regulators (EA / NRW / SEPA) whose likelihood
    # bandings differ (SEPA Medium = 1-in-200 vs EA Medium = ~1-in-100).
    "flood_risk": {"england": "england", "wales": "wales", "scotland": "scotland"},
}


def _feature_groups(features: pd.DataFrame, feature: str) -> pd.Series | None:
    """Comparability groups for ``feature``, or None if ungrouped / no nation col."""
    mapping = _SOURCE_GROUPS.get(feature)
    if mapping is None or "nation" not in features.columns:
        return None
    return features["nation"].map(mapping).fillna("other")
```

In `composite()` (line ~75), replace:
```python
    cg = _crime_groups(features)
    norm = pd.DataFrame({
        col: normalise(features[col], method, cg if col == "vehicle_crime" else None)
        for col in weights
    })
```
with:
```python
    norm = pd.DataFrame({
        col: normalise(features[col], method, _feature_groups(features, col))
        for col in weights
    })
```

In `enrich_components()` (line ~109), replace:
```python
    cg = _crime_groups(features)
    comps = [c for c in model_features() if c in features.columns]
    for c in comps:
        # vehicle_crime is ranked within nation-group (E+W vs Scotland) — the two
        # come from different sources on incomparable scales (see normalise()).
        pct = normalise(features[c], "percentile", cg if c == "vehicle_crime" else None)
```
with:
```python
    comps = [c for c in model_features() if c in features.columns]
    for c in comps:
        # Source-grouped features (crime, flood) are ranked within their
        # comparability group — see _SOURCE_GROUPS / normalise().
        pct = normalise(features[c], "percentile", _feature_groups(features, c))
```

Confirm no other caller: `grep -rn "_crime_groups" src tests` must return nothing after the edit.

- [ ] **Step 4: Run tests + lint**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_build_risk_index.py tests/test_serve_consistency.py -v && uv run ruff check src tests`
Expected: PASS (serve-consistency guards that existing baked data still reconciles — it must, since nothing active changed), ruff clean.

- [ ] **Step 5: Commit**

```bash
git add src/transform/build_risk_index.py tests/test_build_risk_index.py
git commit -m "feat(risk): generalise within-source percentile groups; flood_risk ranks within nation"
```

---

### Task 4: SEPA Scotland fetcher

Four already-split services (no band column → `_at_risk_extent` passes through, correct). Cached as GeoParquet per service under `data/raw/flood/scotland/` so re-runs are free and `_load_nation_extents` needs no changes.

**Files:**
- Modify: `src/ingest/flood.py` (add fetcher + call it from `run()`)
- Modify: `config/config.yaml` (REST base under `sources`)
- Test: `tests/test_flood.py`

- [ ] **Step 1: Add the config source** (config over constants — AGENTS.md rule 4)

In `config/config.yaml` `sources:`, directly under the existing `flood_scotland_sepa` line, add:

```yaml
  flood_scotland_sepa_rest: "https://map.sepa.org.uk/server/rest/services/Open"
```

- [ ] **Step 2: Write the failing test** (append to `tests/test_flood.py`)

```python
def test_sepa_query_url_builds_service_and_layer():
    from src.ingest.flood import _sepa_query_url
    url = _sepa_query_url("https://example/rest/Open", "River_Flooding_High_Likelihood", 1)
    assert url == "https://example/rest/Open/River_Flooding_High_Likelihood/FeatureServer/1/query"
```

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_flood.py::test_sepa_query_url_builds_service_and_layer -v`
Expected: FAIL (ImportError).

- [ ] **Step 3: Implement in `flood.py`**

Add imports at the top: `from src.common.config import settings`, `from src.common.esri import fetch_arcgis_polygons`, `from src.common.http import get_json_with_retry`.

```python
# SEPA publishes current flood maps as separate services per source × likelihood
# (already High/Medium-split → no band column to filter). OGL v3.0.
SEPA_SERVICES = (
    "River_Flooding_High_Likelihood",
    "River_Flooding_Medium_Likelihood",
    "Coastal_Flooding_High_Likelihood",
    "Coastal_Flooding_Medium_Likelihood",
)
_SEPA_REST_DEFAULT = "https://map.sepa.org.uk/server/rest/services/Open"


def _sepa_query_url(rest_base: str, service: str, layer_id: int) -> str:
    return f"{rest_base}/{service}/FeatureServer/{layer_id}/query"


def fetch_scotland() -> None:
    """Fetch/cache SEPA High+Medium river & coastal extents as GeoParquet.

    Grain in: national flood-extent polygons (EPSG:27700 requested via outSR).
    Out     : data/raw/flood/scotland/sepa_<service>.parquet (geometry only).
    Layer id is discovered per service (they differ, e.g. River Medium = 1).
    """
    rest = settings["sources"].get("flood_scotland_sepa_rest", _SEPA_REST_DEFAULT)
    dest_dir = raw("flood") / "scotland"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for svc in SEPA_SERVICES:
        dest = dest_dir / f"sepa_{svc.lower()}.parquet"
        if dest.exists():
            log.info("SEPA %s already cached (%s)", svc, dest.name)
            continue
        meta = get_json_with_retry(f"{rest}/{svc}/FeatureServer", {"f": "json"})
        layer_id = int(meta["layers"][0]["id"])
        log.info("Fetching SEPA %s (layer %d)…", svc, layer_id)
        gdf = fetch_arcgis_polygons(_sepa_query_url(rest, svc, layer_id))
        if gdf.empty:
            raise RuntimeError(f"SEPA {svc} returned no features — endpoint moved?")
        gdf.to_parquet(dest)
        log.info("Cached %d SEPA polygons -> %s", len(gdf), dest.name)
```

In `run()`, call the fetchers before loading (each is cache-first and fail-loud; a network failure should abort rather than silently ship partial Scotland):

```python
def run() -> None:
    log.info("Ingesting flood-risk exposure (Phase 4)")
    fetch_scotland()
    fetch_wales()          # added in Task 5
    extents = _load_nation_extents()
    ...
```

(For Task 4 only, add `fetch_scotland()` and leave `fetch_wales()` out until Task 5.)

- [ ] **Step 4: Run tests + lint**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_flood.py -v && uv run ruff check src tests`
Expected: all PASS, ruff clean. (Network code is exercised for real in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add src/ingest/flood.py tests/test_flood.py config/config.yaml
git commit -m "feat(flood): SEPA Scotland extent fetcher (ArcGIS REST, cached GeoParquet)"
```

---

### Task 5: NRW Wales fetcher (WFS)

FRAW replaced RoFRS in Wales; rivers + sea layers carry a High/Medium/Low band attribute (expected column: `risk`, already added to `_BAND_COL_CANDIDATES` in Task 2). Fetch everything, save with the band column, let `_at_risk_extent` filter at load — but **fail loud at fetch time** if no recognised band column exists (otherwise Low would silently pass through).

**Files:**
- Modify: `src/ingest/flood.py`, `config/config.yaml`
- Test: `tests/test_flood.py`

- [ ] **Step 1: Verify the live layer names before coding** (they inform the constant)

Run:
```bash
curl -s "https://datamap.gov.wales/geoserver/ows?service=WFS&version=2.0.0&request=GetCapabilities" | grep -io "<Name>inspire-nrw:NRW_FLOOD_RISK[A-Z_]*</Name>" | sort -u
```
Expected: names like `inspire-nrw:NRW_FLOOD_RISK_FROM_RIVERS` and `inspire-nrw:NRW_FLOOD_RISK_FROM_SEA` (exclude the SURFACE_WATER layer — rivers+sea only, per PHASE4_PLAN). **If the names differ, use the actual names in `NRW_LAYERS` below and note it in the commit message.** Then spot-check the band attribute on one feature:
```bash
curl -s "https://datamap.gov.wales/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=inspire-nrw:NRW_FLOOD_RISK_FROM_SEA&outputFormat=application/json&count=1" | python3 -c "import json,sys; print(json.load(sys.stdin)['features'][0]['properties'])"
```
Expected: a properties dict containing a band-like key (e.g. `risk: "High"`). If the key is not already in `_BAND_COL_CANDIDATES`, add it (lower-cased) in the same commit.

- [ ] **Step 2: Write the failing test** (append to `tests/test_flood.py`)

```python
def test_wfs_page_params():
    from src.ingest.flood import _wfs_page_params
    p = _wfs_page_params("inspire-nrw:X", start=5000, count=5000)
    assert p["typeNames"] == "inspire-nrw:X"
    assert p["startIndex"] == 5000 and p["count"] == 5000
    assert p["outputFormat"] == "application/json"
    assert p["srsName"] == "EPSG:27700"
```

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_flood.py::test_wfs_page_params -v` — Expected: FAIL (ImportError).

- [ ] **Step 3: Implement**

Config (`sources:`, under `flood_wales_nrw`):
```yaml
  flood_wales_nrw_ows: "https://datamap.gov.wales/geoserver/ows"
```

`flood.py` (uses `get_with_retry` already imported? No — add `from src.common.http import get_json_with_retry, get_with_retry` if not present):

```python
# NRW Flood Risk Assessment Wales (FRAW, replaced RoFRS in Wales). Rivers + sea
# layers, High/Medium/Low band attribute; High+Medium filtered at load. OGL.
NRW_LAYERS = (
    "inspire-nrw:NRW_FLOOD_RISK_FROM_RIVERS",
    "inspire-nrw:NRW_FLOOD_RISK_FROM_SEA",
)
_NRW_OWS_DEFAULT = "https://datamap.gov.wales/geoserver/ows"
_WFS_PAGE = 5000


def _wfs_page_params(type_name: str, *, start: int, count: int) -> dict:
    return {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": type_name, "srsName": "EPSG:27700",
        "outputFormat": "application/json", "count": count, "startIndex": start,
    }


def fetch_wales() -> None:
    """Fetch/cache NRW FRAW rivers+sea extents (WFS paged GeoJSON) as GeoParquet.

    Grain in: national flood-extent polygons (EPSG:27700 via srsName).
    Out     : data/raw/flood/wales/nrw_<layer>.parquet (geometry + band column,
              so _at_risk_extent can keep High+Medium at load time).
    """
    ows = settings["sources"].get("flood_wales_nrw_ows", _NRW_OWS_DEFAULT)
    dest_dir = raw("flood") / "wales"
    dest_dir.mkdir(parents=True, exist_ok=True)
    for layer in NRW_LAYERS:
        dest = dest_dir / f"nrw_{layer.split(':')[1].lower()}.parquet"
        if dest.exists():
            log.info("NRW %s already cached (%s)", layer, dest.name)
            continue
        log.info("Fetching NRW %s…", layer)
        feats, start = [], 0
        while True:
            data = get_with_retry(
                ows, _wfs_page_params(layer, start=start, count=_WFS_PAGE),
                timeout=600,
            ).json()
            batch = data.get("features", [])
            feats.extend(batch)
            if len(batch) < _WFS_PAGE:
                break
            start += _WFS_PAGE
        if not feats:
            raise RuntimeError(f"NRW {layer} returned no features — layer renamed?")
        gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:27700")
        cols = {c.lower() for c in gdf.columns}
        if not cols & set(_BAND_COL_CANDIDATES):
            raise RuntimeError(
                f"NRW {layer}: no recognised band column in {sorted(gdf.columns)} "
                "— Low-risk polygons would pass through unfiltered. Add the "
                "attribute name to _BAND_COL_CANDIDATES."
            )
        gdf.to_parquet(dest)
        log.info("Cached %d NRW features -> %s", len(gdf), dest.name)
```

Add `fetch_wales()` to `run()` after `fetch_scotland()`.

- [ ] **Step 4: Run tests + lint**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_flood.py -v && uv run ruff check src tests`
Expected: all PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add src/ingest/flood.py tests/test_flood.py config/config.yaml
git commit -m "feat(flood): NRW Wales FRAW fetcher (WFS paged GeoJSON, band-checked)"
```

---

### Task 6: England manual-download runbook

No scriptable full-extent endpoint (verified 2026-07-15: the 2020 `EA/RiskOfFloodingFromRiversAndSea/MapServer` → HTTP 500; the DSP WFS slugs → 404; current data is NaFRA2-based behind an interactive downloader). Document the manual drop-in the ingest already supports.

**Files:**
- Modify: `PHASE4_PLAN.md` (sources table + a new runbook section; tick completed checkboxes as tasks land)

- [ ] **Step 1: Add the runbook section to `PHASE4_PLAN.md`** (after "## Sources")

```markdown
## England runbook (manual download — no scriptable endpoint)

Verified 2026-07-15: the legacy EA ArcGIS service
(`EA/RiskOfFloodingFromRiversAndSea/MapServer`, last modified 2020) returns
HTTP 500 and the DSP WFS slugs 404 — England's current RoFRS (NaFRA2-based,
revised 2026-06-18) is only available through the interactive downloader.

1. Open https://environment.data.gov.uk/explore/96ab4342-82c1-4095-87f1-0082e8d84ef1?download=true
2. Select the whole of England as the area of interest (or tile it into a few
   large regions if the exporter caps the size — all files land in one folder).
3. Choose a vector format (GeoPackage preferred; Shapefile/GeoJSON also fine).
4. Unzip into `data/raw/flood/england/` (any mix of .gpkg/.shp/.geojson/.parquet).
5. Re-run `uv run python -m src.ingest.flood`. The ingest reads every file in
   the folder, keeps High+Medium via the band column (`prob_4band`/`risk_band`/…)
   and logs exactly which band values were kept vs dropped — check that log line:
   if it reports no band column but the source has 4 bands, stop and add the
   column name to `_BAND_COL_CANDIDATES` in `src/ingest/flood.py`.

Scotland (SEPA) and Wales (NRW) need no manual step — `flood.py` fetches and
caches them automatically.
```

- [ ] **Step 2: Update the checkbox list in `PHASE4_PLAN.md`** — mark `Implement the areal-overlay transform per nation + the download/cache helpers.` as `[x]` once Tasks 1–5 are merged, and reword the open scope question to record the outcome (SEPA+NRW automated, England manual).

- [ ] **Step 3: Commit**

```bash
git add PHASE4_PLAN.md
git commit -m "docs(flood): England manual-download runbook; record SEPA/NRW automation"
```

---

### Task 7: Run the ingest for real (network) and refresh features

- [ ] **Step 1: Fetch + overlay Scotland and Wales (England too if `data/raw/flood/england/` is populated)**

Run: `uv run python -m src.ingest.flood`
Expected log lines: `Cached N SEPA polygons -> …` ×4, `Cached N NRW features -> …` ×2, a warning naming the still-missing nations (england, until the manual drop-in happens), per-file `Band column 'risk': keeping …` lines for Wales, and a final `Flood risk for N areas | X% have any High/Medium flood area…` + `Wrote data/interim/flood.parquet`. The SEPA/NRW fetches are national polygon layers — expect several minutes each on first run; the cache makes re-runs instant.

- [ ] **Step 2: Sanity-check the parquet**

```bash
uv run python -c "
import pandas as pd
df = pd.read_parquet('data/interim/flood.parquet')
print(df['flood_risk'].describe())
print('areas:', len(df), 'nonzero:', (df.flood_risk > 0).sum())
print(df.nlargest(5, 'flood_risk'))
"
```
Expected: shares in [0, 1]; a large zero mass (most areas have no High/Medium flood land) with a long tail; row count ≈ 6,976 (Scotland) + 1,909 (Wales) [+ 34,753 E+W LSOAs minus Wales… i.e. + England's ~32.8k once dropped in]. If max == 1.0 for more than a handful of areas, eyeball them before proceeding (estuarine areas can legitimately be fully in-zone).

- [ ] **Step 3: Re-run the feature aggregation so `lsoa_features.parquet` gains the column**

Run: `make features`
Expected log: `Merged flood-risk exposure for N areas`. Verify NaN behaviour:
```bash
uv run python -c "
import pandas as pd
df = pd.read_parquet('data/interim/lsoa_features.parquet')
print(df.groupby(df.area_code.str[0])['flood_risk'].agg(['count','mean','max']))
"
```
Expected: rows for S (and W) with real values; E count 0 (all-NaN) until the England drop-in — **never zeros**.

- [ ] **Step 4: Commit nothing** (data is git-ignored). Record the run's headline stats in the PR description instead.

---

### Task 8: Evidence-gate run — **conditional on all three nations present**

Do NOT start this task until `data/interim/flood.parquet` covers England, Wales and Scotland (Task 7 step 3 shows non-zero counts for E, W and S). Activating earlier drops the missing nation's anchor rows from the panel (`calibrate.py:247`) and silently changes every validation metric.

- [ ] **Step 1: Activate the candidate**

In `config/config.yaml`:
- `features.place`: uncomment `- flood_risk` (delete the 4-line explanatory comment block that says to activate it).
- `calibration.premium_features`: add `- flood_risk` (the list is documented as kept in sync with `features.place`).

- [ ] **Step 2: Recalibrate end-to-end** (never `make risk` alone — CLAUDE.md train/serve-skew warning)

Run: `make calibrate`
Expected: regression refits with `flood_risk_pct` as a place regressor; `reports/calibration.json` + `reports/feature_analysis.md` + re-baked `frontend/public/data/*.geojson` all regenerate.

- [ ] **Step 3: Read the verdict**

Run: `cat reports/feature_analysis.md`
Decision rule (mirrors Phase 3): **keep** flood_risk as a premium driver iff
- partial-correlation p-value < 0.05, and
- the OLS sign is positive (flood exposure should not *reduce* premiums), and
- VIF stays in the existing healthy band (≲ 8), and
- LOAO MAE does not degrade by more than ~£5 vs the pre-flood £89.

Otherwise **gate it out**: revert Step 1 (re-comment in `features.place`, remove from `premium_features`), add `- flood_risk` to `features.diagnostics`, and re-run `make calibrate` so coefficients revert while the map still gets the layer.

- [ ] **Step 4: Whichever branch taken, verify serve consistency**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest tests/test_serve_consistency.py tests/test_calibrate.py -v`
Expected: PASS (baked GeoJSON reconciles with the new coefficients).

- [ ] **Step 5: Commit**

```bash
git add config/config.yaml
git commit -m "feat(model): flood_risk evidence-gated — <KEPT as place driver | gated to diagnostics> (see reports/feature_analysis.md)"
```
(Use the actual outcome in the message; quote the partial r / p / VIF numbers in the body.)

---

### Task 9: Frontend flood layer

`bake_static.py` and `MapView` are generic (they derive fields from config feature lists and colour by `${mode}_pct`) — only the hardcoded mode lists need the new entry. Two variants depending on Task 8's outcome; the four list edits below are identical in both.

**Files:**
- Modify: `frontend/src/types.ts:109-117`, `frontend/src/utils.ts`, `frontend/src/Sidebar.tsx:23-32`, `frontend/src/App.tsx:62-70`, `frontend/src/AboutPanel.tsx:5-37`

- [ ] **Step 1: Add the mode everywhere**

`types.ts` — extend the `ColorMode` union:
```ts
  | 'ksi_collisions_per_billion_vehicle_miles'
  | 'flood_risk';
```

`utils.ts` — add the label:
```ts
  ksi_collisions_per_billion_vehicle_miles: 'KSI collisions / traffic',
  flood_risk: 'Flood risk',
```

`Sidebar.tsx` — append to `COLOR_MODES`:
```ts
  { mode: 'flood_risk', label: 'Flood' },
```

`App.tsx` — append `'flood_risk',` to the `validFilters` array.

`AboutPanel.tsx` — append to `DATA_SOURCES` (adjust the last clause to the gate outcome):
```ts
  {
    key: 'flood_risk',
    source: 'EA / NRW / SEPA flood maps',
    description:
      "Share of each area's land in a High-or-Medium river/sea flood zone, from each nation's regulator (EA England · NRW Wales · SEPA Scotland), ranked within nation — the three bandings are not comparable on an absolute scale.",
  },
```

- [ ] **Step 2: Place it in the driver or diagnostic list** (per Task 8)

If **kept** (premium driver), in `utils.ts`: add `'flood_risk',` to `MODEL_DRIVERS` (after `'aadf_intensity',`), to `WATERFALL_ORDER`'s place row, and to `PLACE_KEYS`.

If **gated out** (diagnostic), in `utils.ts`: add `'flood_risk',` to `DIAGNOSTIC_LAYERS` instead. (`COMPONENT_KEYS`/`featureToDetail` pick it up automatically either way.)

- [ ] **Step 3: Lint, build, and verify in the browser**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean. Then start the dev preview, switch the map filter to "Flood", and confirm: coastal/estuary areas light up, inland plateau areas are pale, clicking an area shows the flood percentile in the detail panel (and a £ step in the waterfall iff kept as a driver). Screenshot for the PR.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(ui): flood-risk map layer + about entry"
```

---

### Task 10: Docs + full verification

- [ ] **Step 1: Update docs**
- `STATUS.md`: Phase 4 section → COMPLETE (or "complete except England drop-in" if so), gate outcome + new metrics table row, flood added to the pipeline/frontend lists.
- `README.md`: add the three flood sources + licences to the data-source table (AGENTS.md rule 2).
- `DATA_PROVENANCE_AND_TRANSFORMS.md`: new flood section — source per nation, verified endpoints, High+Medium definition per regulator, areal-overlay transform (dissolved intersections ÷ area), within-nation ranking rationale.
- `PHASE4_PLAN.md`: tick remaining checkboxes.

- [ ] **Step 2: Full test suite + lint**

Run: `UV_CACHE_DIR=.uv-cache uv run pytest && uv run ruff check src tests && cd frontend && npm run lint`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add STATUS.md README.md DATA_PROVENANCE_AND_TRANSFORMS.md PHASE4_PLAN.md
git commit -m "docs: Phase 4 flood completion — sources, transform, gate outcome"
```

- [ ] **Step 4: Hand back to the user for PR creation** (the user reviews and creates PRs themselves — do not open one unprompted).

---

## Self-review notes

- Spec coverage: roadmap item 2.1 = Tasks 1–8 (EA+SEPA-first became SEPA+NRW-automated/England-manual after endpoint verification — the roadmap's "NRW when its download path is confirmed" is now confirmed); map-layer-either-way = Task 9; docs/definition-of-done = Task 10.
- The three scaffold bugs are fixed test-first in Task 2 before any real data flows through them.
- Types consistent: `flood_shares_by_nation(boundaries, extents: dict[str, GeoDataFrame])` matches its Task 2 definition at every later mention; `_feature_groups(features, feature)` likewise.
- Known runtime-verify points (deliberate, fail-loud): NRW layer names + band attribute (Task 5 step 1), SEPA layer ids (discovered per service), England band column (runbook step 5).
