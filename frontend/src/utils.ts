// Small client-side helpers. No new dependencies.
import type { Feature, FeatureCollection } from 'geojson';
import type { AreaDetail, LsoaProps } from './types';

// Drivers that actually move the calibrated premium (place + composition) — these
// carry a £ `_contrib`. Diagnostics are mapped layers the calibration evidence-gated
// OUT of the premium; they carry only a percentile. Keeping them visually distinct is
// a credibility requirement (the premium is not "just a density model").
export const MODEL_DRIVERS = [
  'vehicle_crime',
  'deprivation',
  'aadf_intensity',
  'young_driver_share',
  'cars_per_household',
] as const;

export const DIAGNOSTIC_LAYERS = [
  'road_casualties',
  'population_density',
  'traffic_per_capita',
  'ksi_collisions_per_billion_vehicle_miles',
] as const;

export const COMPONENT_KEYS = [...MODEL_DRIVERS, ...DIAGNOSTIC_LAYERS] as const;

// Canonical DISPLAY order (place drivers first, then composition controls). LMDI
// step magnitudes are order-invariant, so this only sets the on-screen sequence.
export const WATERFALL_ORDER = [
  'vehicle_crime', 'deprivation', 'aadf_intensity',     // place
  'young_driver_share', 'cars_per_household',            // composition
] as const;
const PLACE_KEYS = new Set<string>(['vehicle_crime', 'deprivation', 'aadf_intensity']);

export const COMPONENT_LABELS: Record<string, string> = {
  vehicle_crime: 'Vehicle crime',
  deprivation: 'Deprivation (IMD)',
  aadf_intensity: 'Traffic intensity (AADF)',
  young_driver_share: 'Young drivers (17–24)',
  cars_per_household: 'Cars per household',
  road_casualties: 'Road casualties',
  population_density: 'Population density',
  traffic_per_capita: 'Traffic exposure',
  ksi_collisions_per_billion_vehicle_miles: 'KSI collisions / traffic',
};

const DRIVER_SET = new Set<string>(MODEL_DRIVERS);
export const isModelDriver = (key: string): boolean => DRIVER_SET.has(key);

// Sequential premium ramp (mirrors the CSS --ramp-* / --q* tokens). Source of
// truth for the map fill, legend and detail swatches so they always agree.
export const RAMP = [
  '#f6e8c8', '#efc982', '#e0a93f', '#d88c3a', '#c44536', '#9e2a2b', '#6e1e22',
];
export const QUINTILE_FILL = ['#efc982', '#e0a93f', '#d88c3a', '#c44536', '#6e1e22'];
export const NO_DATA_COLOR = '#d9d9d9';
export const quintileColor = (q: number): string =>
  QUINTILE_FILL[Math.min(5, Math.max(1, Math.round(q))) - 1] ?? NO_DATA_COLOR;

/** Format a GBP figure with thousands separators, e.g. 1180 -> "£1,180". */
export const gbp = (n?: number | null): string =>
  n == null ? '—' : `£${Math.round(n).toLocaleString('en-GB')}`;

/** Ordinal percentile label, e.g. 91 -> "91st", 22 -> "22nd", 86 -> "86th". */
export const ordinalPct = (n?: number | null): string => {
  if (n == null || !isFinite(n)) return '—';
  const v = Math.round(n);
  const t = v % 100;
  const s = t >= 11 && t <= 13 ? 'th'
    : v % 10 === 1 ? 'st'
    : v % 10 === 2 ? 'nd'
    : v % 10 === 3 ? 'rd'
    : 'th';
  return `${v}${s}`;
};

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
    kind: (isModelDriver(key) ? 'driver' : 'diagnostic') as 'driver' | 'diagnostic',
    value: props[`${key}_val`] as number | undefined,
    percentile: props[`${key}_pct`] as number | undefined,
    contribution: props[`${key}_contrib`] as number | undefined,
  })).filter((c) => c.value != null || c.percentile != null);

  const full = props.calibrated_premium as number | undefined;
  const placeOnly = props.premium_place_only as number | undefined;

  const baseline = props.premium_baseline as number | undefined;
  const steps = baseline == null
    ? undefined
    : WATERFALL_ORDER.map((key) => ({
        key,
        label: COMPONENT_LABELS[key] ?? key,
        percentile: props[`${key}_pct`] as number | undefined,
        step: Number(props[`${key}_contrib`] ?? 0),
        kind: (PLACE_KEYS.has(key) ? 'place' : 'composition') as 'place' | 'composition',
        withinScotland: key === 'vehicle_crime' && String(props.lsoa11cd).startsWith('S'),
      }));

  return {
    title: props.lsoa_name ? String(props.lsoa_name) : String(props.lsoa11cd),
    subtitle: `LSOA ${props.lsoa11cd}`,
    lsoa11cd: String(props.lsoa11cd),
    risk_index: Number(props.risk_index),
    quintile: readQuintile(props),
    calibrated_premium: full,
    premium_place_only: placeOnly,
    composition_uplift:
      full != null && placeOnly != null ? full - placeOnly : undefined,
    premium_baseline: baseline,
    steps,
    components,
  };
}

