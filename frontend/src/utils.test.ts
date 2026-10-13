import { describe, expect, it } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import type { LsoaProps } from './types';
import {
  buildLookup,
  computeDistribution,
  dominantDriver,
  featureAtPoint,
  featureBounds,
  featureToDetail,
  gbp,
  MODEL_DRIVERS,
  ordinalPct,
  premiumToRampPos,
  quintilePremiumBands,
  WATERFALL_ORDER,
} from './utils';

// A closed axis-aligned square ring [x0,y0]..[x1,y1].
const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
  [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
];

const area = (code: string, rings: number[][][], props: Partial<LsoaProps> = {}): Feature => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: rings } as Polygon,
  properties: { lsoa11cd: code, risk_index: 50, ...props },
});

const lookupOf = (features: Feature[]) =>
  buildLookup({ type: 'FeatureCollection', features });

// Mirrors E01000001 (City of London 001A) in the committed areas.geojson.
const CITY: LsoaProps = {
  lsoa11cd: 'E01000001',
  lsoa_name: 'City of London 001A',
  calibrated_premium: 381,
  premium_place_only: 422,
  premium_baseline: 541,
  premium_low: 266,
  premium_high: 601,
  risk_index: 28,
  quintile: 2,
  vehicle_crime_pct: 89.4,
  vehicle_crime_contrib: 34,
  aadf_intensity_pct: 47.8,
  aadf_intensity_contrib: -2,
  imd_crime_pct: 0.7,
  imd_crime_contrib: -145,
  young_driver_share_pct: 16.1,
  young_driver_share_contrib: -130,
  cars_per_household_pct: 1.5,
  cars_per_household_contrib: 83,
  deprivation_pct: 11,
  flood_risk_pct: 23,
};

describe('gbp', () => {
  it('rounds and adds thousands separators', () => {
    expect(gbp(1180)).toBe('£1,180');
    expect(gbp(380.6)).toBe('£381');
    expect(gbp(0)).toBe('£0');
  });
  it('shows a dash for missing values', () => {
    expect(gbp(null)).toBe('—');
    expect(gbp(undefined)).toBe('—');
  });
});

describe('ordinalPct', () => {
  it.each([
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'],
    [11, '11th'], [12, '12th'], [13, '13th'],
    [21, '21st'], [22, '22nd'], [23, '23rd'],
    [91, '91st'], [100, '100th'], [111, '111th'],
  ])('%i -> %s', (n, want) => {
    expect(ordinalPct(n)).toBe(want);
  });
  it('rounds before choosing the suffix', () => {
    expect(ordinalPct(21.4)).toBe('21st');
    expect(ordinalPct(11.6)).toBe('12th');
  });
  it('shows a dash for missing or non-finite values', () => {
    expect(ordinalPct(null)).toBe('—');
    expect(ordinalPct(NaN)).toBe('—');
  });
});

describe('featureBounds', () => {
  it('bounds a polygon', () => {
    expect(featureBounds(area('A', [square(-1, 50, 2, 53)]))).toEqual([[-1, 50], [2, 53]]);
  });
  it('bounds every part of a multipolygon', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[square(0, 0, 1, 1)], [square(5, -2, 6, 3)]],
      },
      properties: {},
    };
    expect(featureBounds(f)).toEqual([[0, -2], [6, 3]]);
  });
  it('returns null without a geometry', () => {
    expect(featureBounds({ type: 'Feature', geometry: null, properties: {} } as unknown as Feature))
      .toBeNull();
  });
});

describe('featureAtPoint', () => {
  it('finds the polygon containing the point', () => {
    const a = area('A', [square(0, 0, 1, 1)]);
    const b = area('B', [square(1, 0, 2, 1)]);
    expect(featureAtPoint([a, b], 1.5, 0.5)).toBe(b);
    expect(featureAtPoint([a, b], 0.5, 0.5)).toBe(a);
  });
  it('skips a polygon when the point is in one of its holes', () => {
    const donut = area('DONUT', [square(0, 0, 10, 10), square(4, 4, 6, 6)]);
    const island = area('ISLAND', [square(4, 4, 6, 6)]);
    expect(featureAtPoint([donut, island], 5, 5)).toBe(island);
    expect(featureAtPoint([donut, island], 2, 2)).toBe(donut);
  });
  it('falls back to the nearest area for a point in a simplification gap', () => {
    const a = area('A', [square(0, 0, 1, 1)]);
    const b = area('B', [square(1.1, 0, 2.1, 1)]);
    // In neither polygon; A's bbox centre (0.5, 0.5) is nearer than B's (1.6, 0.5).
    expect(featureAtPoint([a, b], 1.04, 0.5)).toBe(a);
    expect(featureAtPoint([a, b], 1.07, 0.5)).toBe(b);
  });
  it('returns null for no features', () => {
    expect(featureAtPoint([], 0, 0)).toBeNull();
  });
});

describe('quintilePremiumBands', () => {
  it('gives the £ min and max per quintile, sorted', () => {
    const lookup = lookupOf([
      area('A', [square(0, 0, 1, 1)], { quintile: 2, calibrated_premium: 300 }),
      area('B', [square(0, 0, 1, 1)], { quintile: 1, calibrated_premium: 200 }),
      area('C', [square(0, 0, 1, 1)], { quintile: 1, calibrated_premium: 100 }),
      area('D', [square(0, 0, 1, 1)], { quintile: 2, calibrated_premium: 450 }),
      area('E', [square(0, 0, 1, 1)], { calibrated_premium: 999 }), // no quintile
      area('F', [square(0, 0, 1, 1)], { quintile: 3 }),             // no premium
    ]);
    expect(quintilePremiumBands(lookup)).toEqual([
      { q: 1, min: 100, max: 200 },
      { q: 2, min: 300, max: 450 },
    ]);
  });
});

