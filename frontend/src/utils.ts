// Small client-side helpers. No new dependencies.
import type { Feature, FeatureCollection, Position } from 'geojson';
import type { AreaDetail, ColorMode, LsoaProps, RankingGroup, WaterfallStep } from './types';

// Drivers that actually move the calibrated premium (place + composition) — these
// carry a £ `_contrib`. Diagnostics are mapped layers the calibration evidence-gated
// OUT of the premium; they carry only a percentile. Keeping them visually distinct is
// a credibility requirement (the premium is not "just a density model").
export const MODEL_DRIVERS = [
  'vehicle_crime',
  'imd_crime',
  'aadf_intensity',
  'young_driver_share',
  'cars_per_household',
] as const;

// deprivation moved driver → diagnostic in the 2026-07 gate cycle: the IMD
// crime sub-domain (imd_crime) replaced it as the premium driver. flood_risk
// was gated OUT for car premiums (wrong-signed — flood tracks rurality).
export const DIAGNOSTIC_LAYERS = [
  'deprivation',
  'flood_risk',
  'road_casualties',
  'population_density',
  'traffic_per_capita',
  'ksi_collisions_per_billion_vehicle_miles',
] as const;

export const COMPONENT_KEYS = [...MODEL_DRIVERS, ...DIAGNOSTIC_LAYERS] as const;

// Canonical DISPLAY order (place drivers first, then composition controls). LMDI
// step magnitudes are order-invariant, so this only sets the on-screen sequence.
export const WATERFALL_ORDER = [
  'vehicle_crime', 'imd_crime', 'aadf_intensity',       // place
  'young_driver_share', 'cars_per_household',            // composition
] as const;
const PLACE_KEYS = new Set<string>(['vehicle_crime', 'imd_crime', 'aadf_intensity']);

// The map's colour modes, in the order the sidebar offers them.
export const COLOR_MODES: { mode: ColorMode; label: string }[] = [
  { mode: 'composite', label: 'Premium' },
  { mode: 'vehicle_crime', label: 'Crime' },
  { mode: 'imd_crime', label: 'Crime deprivation' },
  { mode: 'aadf_intensity', label: 'Traffic' },
  { mode: 'young_driver_share', label: 'Young drivers' },
  { mode: 'cars_per_household', label: 'Cars/household' },
  { mode: 'deprivation', label: 'Deprivation' },
  { mode: 'flood_risk', label: 'Flood risk' },
  { mode: 'road_casualties', label: 'Casualties' },
  { mode: 'population_density', label: 'Density' },
  { mode: 'traffic_per_capita', label: 'Traffic/capita' },
  { mode: 'ksi_collisions_per_billion_vehicle_miles', label: 'KSI rate' },
];

export const COMPONENT_LABELS: Record<string, string> = {
  vehicle_crime: 'Vehicle crime',
  imd_crime: 'Crime deprivation (IMD)',
  deprivation: 'Deprivation (IMD)',
  flood_risk: 'Flood risk',
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
// Legend label colour on each quintile segment (dark on the light three,
// white on the dark two); colors.test.ts checks each pair for contrast.
export const QUINTILE_TEXT = ['#24211c', '#24211c', '#24211c', '#ffffff', '#ffffff'];
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
export const readQuintile = (p: Record<string, unknown>): number =>
  Number(p.quintile ?? p.risk_bucket ?? 0);

/** The three modelled nations (Northern Ireland is excluded: no open crime source). */
export type Nation = 'england' | 'wales' | 'scotland';

/** Nations in display order, with the first letter of their area codes
 *  (ONS/NRS GSS codes: E01… England, W01… Wales, S01… Scotland). */
export const NATIONS: readonly { id: Nation; label: string; prefix: string }[] = [
  { id: 'england', label: 'England', prefix: 'E' },
  { id: 'wales', label: 'Wales', prefix: 'W' },
  { id: 'scotland', label: 'Scotland', prefix: 'S' },
];

/** The nation an area code belongs to, from its first letter; undefined if unknown. */
export function nationOf(code: string | null | undefined): Nation | undefined {
  const first = code?.charAt(0).toUpperCase();
  return NATIONS.find((n) => n.prefix === first)?.id;
}

/**
 * The group a layer is ranked within for an area, from its code: crime
 * deprivation within each nation, vehicle crime within Scotland or within England
 * and Wales together (never a single nation). Undefined for a layer ranked across
 * GB, or an unknown code.
 */
export function rankingGroup(key: string, code: string | null | undefined): RankingGroup | undefined {
  const nation = nationOf(code);
  if (!nation) return undefined;
  if (key === 'vehicle_crime') return nation === 'scotland' ? 'Scotland' : 'England and Wales';
  if (key === 'imd_crime') return NATIONS.find((n) => n.id === nation)!.label as RankingGroup;
  return undefined;
}

/** Build an O(1) lookup of lsoa code -> feature from the loaded GeoJSON. */
export function buildLookup(fc: FeatureCollection): Map<string, Feature> {
  const m = new Map<string, Feature>();
  for (const f of fc.features) {
    const code = (f.properties as LsoaProps | null)?.lsoa11cd;
    if (code) m.set(String(code), f);
  }
  return m;
}

// Any depth of GeoJSON coordinate nesting (Point .. MultiPolygon).
type NestedPositions = Position | NestedPositions[];
const isPosition = (c: NestedPositions): c is Position => typeof c[0] === 'number';

/** Bounding box of a (Multi)Polygon feature: [[w,s],[e,n]]. */
export function featureBounds(
  feature: Feature
): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords: NestedPositions) => {
    if (isPosition(coords)) {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      for (const c of coords) visit(c);
    }
  };
  const g = feature.geometry;
  if (!g || g.type === 'GeometryCollection') return null;
  visit(g.coordinates);
  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

