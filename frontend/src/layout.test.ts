import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_FIT_PADDING,
  fitPadding,
  PHONE_MAX_WIDTH,
  SMALL_MAX_WIDTH,
  layoutCssVars,
  TAP_TARGET_MIN_PX,
} from './layout';

describe('breakpoints', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  const widths = [...css.matchAll(/@media[^{]*max-width:\s*(\d+)px/g)].map((m) => Number(m[1]));

  it('index.css uses only the breakpoints declared in layout.ts', () => {
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(new Set([PHONE_MAX_WIDTH, SMALL_MAX_WIDTH]));
  });

  it('index.css reads the sheet and tap-target values from layout.ts', () => {
    for (const name of Object.keys(layoutCssVars)) expect(css).toContain(`var(${name})`);
    expect(layoutCssVars).toMatchObject({ '--tap-min': `${TAP_TARGET_MIN_PX}px` });
    expect(TAP_TARGET_MIN_PX).toBeGreaterThanOrEqual(44);
  });
});

describe('fitPadding', () => {
  it('keeps the desktop padding unchanged', () => {
    const p = DESKTOP_FIT_PADDING;
    expect(fitPadding(1024, 900, 1440)).toEqual({ top: p, right: p, bottom: p, left: p });
  });

  it('scales down on a phone and leaves room at the bottom for the legend', () => {
    // 390x844 with the sheet collapsed: the map is about 60% of the height.
    const p = fitPadding(390, 506, 390);
    expect(p.left).toBeLessThan(DESKTOP_FIT_PADDING);
    expect(p.left).toBe(p.right);
    expect(p.top).toBe(p.left);
    expect(p.bottom).toBeGreaterThan(p.top);
  });

  it('never pads away more than half of a short map', () => {
    // 360x740 with the sheet expanded: the map is about 30% of the height.
    const p = fitPadding(360, 222, 360);
    expect(p.top + p.bottom).toBeLessThanOrEqual(222 / 2 + p.top);
    expect(p.top + p.bottom).toBeLessThan(222);
    expect(p.left + p.right).toBeLessThan(360);
    expect(p.top).toBeGreaterThanOrEqual(16);
  });
});
