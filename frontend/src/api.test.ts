import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Feature } from 'geojson';
import { getGeojson, getMethodology, getRankings } from './api';
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
