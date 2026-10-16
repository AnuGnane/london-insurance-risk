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