describe('premiumToRampPos', () => {
  const bands = [
    { q: 1, min: 100, max: 200 },
    { q: 2, min: 300, max: 400 },
  ];
  it('places a value within its band segment', () => {
    expect(premiumToRampPos(150, bands)).toBeCloseTo(0.25);
    expect(premiumToRampPos(350, bands)).toBeCloseTo(0.75);
    expect(premiumToRampPos(200, bands)).toBeCloseTo(0.5);
  });
  it('clamps values outside the range', () => {
    expect(premiumToRampPos(50, bands)).toBe(0);
    expect(premiumToRampPos(1000, bands)).toBe(1);
  });
  it('puts a value between bands at the start of the next band', () => {
    expect(premiumToRampPos(250, bands)).toBeCloseTo(0.5);
  });
  it('returns 0 with no bands', () => {
    expect(premiumToRampPos(500, [])).toBe(0);
  });
});

describe('computeDistribution', () => {
  const lookup = lookupOf(
    Array.from({ length: 100 }, (_, i) =>
      area(`A${i}`, [square(0, 0, 1, 1)], { x: i })
    )
  );
  it('bins the values and locates the selected one', () => {
    const d = computeDistribution(lookup, 'x', 50, 0)!;
    expect(d.bins).toHaveLength(20);
    expect(Math.max(...d.bins)).toBe(1);
    expect(d.selectedBin).toBe(10);
    expect(d.percentileRank).toBe(50);
    expect(d.avgBin).toBe(0);
  });
  it('puts the maximum in the last bin', () => {
    expect(computeDistribution(lookup, 'x', 99)!.selectedBin).toBe(19);
  });
  it('leaves avgBin undefined without a reference value', () => {
    expect(computeDistribution(lookup, 'x', 10)!.avgBin).toBeUndefined();
  });
  it('returns null for too few or constant values', () => {
    const few = lookupOf([area('A', [square(0, 0, 1, 1)], { x: 1 })]);
    expect(computeDistribution(few, 'x', 1)).toBeNull();
    const flat = lookupOf(
      Array.from({ length: 20 }, (_, i) => area(`F${i}`, [square(0, 0, 1, 1)], { x: 7 }))
    );
    expect(computeDistribution(flat, 'x', 7)).toBeNull();
  });
});

describe('featureToDetail', () => {
  const d = featureToDetail(CITY);
  it('carries the headline figures', () => {
    expect(d.title).toBe('City of London 001A');
    expect(d.subtitle).toBe('LSOA E01000001');
    expect(d.quintile).toBe(2);
    expect(d.calibrated_premium).toBe(381);
    expect(d.premium_low).toBe(266);
    expect(d.premium_high).toBe(601);
    expect(d.premium_place_only).toBe(422);
    expect(d.composition_uplift).toBe(381 - 422);
    expect(d.premium_baseline).toBe(541);
  });
  it('builds the waterfall in display order, summing to the premium', () => {
    expect(d.steps!.map((s) => s.key)).toEqual([...WATERFALL_ORDER]);
    const total = d.premium_baseline! + d.steps!.reduce((s, x) => s + x.step, 0);
    expect(total).toBe(381);
    expect(d.steps!.find((s) => s.key === 'young_driver_share')!.kind).toBe('composition');
    expect(d.steps!.find((s) => s.key === 'imd_crime')!.kind).toBe('place');
  });
  it('separates model drivers from diagnostics and drops absent layers', () => {
    const kinds = Object.fromEntries(d.components.map((c) => [c.key, c.kind]));
    for (const k of MODEL_DRIVERS) expect(kinds[k]).toBe('driver');
    expect(kinds.deprivation).toBe('diagnostic');
    expect(kinds.flood_risk).toBe('diagnostic');
    expect(kinds.road_casualties).toBeUndefined();
  });
  it('flags vehicle crime as within-Scotland only for Scottish areas', () => {
    const flag = (props: LsoaProps) =>
      featureToDetail(props).steps!.find((s) => s.key === 'vehicle_crime')!.withinScotland;
    expect(flag(CITY)).toBe(false);
    expect(flag({ ...CITY, lsoa11cd: 'S01006506' })).toBe(true);
  });
  it('omits the waterfall without a baseline and falls back to the code as title', () => {
    const bare = featureToDetail({ lsoa11cd: 'W01000001', risk_index: 10, quintile: 1 });
    expect(bare.steps).toBeUndefined();
    expect(bare.title).toBe('W01000001');
    expect(bare.composition_uplift).toBeUndefined();
  });
  it('reads the legacy risk_bucket name for the quintile', () => {
    expect(featureToDetail({ lsoa11cd: 'E1', risk_index: 1, risk_bucket: 4 }).quintile).toBe(4);
  });
});

describe('dominantDriver', () => {
  it('picks the largest move in either direction, with its sign', () => {
    expect(dominantDriver(CITY)).toEqual({ key: 'imd_crime', dir: 'down' });
    expect(dominantDriver({ ...CITY, vehicle_crime_contrib: 200 })).toEqual({
      key: 'vehicle_crime',
      dir: 'up',
    });
  });
  it('returns null when no driver carries a contribution', () => {
    expect(dominantDriver({ lsoa11cd: 'E1' })).toBeNull();
  });
});
