// The scale must read without colour: in greyscale and for colour-blind
// viewers, each step of the ramp and of the quintile fill is darker (CIE L*).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUINTILE_FILL, QUINTILE_TEXT, RAMP } from './utils';

const channels = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
};
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** WCAG relative luminance, which is CIE Y for sRGB with a D65 white. */
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** CIE L* (0 black .. 100 white). */
const lightness = (hex: string) => {
  const y = luminance(hex);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const strictlyDarker = (ramp: string[]) =>
  ramp.slice(1).every((c, i) => lightness(c) < lightness(ramp[i]));

describe('colour scales', () => {
  it('sanity: L* of white and black', () => {
    expect(lightness('#ffffff')).toBeCloseTo(100, 1);
    expect(lightness('#000000')).toBeCloseTo(0, 1);
  });

  it('RAMP gets monotonically darker', () => {
    expect(strictlyDarker(RAMP)).toBe(true);
  });

  it('QUINTILE_FILL gets monotonically darker', () => {
    expect(QUINTILE_FILL).toHaveLength(5);
    expect(strictlyDarker(QUINTILE_FILL)).toBe(true);
  });

  it('legend Q labels are legible on their segment (WCAG AA, 4.5:1)', () => {
    QUINTILE_FILL.forEach((fill, i) => {
      expect(contrast(fill, QUINTILE_TEXT[i])).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe('index.css tokens', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  const token = (name: string) =>
    css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`))?.[1]?.toLowerCase();

  it('mirror the JS ramp and quintile fill', () => {
    RAMP.forEach((c, i) => expect(token(`--ramp-${i}`)).toBe(c.toLowerCase()));
    QUINTILE_FILL.forEach((c, i) => expect(token(`--q${i + 1}`)).toBe(c.toLowerCase()));
  });

  it('keep hard-coded colours out of the waterfall, chip and popup rules', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, sel]) => /\.(wf-|chip-|hover-popup|tap-card)/.test(sel))
      .map(([, sel, body]) => `${sel.trim()} { ${body.trim()} }`);
    expect(rules.length).toBeGreaterThan(0);
    const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black)\b/;
    expect(rules.filter((r) => literal.test(r))).toEqual([]);
  });

  it('define a dark scheme for the paper, ink and rule tokens', () => {
    // The body of the first dark-scheme block, up to its matching closing brace.
    const start = css.indexOf('{', css.indexOf('@media (prefers-color-scheme: dark)'));
    let depth = 0;
    let end = start;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      if (css[end] === '}' && --depth === 0) break;
    }
    const dark = css.slice(start, end);
    for (const t of ['--paper', '--paper-panel', '--ink', '--ink-soft', '--ink-faint', '--rule', '--map-area-line', '--map-selected']) {
      expect(dark).toContain(`${t}:`);
    }
  });
});
