// "How it works" (docs/PROJECT_SUMMARY.html, served as methodology.html) must look
// like the map it sits beside: its ink, paper and accent equal index.css's, light
// and dark, and it loads the map's fonts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUINTILE_FILL } from './utils';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../../docs/PROJECT_SUMMARY.html');
const css = read('./index.css');
const indexHtml = read('../index.html');

// The page's token names → index.css's.
const MAPPING: Record<string, string> = {
  '--ground': '--paper',
  '--panel': '--paper-panel',
  '--ink': '--ink',
  '--muted': '--ink-soft',
  '--faint': '--ink-faint',
  '--rule': '--rule',
  '--accent': '--accent',
  '--accent-soft': '--accent-soft',
};

/** The text of the `{ ... }` block opening at the first match of `opener`. */
const block = (src: string, opener: string) => {
  const start = src.indexOf(opener);
  if (start < 0) throw new Error(`no block ${opener}`);
  const from = src.indexOf('{', start) + 1;
  let depth = 1;
  let i = from;
  for (; depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  return src.slice(from, i - 1);
};
const value = (src: string, name: string) =>
  src.match(new RegExp(`(?:^|[\\s;{])${name}\\s*:\\s*([^;]+);`))?.[1].trim().toLowerCase();

const map = {
  light: block(css, ':root'),
  dark: block(block(css, '@media (prefers-color-scheme: dark)'), ':root'),
};
const doc = {
  light: block(page, ':root {'),
  darkMedia: block(block(page, '@media (prefers-color-scheme: dark)'), ':root'),
  darkTheme: block(page, ':root[data-theme="dark"]'),
};

describe('methodology page tokens', () => {
  for (const [pageName, mapName] of Object.entries(MAPPING)) {
    it(`${pageName} equals index.css ${mapName}, light and dark`, () => {
      expect(value(map.light, mapName)).toBeTruthy();
      expect(value(doc.light, pageName)).toBe(value(map.light, mapName));
      expect(value(map.dark, mapName)).toBeTruthy();
      expect(value(doc.darkMedia, pageName)).toBe(value(map.dark, mapName));
      expect(value(doc.darkTheme, pageName)).toBe(value(map.dark, mapName));
    });
  }

  it('uses the map’s display and sans fonts', () => {
    expect(value(doc.light, '--font-display')).toBe(value(map.light, '--font-display'));
    expect(value(doc.light, '--font-sans')).toBe(value(map.light, '--font-sans'));
  });

  it('loads the same Google Fonts stylesheet as the map', () => {
    const fonts = (src: string) => src.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/)?.[0];
    expect(fonts(indexHtml)).toBeTruthy();
    expect(fonts(page)).toBe(fonts(indexHtml));
  });

  it('draws its header ramp in the map’s quintile fill', () => {
    const swatches = page.match(/<div class="ramp"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    const colours = [...swatches.matchAll(/background:(#[0-9a-fA-F]+)/g)].map((m) => m[1].toLowerCase());
    expect(colours).toEqual(QUINTILE_FILL.map((c) => c.toLowerCase()));
  });
});
