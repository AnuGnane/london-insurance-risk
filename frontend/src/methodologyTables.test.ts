// The methodology block's lists are real tables, so a screen reader hears column
// names and a row count: no `feature-row` divs, a caption on every table (carrying
// the kicker text it replaced) and `scope="col"` headers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
const start = src.indexOf('export const MultiplierChecks');
// From MultiplierChecks to the end of MethodologyPanel: the next top-level `const`.
const panel = src.indexOf('const MethodologyPanel');
const next = src.slice(panel + 1).search(/^(export )?const /m);
const end = next < 0 ? src.length : panel + 1 + next;
const block = src.slice(start, end);
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
    expect(block).not.toContain('export const Sidebar');
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

  it('gives the feature table four columns, the last its p-value', () => {
    const t = tables.find((x) => x.includes('Independent signal'))!;
    const heads = [...t.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((h) => h[1]);
    expect(heads).toHaveLength(4);
    expect(heads).toContain('p');
    expect(t).toContain('formatP(');
  });

  it.each(['Signal', 'Partial r', 'VIF', 'p', 'Area', 'Predicted', 'Published'])(
    'names the column "%s"',
    (h) => {
      expect(block).toContain(`<th scope="col">${h}</th>`);
    },
  );
});

describe('metric tile sub-lines', () => {
  const from = block.indexOf('<div className="metric-strip">');
  // The strip ends where the note under it begins, so no tile runs past it.
  const strip = block.slice(from, block.indexOf('<p className="note">', from));
  const tiles = strip.split('<div className="metric">').slice(1, 4);

  it('finds the three tiles', () => {
    expect(tiles).toHaveLength(3);
  });

  it.each([
    ['Panel R²', 'm.adj_r_squared', 'fmt(m.adj_r_squared, 3)'],
    ['LOAO MAE', 'm.loao_n', 'formatFigure(m.loao_n)'],
    ['Spearman ρ', 'm.spearman_p', 'formatP(m.spearman_p)'],
  ])('the "%s" tile renders a metric-sub guarded on its value', (label, field, call) => {
    const tile = tiles.find((t) => t.includes(`>${label}<`))!;
    expect(tile).toBeDefined();
    const guard = tile.indexOf(`{${field} != null && (`);
    expect(guard).toBeGreaterThan(-1);
    const sub = tile.indexOf('<span className="metric-sub">', guard);
    expect(sub).toBeGreaterThan(guard);
    expect(tile.slice(sub)).toContain(call);
  });
});
