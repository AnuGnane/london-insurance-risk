// Frontend half of the serve-consistency guard (tests/test_serve_consistency.py
// needs reports/, so it skips without data): the committed, baked GeoJSON must
// reconstruct each area's premium from its baseline plus the five driver steps
// that the "Why this price" waterfall shows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import type { LsoaProps } from './types';
import { MODEL_DRIVERS } from './utils';

const SAMPLE_SIZE = 500;
const TOLERANCE_GBP = 1;

describe('baked areas.geojson', () => {
  const fc: FeatureCollection = JSON.parse(
    readFileSync(new URL('../public/data/areas.geojson', import.meta.url), 'utf8')
  );
  const step = Math.max(1, Math.floor(fc.features.length / SAMPLE_SIZE));
  const sample = fc.features.filter((_, i) => i % step === 0);

  it('has features to sample', () => {
    expect(sample.length).toBeGreaterThanOrEqual(Math.min(SAMPLE_SIZE, fc.features.length));
  });

  it('premium_baseline + Σ *_contrib == calibrated_premium within £1', () => {
    const off: string[] = [];
    for (const f of sample) {
      const p = f.properties as LsoaProps;
      const baseline = Number(p.premium_baseline);
      const premium = Number(p.calibrated_premium);
      const sum = MODEL_DRIVERS.reduce((s, k) => s + Number(p[`${k}_contrib`]), baseline);
      if (!(Math.abs(sum - premium) <= TOLERANCE_GBP)) {
        off.push(`${p.lsoa11cd}: ${baseline} + steps = ${sum} vs ${premium}`);
      }
    }
    expect(off).toEqual([]);
  });
});
