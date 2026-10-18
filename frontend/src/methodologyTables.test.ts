// The methodology block's lists are real tables, so a screen reader hears column
// names and a row count: no `feature-row` divs, a caption on every table (carrying
// the kicker text it replaced) and `scope="col"` headers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
const start = src.indexOf('export const MultiplierChecks');
const end = src.indexOf('\nconst ', src.indexOf('const MethodologyPanel') + 1);
const block = src.slice(start, end < 0 ? undefined : end);
const tables = block.split('<table').slice(1).map((t) => t.split('</table>')[0]);

// The kicker strings the captions replaced, pinned so the words do not drift.
const CAPTIONS = [
  'Spatial multiplier checks',
  'Independent signal (partial r, net of the others)',
  'Cross-source check — {m.cross_source.name} (predicted vs actual)',
];

describe('methodology tables', () => {
  it('finds the methodology block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('MethodologyPanel');
  });

  it('has no feature-row divs', () => {
    expect(block).not.toMatch(/feature-row/);
    expect(block).not.toMatch(/feature-kicker/);
  });

  it('has one table per list', () => {
    expect(tables.length).toBe(CAPTIONS.length);
  });

  it.each(tables.map((t, i) => [i, t]))('table %i has a caption and column headers', (_i, t) => {
    expect(t).toMatch(/<caption[^>]*>/);
    expect(t).toContain('<thead>');
    expect(t).toContain('scope="col"');
    expect(t).toContain('scope="row"');
  });

  it.each(CAPTIONS)('captions "%s"', (c) => {
    const caps = tables.map(
      (t) => t.match(/<caption[^>]*>([\s\S]*?)<\/caption>/)?.[1].replace(/\s+/g, ' ').trim(),
    );
    expect(caps).toContain(c);
  });

  it.each(['Signal', 'Partial r', 'VIF', 'Area', 'Predicted', 'Published'])(
    'names the column "%s"',
    (h) => {
      expect(block).toContain(`<th scope="col">${h}</th>`);
    },
  );
});
