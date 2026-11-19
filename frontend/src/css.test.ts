// index.css's forced-colours block (R-67): under Windows High Contrast the swatches,
// dots and bars keep their colour, and only system colour keywords are used.
// Also: public/404.html repeats some of index.css's colour tokens, which must match.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const OPENER = '@media (forced-colors: active)';

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

describe('forced colours', () => {
  const forced = block(css, OPENER);

  it('has exactly one forced-colours block', () => {
    expect(css.split(OPENER).length - 1).toBe(1);
  });

  it.each(['.seg-fill', '.rank-dot', '.dot-mark', '.bar-fill'])(
    '%s keeps its colour',
    (sel) => {
      const rule = forced.match(/([^{}]+)\{([^}]*)\}/g)?.find((r) =>
        r.split('{')[0].split(',').map((s) => s.trim()).includes(sel),
      );
      expect(rule).toMatch(/forced-color-adjust:\s*none/);
    },
  );

  it('borders the legend and the toast, and rings focus in Highlight', () => {
    expect(forced).toMatch(/\.legend,\s*\.map-toast\s*\{\s*border:\s*1px solid CanvasText;/);
    expect(forced).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid Highlight;/);
  });

  // R-76: the search box's own focus rule must not hide the ring under High Contrast.
  it('rings the search box in Highlight', () => {
    const rule = forced.match(/([^{}]+)\{([^}]*)\}/g)?.find((r) =>
      r.split('{')[0].split(',').map((s) => s.trim()).includes('.search-bar input:focus-visible'),
    );
    expect(rule).toMatch(/outline:\s*2px solid Highlight;/);
    expect(rule).toMatch(/outline-offset:\s*2px;/);
  });

  it('never drops the search box outline on focus', () => {
    expect(css).not.toMatch(/\.search-bar input:focus(-visible)?\s*[,{][^}]*outline:\s*none/);
  });

  it('uses system colour keywords only', () => {
    expect(forced).not.toMatch(/#|rgb\(|hsl\(|var\(/);
  });
});

// public/404.html is a standalone page (it cannot load the hashed bundle CSS), so it
// repeats the colour tokens it uses from index.css; they must not drift apart.
describe('404 page colour tokens', () => {
  const html = readFileSync(new URL('../public/404.html', import.meta.url), 'utf8');
  const DARK = '@media (prefers-color-scheme: dark) {';

  /** The custom properties declared directly in a block, comments stripped. */
  const props = (src: string) =>
    Object.fromEntries(
      [...src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
        (m) => [m[1], m[2].trim().replace(/\s+/g, ' ').toLowerCase()],
      ),
    );
  /** Light and dark tokens: dark mode inherits whatever it does not override. */
  const schemes = (src: string) => {
    const light = props(block(src, ':root'));
    return { light, dark: { ...light, ...props(block(block(src, DARK), ':root')) } };
  };
  const isColour = (v: string) => /^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/.test(v);

  const page = schemes(html);
  const app = schemes(css);
  const colours = Object.keys({ ...page.light, ...page.dark }).filter(
    (k) => isColour(page.light[k] ?? '') || isColour(page.dark[k] ?? ''),
  );

  it('declares colour tokens in light and dark', () => {
    expect(colours.length).toBeGreaterThan(0);
    expect(html).toContain(DARK);
  });

  it.each(['light', 'dark'] as const)('matches index.css in %s', (scheme) => {
    const pick = (t: Record<string, string>) =>
      Object.fromEntries(colours.map((k) => [k, t[k]]));
    expect(pick(page[scheme])).toEqual(pick(app[scheme]));
  });
});
