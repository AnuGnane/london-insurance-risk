import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Feature } from 'geojson';
import { countRankable, getGeojson, getMethodology, getRankings } from './api';
import type { LsoaProps } from './types';
import { buildLookup } from './utils';

const area = (code: string, props: Partial<LsoaProps>): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { lsoa11cd: code, risk_index: 50, ...props },
});

describe('getRankings', () => {
  const lookup = buildLookup({
    type: 'FeatureCollection',
    features: [
      area('E01', { lsoa_name: 'Cheap', calibrated_premium: 300, quintile: 1 }),
      area('E02', { lsoa_name: 'Dear', calibrated_premium: 900, quintile: 5 }),
      area('E03', { calibrated_premium: 600, quintile: 3 }),
      area('E04', { lsoa_name: 'No premium', quintile: 2 }),
    ],
  });
  it('sorts by premium, dearest first', () => {
    expect(getRankings(lookup, 'desc').map((r) => r.code)).toEqual(['E02', 'E03', 'E01']);
  });
  it('sorts cheapest first and honours n', () => {
    expect(getRankings(lookup, 'asc', 2).map((r) => r.code)).toEqual(['E01', 'E03']);
  });
  it('shapes rows and falls back to the code when unnamed', () => {
    const [top, mid] = getRankings(lookup, 'desc');
    expect(top).toEqual({
      code: 'E02',
      name: 'Dear',
      risk_index: 50,
      quintile: 5,
      calibrated_premium: 900,
    });
    expect(mid.name).toBe('E03');
  });
});

describe('getRankings by nation', () => {
  // Twelve areas per nation, so a nation's ten is a real cut. English areas are
  // dearest overall: an unfiltered top ten would hold no Welsh or Scottish area.
  const features: Feature[] = [];
  const base = { E: 2000, W: 1000, S: 0 } as const;
  for (const prefix of ['E', 'W', 'S'] as const) {
    for (let i = 0; i < 12; i++) {
      const code = `${prefix}0100${String(i).padStart(4, '0')}`;
      features.push(area(code, { calibrated_premium: base[prefix] + 500 + i, quintile: 3 }));
    }
  }
  features.push(area('N01000001', { calibrated_premium: 9999, quintile: 5 }));
  const lookup = buildLookup({ type: 'FeatureCollection', features });

  it.each(['england', 'wales', 'scotland'] as const)(
    'gives %s its own ten, dearest first',
    (nation) => {
      const rows = getRankings(lookup, 'desc', 10, nation);
      const prefix = nation.charAt(0).toUpperCase();
      expect(rows).toHaveLength(10);
      expect(rows.every((r) => r.code.startsWith(prefix))).toBe(true);
      expect(rows[0].code).toBe(`${prefix}01000011`);
    }
  );
  it('cuts after filtering for the cheapest too', () => {
    const rows = getRankings(lookup, 'asc', 10, 'wales');
    expect(rows.map((r) => r.code)).toEqual(
      Array.from({ length: 10 }, (_, i) => `W0100${String(i).padStart(4, '0')}`)
    );
  });
  it('leaves All (no nation) unchanged, unknown prefixes included', () => {
    const rows = getRankings(lookup, 'desc', 10);
    expect(rows[0].code).toBe('N01000001');
    expect(rows.slice(1).every((r) => r.code.startsWith('E'))).toBe(true);
  });
  it('counts the areas each list ranks from', () => {
    expect(countRankable(lookup)).toBe(37);
    expect(countRankable(lookup, 'wales')).toBe(12);
  });
});

describe('getMethodology', () => {
  const committed = readFileSync(
    new URL('../public/data/methodology.json', import.meta.url),
    'utf8'
  );
  const raw = JSON.parse(committed);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shapes the committed methodology.json for the panel', async () => {
    const fetchStub = vi.fn(async () => new Response(committed, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    const m = (await getMethodology())!;

    expect(String(fetchStub.mock.calls[0])).toMatch(/data\/methodology\.json$/);
    expect(m.normalisation).toBe(raw.feature_basis);
    expect(m.r_squared).toBe(raw.r_squared);
    expect(m.cv_r_squared).toBe(raw.ridge_cv.cv_r_squared_mean);
    expect(m.loao_mae).toBe(raw.leave_one_area_out.mae_gbp);
    expect(m.spearman).toBe(raw.spearman_pred_vs_actual.rho);
    expect(m.n_matched).toBe(raw.n_matched);
    expect(m.n_areas).toBe(raw.n_areas);
    expect(m.n_quarters).toBe(raw.n_quarters);
    expect(m.national_avg).toBe(raw.national_avg_latest);

    expect(Object.keys(m.feature_analysis!)).toEqual(Object.keys(raw.feature_analysis));
    for (const [k, v] of Object.entries(m.feature_analysis!)) {
      const src = raw.feature_analysis[k];
      expect(v).toEqual({
        bucket: src.bucket,
        partial_r: src.partial_r,
        vif: src.vif,
        verdict: src.verdict,
      });
    }

    const xs = raw.cross_source_agreement.moneysupermarket;
    expect(m.cross_source!.name).toBe('MoneySuperMarket');
    expect(m.cross_source!.spearman).toBe(xs.spearman_pred_vs_actual?.rho);
    expect(m.cross_source!.rows).toEqual(
      xs.rows.map((r: { area_name: string; actual_gbp: number; predicted_gbp: number }) => ({
        area_name: r.area_name,
        actual_gbp: r.actual_gbp,
        predicted_gbp: r.predicted_gbp,
      }))
    );
  });

  it('returns null when the file is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await getMethodology()).toBeNull();
  });

  it('returns null when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await getMethodology()).toBeNull();
  });
});

describe('getGeojson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const body = JSON.stringify({ type: 'FeatureCollection', features: [area('E01', { quintile: 3 })] });

  it('streams the body, reports bytes received, and parses it', async () => {
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 10));
        c.enqueue(bytes.slice(10));
        c.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })));
    const seen: number[] = [];
    const fc = await getGeojson((n) => seen.push(n));
    expect(fc.features).toHaveLength(1);
    expect(seen.at(-1)).toBe(bytes.byteLength);
  });

  it('works without a progress callback and fails clearly on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    expect((await getGeojson()).features).toHaveLength(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(getGeojson()).rejects.toThrow('Could not load the map data');
  });
});