/** One bbox around two features (a comparison framed together); null if either has none. */
export function unionBounds(
  a: Feature | undefined,
  b: Feature | undefined
): [[number, number], [number, number]] | null {
  const ba = a ? featureBounds(a) : null;
  const bb = b ? featureBounds(b) : null;
  if (!ba || !bb) return null;
  return [
    [Math.min(ba[0][0], bb[0][0]), Math.min(ba[0][1], bb[0][1])],
    [Math.max(ba[1][0], bb[1][0]), Math.max(ba[1][1], bb[1][1])],
  ];
}

/** Centre of a bbox — used to drop a marker on the selected area. */
export const boundsCentre = (
  b: [[number, number], [number, number]]
): [number, number] => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];

/** Ray-casting point-in-ring test ([lng,lat] pairs). */
function pointInRing(lng: number, lat: number, ring: Position[]): boolean {
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
export function pointInFeature(lng: number, lat: number, feature: Feature): boolean {
  const g = feature.geometry;
  if (!g) return false;
  const polys: Position[][][] =
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
  const premiumLow = props.premium_low as number | undefined;
  const premiumHigh = props.premium_high as number | undefined;

  const baseline = props.premium_baseline as number | undefined;
  const steps = baseline == null
    ? undefined
    : WATERFALL_ORDER.map((key) => ({
        key,
        label: COMPONENT_LABELS[key] ?? key,
        percentile: props[`${key}_pct`] as number | undefined,
        step: Number(props[`${key}_contrib`] ?? 0),
        kind: (PLACE_KEYS.has(key) ? 'place' : 'composition') as 'place' | 'composition',
        rankedWithin: rankingGroup(key, props.lsoa11cd as string | undefined),
      }));

  return {
    title: props.lsoa_name ? String(props.lsoa_name) : String(props.lsoa11cd),
    subtitle: `LSOA ${props.lsoa11cd}`,
    lsoa11cd: String(props.lsoa11cd),
    risk_index: Number(props.risk_index),
    quintile: readQuintile(props),
    calibrated_premium: full,
    premium_low: premiumLow,
    premium_high: premiumHigh,
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
    const p = f.properties as LsoaProps | null;
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
    const v = (f.properties as LsoaProps | null)?.[fieldName];
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
  props: Record<string, unknown>
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

// ---------------------------------------------------------------------------
// Plain-language explanation of the waterfall
// ---------------------------------------------------------------------------

/** A factor is named in the sentence only if its £ step is at least this. */
export const EXPLAIN_MIN_STEP_GBP = 10;

// Lower-case names that read inside a sentence.
const SENTENCE_LABELS: Record<string, string> = {
  vehicle_crime: 'vehicle crime',
  imd_crime: 'crime deprivation',
  aadf_intensity: 'traffic intensity',
  young_driver_share: 'young drivers',
  cars_per_household: 'cars per household',
};

const signedGbp = (n: number): string => `${n >= 0 ? '+' : '−'}${gbp(Math.abs(n))}`;

const factorName = (s: WaterfallStep): string => SENTENCE_LABELS[s.key] ?? s.label.toLowerCase();

const percentilePhrase = (s: WaterfallStep): string | null =>
  s.percentile == null
    ? null
    : `${ordinalPct(s.percentile)} percentile${s.rankedWithin ? ` within ${s.rankedWithin}` : ''}`;

/** "young drivers (91st percentile, +£142)" */
const namedWithStep = (s: WaterfallStep): string => {
  const pct = percentilePhrase(s);
  return `${factorName(s)} (${pct ? `${pct}, ` : ''}${signedGbp(s.step)})`;
};

/**
 * One plain sentence for a stranger: the largest one or two factors moving the
 * price away from a typical GB area, and the largest one pulling the other way.
 * Uses only the waterfall's own figures (no number is recomputed).
 */
export function explainArea(steps: WaterfallStep[], baseline: number, premium: number): string {
  // Compare the figures as the panel shows them (whole pounds).
  const shown = (n: number) => Math.round(Math.abs(n));
  const big = steps
    .filter((s) => shown(s.step) >= EXPLAIN_MIN_STEP_GBP)
    .sort((a, b) => Math.abs(b.step) - Math.abs(a.step));
  const ups = big.filter((s) => s.step > 0);
  const downs = big.filter((s) => s.step < 0);
  const gap = Math.round(premium) - Math.round(baseline);

  if (Math.abs(gap) < EXPLAIN_MIN_STEP_GBP) {
    if (ups.length && downs.length) {
      return `Close to a typical GB area: ${namedWithStep(ups[0])} and ${namedWithStep(downs[0])} roughly cancel out.`;
    }
    return `Close to a typical GB area: no single factor moves it by ${gbp(EXPLAIN_MIN_STEP_GBP)} or more.`;
  }

  const dearer = gap > 0;
  const towards = dearer ? ups : downs;
  const against = dearer ? downs : ups;
  const lead = `${dearer ? 'Dearer' : 'Cheaper'} than a typical GB area`;
  const small = `several small factors, none of them ${gbp(EXPLAIN_MIN_STEP_GBP)} or more`;
  const counter = against[0];
  const counterName = () => {
    const pct = percentilePhrase(counter);
    return `${factorName(counter)}${pct ? ` (${pct})` : ''}`;
  };
  // Only a counter-driver is big enough to name: say it the other way round.
  if (!towards.length && counter) {
    return `${lead} despite ${counterName()} pulling the other way ${gbp(Math.abs(counter.step))}, through ${small}.`;
  }
  let sentence = towards.length
    ? `${lead} mainly because of ${towards.slice(0, 2).map(namedWithStep).join(' and ')}`
    : `${lead} through ${small}`;
  if (counter) {
    sentence += `; ${counterName()} ${dearer ? 'pulls it back' : 'pushes it up'} ${gbp(Math.abs(counter.step))}`;
  }
  return `${sentence}.`;
}

/** One side of a two-area comparison: the panel's title and its premium. */
export interface CompareSide { name: string; premium?: number | null; }

/**
 * One sentence comparing two areas' estimated premiums: which is dearer and by
 * how many £ (the difference of the two baked premiums, rounded as `gbp` rounds).
 */
export function compareSummary(a: CompareSide, b: CompareSide): string {
  if (a.premium == null || b.premium == null) {
    const missing = a.premium == null ? a.name : b.name;
    return `${missing} has no premium estimate, so the two cannot be compared.`;
  }
  const gap = Math.round(Math.abs(a.premium - b.premium));
  if (gap === 0) return `${a.name} and ${b.name} have the same estimated premium.`;
  const [dearer, cheaper] = a.premium > b.premium ? [a, b] : [b, a];
  return `${dearer.name} is ${gbp(gap)} a year dearer than ${cheaper.name}.`;
}

/** One side of a waterfall comparison: the area's name, its steps and premium. */
export interface ExplainSide { name: string; steps: WaterfallStep[]; premium: number; }

/**
 * One plain sentence for two areas: which is dearer, by how much, and the one or
 * two drivers that account for most of the gap. The LMDI steps are additive, so a
 * driver's share of the gap is the difference of the two areas' steps for it
 * (AUDIT.md §4). A driver ranked within a group says which, and says so when
 * the groups differ (vehicle crime for a Scottish and an English area).
 */
export function explainDifference(a: ExplainSide, b: ExplainSide): string {
  const gap = Math.round(a.premium) - Math.round(b.premium);
  const [dearer, cheaper] = gap >= 0 ? [a, b] : [b, a];
  const shown = (n: number) => Math.round(Math.abs(n));

  const diffs = dearer.steps
    .map((s) => {
      const other = cheaper.steps.find((o) => o.key === s.key);
      return other ? { s, other, diff: s.step - other.step } : null;
    })
    .filter((d): d is { s: WaterfallStep; other: WaterfallStep; diff: number } => d != null)
    .filter((d) => shown(d.diff) >= EXPLAIN_MIN_STEP_GBP)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  // "vehicle crime", with its ranking group(s) when it has one.
  const name = (d: { s: WaterfallStep; other: WaterfallStep }): string => {
    const base = factorName(d.s);
    const [g1, g2] = [d.s.rankedWithin, d.other.rankedWithin];
    if (g1 === g2) return g1 ? `${base} (both ranked within ${g1})` : base;
    const groups = [
      g1 && `within ${g1} for ${dearer.name}`,
      g2 && `within ${g2} for ${cheaper.name}`,
    ].filter(Boolean);
    return `${base} (ranked ${groups.join(', ')})`;
  };
  // One bracket: "vehicle crime (+£180; ranked within Scotland for …)".
  const named = (d: { s: WaterfallStep; other: WaterfallStep; diff: number }) => {
    const n = name(d);
    const open = n.indexOf(' (');
    return open < 0
      ? `${n} (${signedGbp(d.diff)})`
      : `${n.slice(0, open)} (${signedGbp(d.diff)}; ${n.slice(open + 2)}`;
  };

  const ups = diffs.filter((d) => d.diff > 0);
  const downs = diffs.filter((d) => d.diff < 0);

  if (Math.abs(gap) < EXPLAIN_MIN_STEP_GBP) {
    const lead = `${a.name} and ${b.name} cost about the same`;
    if (ups.length && downs.length) {
      return `${lead}: ${name(ups[0])} and ${name(downs[0])} roughly cancel out.`;
    }
    return `${lead}: no single factor separates them by ${gbp(EXPLAIN_MIN_STEP_GBP)} or more.`;
  }

  const lead = `${dearer.name} costs ${gbp(Math.abs(gap))} a year more than ${cheaper.name}`;
  const small = `several small differences, none of them ${gbp(EXPLAIN_MIN_STEP_GBP)} or more`;
  // Only a counter-driver is big enough to name: say it the other way round.
  if (!ups.length && downs[0]) {
    return `${lead} despite ${name(downs[0])} pulling the other way ${gbp(Math.abs(downs[0].diff))}, through ${small}.`;
  }
  let sentence = ups.length
    ? `${lead}, mainly because of ${ups.slice(0, 2).map(named).join(' and ')}`
    : `${lead} through ${small}`;
  if (downs[0]) sentence += `; ${name(downs[0])} pulls the other way ${gbp(Math.abs(downs[0].diff))}`;
  return `${sentence}.`;
}

/** A figure as the write-up prints it: fixed decimals, en-GB thousands ("41,729", "76.51"). */
export const formatFigure = (n: number, dp = 0): string =>
  n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * "41,729 areas" once the GeoJSON has loaded, a count-free "areas" before: the
 * count is never typed in, so it moves by itself at the next bake.
 */
export const areasLabel = (n: number): string => (n > 0 ? `${formatFigure(n)} areas` : 'areas');

/** The rankings' name for all of GB (the README's own title, "Great Britain"). */
export const GB_LABEL = 'Great Britain';

/** The rankings' scope line: "Wales · N areas", or "Great Britain · N areas" for
 *  All; empty until the areas have loaded. */
export function rankingsScope(nation: Nation | null, count: number): string {
  if (count <= 0) return '';
  const label = NATIONS.find((n) => n.id === nation)?.label ?? GB_LABEL;
  return `${label} · ${areasLabel(count)}`;
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

/** A small p-value as the write-up prints it: 3.7458e-6 -> "3.7×10⁻⁶". */
export function formatSci(n: number, dp = 1): string {
  const [mantissa, exp] = n.toExponential(dp).split('e');
  const power = String(Number(exp)).split('').map((c) => SUPERSCRIPT[c] ?? c).join('');
  return `${mantissa}×10${power}`;
}

/**
 * What a tap on the map says while the areas cannot answer it yet: the streamed tiles
 * colour the map long before the GeoJSON behind the area details has downloaded.
 * Null once the areas are drawn (a tap then selects as normal).
 */
export function tapFeedback(
  areasDrawn: boolean,
  tilesDrawn: boolean,
  loadedBytes: number
): string | null {
  if (areasDrawn) return null;
  if (!tilesDrawn) return 'The map is still loading';
  const base = 'Area details arrive once the map data has loaded';
  return loadedBytes > 0 ? `${base} (${(loadedBytes / 1e6).toFixed(1)} MB so far)` : base;
}
