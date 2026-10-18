import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The priced-area count changes at every bake, so no component types it in: the
// masthead, the loading toast and About derive it from the loaded GeoJSON.
describe('no area count typed into the app', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('.tsx'),
  );

  it('scans the components', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s carries no literal 41,729', (f) => {
    const src = readFileSync(new URL(f, dir), 'utf8');
    expect(src).not.toMatch(/41,?729/);
  });
});

// The place vs composition R² split comes from methodology.json at every bake, so
// the methodology block derives its three figures rather than typing them in.
describe('no variance split typed into the sidebar', () => {
  const src = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
  const vd = JSON.parse(
    readFileSync(new URL('../public/data/methodology.json', import.meta.url), 'utf8'),
  ).variance_decomposition;

  it.each(['place_only_r2', 'composition_only_r2', 'full_r2'])('carries no literal %s', (k) => {
    expect(typeof vd[k]).toBe('number');
    expect(src).not.toContain(vd[k].toFixed(2));
    expect(src).not.toContain(String(vd[k]));
  });
});

// The anchor sample size comes from methodology.json's n_matched, so the "What it
// doesn't claim" list renders it rather than typing in the README's figure.
describe('no anchor sample size typed in', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const n = readme.match(/(\d+) matched observations/)?.[1] ?? '';

  it('reads the README figure', () => {
    expect(n).toMatch(/^\d+$/);
  });

  it.each(['./Sidebar.tsx', './utils.ts'])('%s carries no literal sample size', (f) => {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src).not.toMatch(new RegExp(`\\b${n}\\b`));
  });
});
