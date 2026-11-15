import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREAS_WAIT_FOR_TILES_MS } from './layout';
import { areasMayLoad } from './loadState';

// First paint: the streamed tiles colour the map from about 0.7 MB of range
// requests, and the ~8 MB GeoJSON download waits for them. When both started at
// once, the download took most of a 4G link while the tiles were in flight and
// the first colour landed a second or more later (measured in headless Chromium).
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const mapView = readFileSync(new URL('./MapView.tsx', import.meta.url), 'utf8');

/** The source of the effect that calls `getGeojson(`, from its `useEffect(` on. */
function geojsonEffect(): string {
  const call = app.indexOf('getGeojson(');
  if (call < 0) throw new Error('getGeojson( not found in App.tsx');
  const start = app.lastIndexOf('useEffect(', call);
  const end = app.indexOf('}, [', call);
  return app.slice(start, app.indexOf(']);', end) + 3);
}

describe('areasMayLoad', () => {
  it('holds the GeoJSON back while the tiles are in flight', () => {
    expect(areasMayLoad(false, false)).toBe(false);
  });
  it('starts it once the tiles have coloured the map (or failed)', () => {
    expect(areasMayLoad(true, false)).toBe(true);
  });
  it('starts it anyway once the wait is over', () => {
    expect(areasMayLoad(false, true)).toBe(true);
  });
});

describe('AREAS_WAIT_FOR_TILES_MS', () => {
  it('is a short cap, so slow or missing tiles cost seconds, not the map', () => {
    expect(AREAS_WAIT_FOR_TILES_MS).toBeGreaterThan(0);
    expect(AREAS_WAIT_FOR_TILES_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('the GeoJSON download waits for the tiles', () => {
  it('the load effect returns before fetching until the areas may load', () => {
    const effect = geojsonEffect();
    const gate = effect.indexOf('if (!startAreas) return;');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(effect.indexOf('getGeojson('));
    expect(effect).toMatch(/\[[^\]]*\bstartAreas\b[^\]]*\]\);$/);
  });
  it('the gate is the tiles signal or the capped wait', () => {
    expect(app).toContain('areasMayLoad(tilesSettled, tilesWaitOver)');
    expect(app).toMatch(/setTimeout\(\(\) => setTilesWaitOver\(true\), AREAS_WAIT_FOR_TILES_MS\)/);
    expect(app).toContain('onTilesSettled={onTilesSettled}');
  });
  it('the model figures do not wait with it', () => {
    expect(geojsonEffect()).not.toContain('getMethodology(');
  });
});

describe('MapView reports the tiles and starts them early', () => {
  it('says the tiles settled when their source has loaded', () => {
    expect(mapView).toMatch(
      /e\.sourceId === 'lsoa-tiles'\) \{\s*setTilesOn\(mapColors\.basemap\);\s*onTilesSettled\?\.\(\);/
    );
  });
  it('says so too when the tiles fail, so the GeoJSON need not wait out the cap', () => {
    expect(mapView).toMatch(/sourceId === 'lsoa-tiles'\) onTilesSettled\?\.\(\)/);
  });
  it('hands react-map-gl the maplibre-gl module it already holds (no extra chunk)', () => {
    expect(mapView).toContain('mapLib={maplibregl}');
  });
  it('fetches the archive header before the basemap style has loaded', () => {
    expect(mapView).toContain('tilesProtocol.add(tilesArchive)');
    expect(mapView).toContain('tilesArchive.getHeader()');
    expect(mapView).toContain("maplibregl.addProtocol('pmtiles', tilesProtocol.tile)");
  });
});
