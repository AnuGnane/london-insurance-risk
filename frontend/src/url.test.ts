import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildShareUrl,
  pageTitle,
  parseShareUrl,
  SHARE_BASE,
  VALID_FILTERS,
  type ShareState,
} from './url';
import { COLOR_MODES } from './utils';

const EMPTY: ShareState = { area: null, area2: null, pc: null, filter: 'composite', nation: null };

describe('parseShareUrl', () => {
  it.each([
    ['', EMPTY],
    ['?area=E01000001', { ...EMPTY, area: 'E01000001' }],
    ['?area=E01000001&area2=S01006877', { ...EMPTY, area: 'E01000001', area2: 'S01006877' }],
    // A second area with no main area to compare against is dropped.
    ['?area2=S01006877', EMPTY],
    // A postcode alone is kept: it is resolved to its area on load.
    ['?pc=E1+6AN', { ...EMPTY, pc: 'E1 6AN' }],
    ['?pc=E1%206AN&area=E01004307', { ...EMPTY, pc: 'E1 6AN', area: 'E01004307' }],
    ['?filter=flood_risk', { ...EMPTY, filter: 'flood_risk' }],
    ['?filter=ksi_collisions_per_billion_vehicle_miles', { ...EMPTY, filter: 'ksi_collisions_per_billion_vehicle_miles' }],
    // Unknown or composite filters fall back to the premium.
    ['?filter=nonsense', EMPTY],
    ['?filter=composite', EMPTY],
    ['?nation=wales', { ...EMPTY, nation: 'wales' }],
    ['?nation=scotland', { ...EMPTY, nation: 'scotland' }],
    // Unknown nations fall back to all of GB.
    ['?nation=ireland', EMPTY],
    ['?nation=Wales', EMPTY],
  ] as const)('%j', (search, want) => {
    expect(parseShareUrl(search)).toEqual(want);
  });
});

describe('buildShareUrl', () => {
  const path = '/london-insurance-risk/';

  it.each([
    // An empty state is the bare path.
    [EMPTY, path],
    [{ ...EMPTY, area: 'E01000001' }, `${path}?area=E01000001`],
    [
      { ...EMPTY, area: 'E01000001', area2: 'S01006877' },
      `${path}?area=E01000001&area2=S01006877`,
    ],
    // No second area without a main one.
    [{ ...EMPTY, area2: 'S01006877' }, path],
    // No postcode without the area it resolved to.
    [{ ...EMPTY, pc: 'E1 6AN' }, path],
    [{ ...EMPTY, pc: 'E1 6AN', area: 'E01004307' }, `${path}?pc=E1+6AN&area=E01004307`],
    [{ ...EMPTY, filter: 'composite' }, path],
    [{ ...EMPTY, filter: 'flood_risk' }, `${path}?filter=flood_risk`],
    [{ ...EMPTY, nation: 'scotland' }, `${path}?nation=scotland`],
    [
      { area: 'E01000001', area2: 'S01006877', pc: 'EC1A 1BB', filter: 'deprivation', nation: 'england' },
      `${path}?pc=EC1A+1BB&area=E01000001&area2=S01006877&filter=deprivation&nation=england`,
    ],
  ] as const)('%j', (state, want) => {
    expect(buildShareUrl(path, state)).toBe(want);
  });

  it('round-trips a full state', () => {
    const state: ShareState = {
      area: 'E01000001',
      area2: 'W01000001',
      pc: 'EC1A 1BB',
      filter: 'aadf_intensity',
      nation: 'wales',
    };
    const url = buildShareUrl(path, state);
    expect(parseShareUrl(url.slice(path.length))).toEqual(state);
  });
});

describe('VALID_FILTERS', () => {
  // The list App.tsx held as a literal before it was derived from COLOR_MODES.
  const BEFORE = [
    'vehicle_crime',
    'imd_crime',
    'young_driver_share',
    'cars_per_household',
    'road_casualties',
    'deprivation',
    'flood_risk',
    'population_density',
    'aadf_intensity',
    'traffic_per_capita',
    'ksi_collisions_per_billion_vehicle_miles',
  ];

  it('is the same set of filters as before the refactor', () => {
    expect([...VALID_FILTERS].sort()).toEqual([...BEFORE].sort());
  });

  it('is every colour mode but the premium', () => {
    expect(VALID_FILTERS).not.toContain('composite');
    expect(VALID_FILTERS).toHaveLength(COLOR_MODES.length - 1);
  });
});

describe('pageTitle', () => {
  const BASE = 'The Price of Place — GB car-insurance risk map';
  it('is the base alone with no area', () => {
    expect(pageTitle(BASE)).toBe(BASE);
    expect(pageTitle(BASE, '')).toBe(BASE);
  });
  it('puts one area before the base', () => {
    expect(pageTitle(BASE, 'Tower Hamlets 021A')).toBe(`Tower Hamlets 021A · ${BASE}`);
  });
  it('names both areas of a comparison', () => {
    expect(pageTitle(BASE, 'Tower Hamlets 021A', 'Rugby 004B')).toBe(
      `Tower Hamlets 021A vs Rugby 004B · ${BASE}`
    );
  });
  it('falls back to the one-area form on an empty compare title', () => {
    expect(pageTitle(BASE, 'Tower Hamlets 021A', '')).toBe(`Tower Hamlets 021A · ${BASE}`);
  });
});

describe('title sources', () => {
  const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  it('ShareButton builds its title through pageTitle, not by hand', () => {
    const share = src('ShareButton.tsx');
    expect(share).toContain('pageTitle(SHARE_BASE');
    expect(share).not.toContain(SHARE_BASE);
  });
  it('App reads the base title from the document rather than typing it', () => {
    const app = src('App.tsx');
    expect(app).toContain('useRef(document.title)');
    expect(app).not.toContain('GB car-insurance risk map');
  });
});
