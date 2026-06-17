// Small client-side helpers. No new dependencies.
import type { Feature, FeatureCollection } from 'geojson';
import type { AreaDetail, LsoaProps } from './types';

export const COMPONENT_KEYS = [
  'vehicle_crime',
  'road_casualties',
  'deprivation',
  'population_density',
  'aadf_intensity',
  'traffic_per_capita',
  'ksi_collisions_per_billion_vehicle_miles',
] as const;

export const COMPONENT_LABELS: Record<string, string> = {
  vehicle_crime: 'Vehicle crime',
  road_casualties: 'Road casualties',
  deprivation: 'Deprivation (IMD)',
  population_density: 'Population density',
  aadf_intensity: 'Traffic intensity (AADF)',
  traffic_per_capita: 'Traffic exposure',
  ksi_collisions_per_billion_vehicle_miles: 'KSI collisions / traffic',
};

/** Format a GBP figure with thousands separators, e.g. 1180 -> "£1,180". */
export const gbp = (n?: number | null): string =>
  n == null ? '—' : `£${Math.round(n).toLocaleString('en-GB')}`;

/** Read the quintile from a feature regardless of whether the backend
 *  named it `quintile` or `risk_bucket`. */
export const readQuintile = (p: Record<string, any>): number =>
  Number(p.quintile ?? p.risk_bucket ?? 0);

/** Build an O(1) lookup of lsoa code -> feature from the loaded GeoJSON. */
export function buildLookup(fc: FeatureCollection): Map<string, Feature> {
  const m = new Map<string, Feature>();
  for (const f of fc.features) {
    const code = (f.properties as any)?.lsoa11cd;
    if (code) m.set(String(code), f);
  }
  return m;
}

/** Bounding box of a (Multi)Polygon feature: [[w,s],[e,n]]. */
export function featureBounds(
  feature: Feature
): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords: any) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      for (const c of coords) visit(c);
    }
  };
  const g: any = feature.geometry;
  if (!g) return null;
  visit(g.coordinates);
  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

/** Centre of a bbox — used to drop a marker on the selected area. */
export const boundsCentre = (
  b: [[number, number], [number, number]]
): [number, number] => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];

/** Ray-casting point-in-ring test ([lng,lat] pairs). */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Point-in-(Multi)Polygon: inside the outer ring and outside any hole. */
function pointInFeature(lng: number, lat: number, feature: Feature): boolean {
  const g: any = feature.geometry;
  if (!g) return false;
  const polys: number[][][][] =
    g.type === 'MultiPolygon' ? g.coordinates
    : g.type === 'Polygon' ? [g.coordinates]
    : [];
  for (const poly of polys) {
    if (!pointInRing(lng, lat, poly[0])) continue;       // outside outer ring
    if (poly.slice(1).some((hole) => pointInRing(lng, lat, hole))) continue; // in a hole
    return true;
  }
  return false;
}

/**
 * Find the area for a point. Postcode → LSOA via coordinates (postcodes.io now
 * returns 2021/2022 census codes, which don't match our 2011 `area_code`s —
 * coordinates are vintage-independent).
 *
 * Containment first (bbox pre-filter → ray-cast). Aggressive simplification leaves
 * tiny gaps between dense-urban polygons where a point may fall in no polygon, so
 * we fall back to the **nearest area** (by bbox-centre distance) — which is the
 * correct LSOA in practice. Single O(n) pass over ~42k features (a few ms).
 */
export function featureAtPoint(
  features: Feature[],
  lng: number,
  lat: number
): Feature | null {
  let nearest: Feature | null = null;
  let nearestD = Infinity;
  for (const f of features) {
    const b = featureBounds(f);
    if (!b) continue;
    const inBox =
      lng >= b[0][0] && lng <= b[1][0] && lat >= b[0][1] && lat <= b[1][1];
    if (inBox && pointInFeature(lng, lat, f)) return f;
    const [cx, cy] = boundsCentre(b);
    const d = (cx - lng) ** 2 + (cy - lat) ** 2;
    if (d < nearestD) {
      nearestD = d;
      nearest = f;
    }
  }
  return nearest;
}

/** Normalise GeoJSON feature properties into the shape DetailPanel expects.
 *  Used when an area is reached by *clicking the map* or a ranking, so the
 *  panel is as rich as the geojson allows — no API call needed. */
export function featureToDetail(props: LsoaProps): AreaDetail {
  const components = COMPONENT_KEYS.map((key) => ({
    key,
    value: props[`${key}_val`] as number | undefined,
    percentile: props[`${key}_pct`] as number | undefined,
    contribution: props[`${key}_contrib`] as number | undefined,
  })).filter((c) => c.value != null || c.percentile != null);

  return {
    title: props.lsoa_name ? String(props.lsoa_name) : String(props.lsoa11cd),
    subtitle: `LSOA ${props.lsoa11cd}`,
    lsoa11cd: String(props.lsoa11cd),
    risk_index: Number(props.risk_index),
    quintile: readQuintile(props),
    calibrated_premium: props.calibrated_premium as number | undefined,
    components,
  };
}

// ---------------------------------------------------------------------------
// Distribution helpers (client-side, from the in-memory GeoJSON)
// ---------------------------------------------------------------------------

export interface DistributionResult {
  /** 20 bin counts (normalised 0–1 relative to the tallest bin). */
  bins: number[];
  /** Which bin (0–19) the selected value falls into. */
  selectedBin: number;
  /** Percentage of areas this value exceeds (0–100). */
  percentileRank: number;
}

/**
 * Build a 20-bin histogram of `fieldName` across all features, and locate
 * where `selectedValue` sits.
 */
export function computeDistribution(
  lookup: Map<string, Feature>,
  fieldName: string,
  selectedValue: number
): DistributionResult | null {
  const values: number[] = [];
  for (const f of lookup.values()) {
    const v = (f.properties as any)?.[fieldName];
    if (v != null && isFinite(Number(v))) values.push(Number(v));
  }
  if (values.length < 10) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max === min) return null;

  const N_BINS = 20;
  const binWidth = (max - min) / N_BINS;
  const bins = new Array(N_BINS).fill(0);
  for (const v of values) {
    const idx = Math.min(N_BINS - 1, Math.floor((v - min) / binWidth));
    bins[idx]++;
  }
  const maxBin = Math.max(...bins);
  const normBins = bins.map((b) => (maxBin > 0 ? b / maxBin : 0));

  const selectedBin = Math.min(
    N_BINS - 1,
    Math.floor((selectedValue - min) / binWidth)
  );

  // Percentile rank: % of values strictly less than selectedValue.
  let below = 0;
  for (const v of sorted) {
    if (v < selectedValue) below++;
    else break;
  }
  const percentileRank = (below / values.length) * 100;

  return { bins: normBins, selectedBin, percentileRank };
}

/**
 * Return the component key with the highest *_contrib for a feature, or null.
 */
export function dominantDriver(
  props: Record<string, any>
): string | null {
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const key of COMPONENT_KEYS) {
    const c = props[`${key}_contrib`];
    if (c != null && Number(c) > bestVal) {
      bestVal = Number(c);
      best = key;
    }
  }
  return best;
}