// ---------------------------------------------------------------------------
// Editorial helpers
// ---------------------------------------------------------------------------

/** Quintile £ bands computed from the loaded GeoJSON — keeps the legend live. */
export interface PremiumBand { q: number; min: number; max: number; }
export function quintilePremiumBands(
  lookup: Map<string, Feature>
): PremiumBand[] {
  const byQ = new Map<number, { min: number; max: number }>();
  for (const f of lookup.values()) {
    const p = f.properties as any;
    const q = Number(p?.quintile);
    const v = Number(p?.calibrated_premium);
    if (!q || !isFinite(v)) continue;
    const cur = byQ.get(q);
    if (!cur) byQ.set(q, { min: v, max: v });
    else { cur.min = Math.min(cur.min, v); cur.max = Math.max(cur.max, v); }
  }
  return [...byQ.entries()]
    .map(([q, r]) => ({ q, ...r }))
    .sort((a, b) => a.q - b.q);
}

/**
 * Position (0–1 across the 5 equal quintile segments) of a £ value, used to
 * place the "GB average" notch on the legend ramp.
 */
export function premiumToRampPos(value: number, bands: PremiumBand[]): number {
  if (bands.length === 0) return 0;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (value <= b.max || i === bands.length - 1) {
      const span = b.max - b.min || 1;
      const within = Math.min(1, Math.max(0, (value - b.min) / span));
      return (i + within) / bands.length;
    }
  }
  return 1;
}

/** One quintile-aware plain-language sentence introducing the premium. */
export function ledeForQuintile(q: number): string {
  switch (q) {
    case 5: return 'Among the most expensive places in Britain to insure a car.';
    case 4: return 'More expensive than most of the country.';
    case 3: return 'Around the middle of the national range.';
    case 2: return 'Cheaper than most of the country.';
    case 1: return 'Among the cheapest places in Britain to insure a car.';
    default: return '';
  }
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
  /** Bin (0–19) of an optional reference value (e.g. the national average). */
  avgBin?: number;
}

/**
 * Build a 20-bin histogram of `fieldName` across all features, and locate
 * where `selectedValue` sits.
 */
export function computeDistribution(
  lookup: Map<string, Feature>,
  fieldName: string,
  selectedValue: number,
  avgValue?: number
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

  const avgBin =
    avgValue != null && isFinite(avgValue)
      ? Math.min(N_BINS - 1, Math.max(0, Math.floor((avgValue - min) / binWidth)))
      : undefined;

  return { bins: normBins, selectedBin, percentileRank, avgBin };
}

export interface DominantDriver { key: string; dir: 'up' | 'down'; }

// The factor that moves THIS area's premium most, in either direction, with its sign:
// 'up' = pushes the premium up, 'down' = pulls it down.
export function dominantDriver(
  props: Record<string, any>
): DominantDriver | null {
  let bestKey: string | null = null;
  let bestMag = -Infinity;
  let bestSigned = 0;
  for (const key of MODEL_DRIVERS) {
    const c = props[`${key}_contrib`];
    if (c == null) continue;
    const v = Number(c);
    if (Math.abs(v) > bestMag) {
      bestMag = Math.abs(v);
      bestKey = key;
      bestSigned = v;
    }
  }
  return bestKey == null ? null : { key: bestKey, dir: bestSigned >= 0 ? 'up' : 'down' };
}
