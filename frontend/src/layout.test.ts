import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAMERA,
  cameraDuration,
  DESKTOP_FIT_PADDING,
  fitPadding,
  PHONE_MAX_WIDTH,
  REDUCED_MOTION_QUERY,
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

describe('camera', () => {
  it('cuts instead of flying under Reduce Motion', () => {
    expect(cameraDuration(true)).toBe(0);
    expect(cameraDuration(false)).toBe(CAMERA.flightMs);
    expect(CAMERA.flightMs).toBeGreaterThan(0);
  });

  it('uses the same reduced-motion query as index.css', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
    expect(css).toContain(`@media ${REDUCED_MOTION_QUERY}`);
  });

  it('MapView reads its camera, line and popup numbers from layout.ts and theme.ts', () => {
    const src = readFileSync(new URL('./MapView.tsx', import.meta.url), 'utf8');
    for (const typed of [
      /duration:\s*\d/,
      /zoom:\s*\d/,
      /(longitude|latitude):\s*-?\d/,
      /'line-width':\s*\d/,
      /'line-dasharray':\s*\[\d/,
      /offset=\{\d/,
      /size=\{2\d\}/,
    ]) {
      expect(src).not.toMatch(typed);
    }
  });
});
