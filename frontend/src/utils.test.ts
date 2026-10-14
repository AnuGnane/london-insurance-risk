import { describe, expect, it } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import type { LsoaProps, WaterfallStep } from './types';
import {
  buildLookup,
  compareSummary,
  computeDistribution,
  dominantDriver,
  EXPLAIN_MIN_STEP_GBP,
  explainArea,
  explainDifference,
  featureAtPoint,
  featureBounds,
  featureToDetail,
  nationOf,
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

describe('explainArea', () => {
  const step = (key: string, value: number, percentile?: number, extra: Partial<WaterfallStep> = {}): WaterfallStep => ({
    key,
    label: key,
    step: value,
    percentile,
    kind: ['young_driver_share', 'cars_per_household'].includes(key) ? 'composition' : 'place',
    ...extra,
  });

  it('explains a cheaper area from its own waterfall', () => {
    const d = featureToDetail(CITY);
    expect(explainArea(d.steps!, d.premium_baseline!, d.calibrated_premium!)).toBe(
      'Cheaper than a typical GB area mainly because of crime deprivation (1st percentile, −£145) ' +
        'and young drivers (16th percentile, −£130); cars per household (2nd percentile) pushes it up £83.'
    );
  });

  it('explains a dearer area with the largest factor pulling it back', () => {
    const steps = [
      step('young_driver_share', 142, 91),
      step('imd_crime', 88, 80),
      step('vehicle_crime', 30, 70),
      step('cars_per_household', -40, 20),
      step('aadf_intensity', -12, 40),
    ];
    expect(explainArea(steps, 541, 749)).toBe(
      'Dearer than a typical GB area mainly because of young drivers (91st percentile, +£142) ' +
        'and crime deprivation (80th percentile, +£88); cars per household (20th percentile) pulls it back £40.'
    );
  });

  it(`names a factor only if its step is at least £${EXPLAIN_MIN_STEP_GBP}`, () => {
    const steps = [
      step('vehicle_crime', 25, 70),
      step('imd_crime', EXPLAIN_MIN_STEP_GBP - 1, 60),
      step('cars_per_household', -(EXPLAIN_MIN_STEP_GBP - 1), 40),
    ];
    expect(explainArea(steps, 500, 541)).toBe(
      'Dearer than a typical GB area mainly because of vehicle crime (70th percentile, +£25).'
    );
  });

  it('does not call an area close when a factor moves it', () => {
    const steps = [
      step('vehicle_crime', 9, 60), step('imd_crime', 9, 60), step('aadf_intensity', 9, 60),
      step('young_driver_share', 9, 60), step('cars_per_household', -12, 30),
    ];
    expect(explainArea(steps, 541, 565)).toBe(
      'Dearer than a typical GB area through several small factors, none of them £10 or more; ' +
        'cars per household (30th percentile) pulls it back £12.'
    );
  });

  it('says when factors cancel out', () => {
    const steps = [step('vehicle_crime', 80, 90), step('young_driver_share', -80, 10)];
    expect(explainArea(steps, 541, 541)).toBe(
      'Close to a typical GB area: vehicle crime (90th percentile, +£80) and ' +
        'young drivers (10th percentile, −£80) roughly cancel out.'
    );
  });

  it('applies the threshold to the pounds as shown', () => {
    expect(explainArea([step('vehicle_crime', 9.6, 60)], 541, 551)).toBe(
      'Dearer than a typical GB area mainly because of vehicle crime (60th percentile, +£10).'
    );
  });

  it('says so when nothing moves the price much', () => {
    const steps = [step('vehicle_crime', 4, 55), step('imd_crime', -3, 45)];
    expect(explainArea(steps, 541, 542)).toBe(
      `Close to a typical GB area: no single factor moves it by £${EXPLAIN_MIN_STEP_GBP} or more.`
    );
  });

  it('keeps the Scotland flag on vehicle crime', () => {
    const steps = [step('vehicle_crime', 60, 95, { withinScotland: true })];
    expect(explainArea(steps, 500, 560)).toContain('vehicle crime (95th percentile within Scotland, +£60)');
  });
});

describe('nationOf', () => {
  it('reads the nation from the first letter of the area code', () => {
    expect(nationOf('E01000001')).toBe('england');
    expect(nationOf('W01000001')).toBe('wales');
    expect(nationOf('S01006506')).toBe('scotland');
  });
  it('returns undefined for an unknown prefix or no code', () => {
    expect(nationOf('N01000001')).toBeUndefined();
    expect(nationOf('95AA01S1')).toBeUndefined();
    expect(nationOf('')).toBeUndefined();
    expect(nationOf(undefined)).toBeUndefined();
  });
});

describe('compareSummary', () => {
  it('names the dearer area and the £ gap, whichever side it is on', () => {
    const a = { name: 'City of London 001A', premium: 1210.4 };
    const b = { name: 'Westminster 018C', premium: 980.2 };
    const expected = 'City of London 001A is £230 a year dearer than Westminster 018C.';
    expect(compareSummary(a, b)).toBe(expected);
    expect(compareSummary(b, a)).toBe(expected);
  });
  it('formats thousands the way gbp does', () => {
    expect(compareSummary({ name: 'A', premium: 400 }, { name: 'B', premium: 1578 })).toBe(
      'B is £1,178 a year dearer than A.'
    );
  });
  it('calls a gap that rounds to £0 the same premium', () => {
    expect(compareSummary({ name: 'A', premium: 500.2 }, { name: 'B', premium: 500.4 })).toBe(
      'A and B have the same estimated premium.'
    );
  });
  it('says so when either side has no premium', () => {
    expect(compareSummary({ name: 'A' }, { name: 'B', premium: 500 })).toBe(
      'A has no premium estimate, so the two cannot be compared.'
    );
    expect(compareSummary({ name: 'A', premium: 500 }, { name: 'B', premium: null })).toBe(
      'B has no premium estimate, so the two cannot be compared.'
    );
  });
});

describe('explainDifference', () => {
  const step = (key: string, value: number, extra: Partial<WaterfallStep> = {}): WaterfallStep => ({
    key,
    label: key,
    step: value,
    kind: ['young_driver_share', 'cars_per_household'].includes(key) ? 'composition' : 'place',
    ...extra,
  });
  const side = (name: string, premium: number, steps: WaterfallStep[]) => ({ name, premium, steps });

  it('names a single clear driver, whichever side is dearer', () => {
    const a = side('Westminster 017A', 900, [step('vehicle_crime', 250), step('imd_crime', 5)]);
    const b = side('City of London 001A', 650, [step('vehicle_crime', 2), step('imd_crime', 3)]);
    const expected =
      'Westminster 017A costs £250 a year more than City of London 001A, mainly because of vehicle crime (+£248).';
    expect(explainDifference(a, b)).toBe(expected);
    expect(explainDifference(b, a)).toBe(expected);
  });

  it('names the two largest drivers and the one pulling the other way', () => {
    const a = side('A', 800, [
      step('young_driver_share', 120),
      step('imd_crime', 80),
      step('aadf_intensity', 15),
      step('cars_per_household', -30),
    ]);
    const b = side('B', 600, [
      step('young_driver_share', 10),
      step('imd_crime', 0),
      step('aadf_intensity', 0),
      step('cars_per_household', 15),
    ]);
    expect(explainDifference(a, b)).toBe(
      'A costs £200 a year more than B, mainly because of young drivers (+£110) and crime deprivation (+£80); cars per household pulls the other way £45.'
    );
  });

  it(`calls a gap under £${EXPLAIN_MIN_STEP_GBP} about the same`, () => {
    const quiet = explainDifference(
      side('A', 505, [step('vehicle_crime', 4)]),
      side('B', 500, [step('vehicle_crime', 0)])
    );
    expect(quiet).toBe(
      `A and B cost about the same: no single factor separates them by £${EXPLAIN_MIN_STEP_GBP} or more.`
    );
    const offset = explainDifference(
      side('A', 503, [step('vehicle_crime', 40), step('young_driver_share', -37)]),
      side('B', 500, [step('vehicle_crime', 0), step('young_driver_share', 0)])
    );
    expect(offset).toBe('A and B cost about the same: vehicle crime and young drivers roughly cancel out.');
  });

  it('says when vehicle crime is ranked in different groups for the two areas', () => {
    const scot = side('Glasgow 012B', 900, [step('vehicle_crime', 200, { withinScotland: true })]);
    const eng = side('Leeds 044C', 700, [step('vehicle_crime', 20)]);
    expect(explainDifference(scot, eng)).toBe(
      'Glasgow 012B costs £200 a year more than Leeds 044C, mainly because of vehicle crime ' +
        '(ranked within Scotland for Glasgow 012B, within England and Wales for Leeds 044C) (+£180).'
    );
    const scot2 = side('Dundee 003A', 600, [step('vehicle_crime', 0, { withinScotland: true })]);
    expect(explainDifference(scot, scot2)).toContain('vehicle crime (both ranked within Scotland) (+£200)');
  });
});
