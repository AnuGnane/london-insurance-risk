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
