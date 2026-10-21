import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAMERA,
  cameraDuration,
  DESKTOP_FIT_PADDING,
  detailBodyState,
  fitPadding,
  PERCENTILE_RAMP_STOPS,
  PHONE_MAX_WIDTH,
  RANKINGS_COUNT,
  SHARE_CONFIRM_MS,
  REDUCED_MOTION_QUERY,
  SMALL_MAX_WIDTH,
  layoutCssVars,
  MASTHEAD_META_MIN_HEIGHT_PX,
  MASTHEAD_META_WRAP_MAX_WIDTH,
  TAP_TARGET_MIN_PX,
} from './layout';

describe('breakpoints', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
  const widths = [...css.matchAll(/@media[^{]*max-width:\s*(\d+)px/g)].map((m) => Number(m[1]));

  it('index.css uses only the breakpoints declared in layout.ts', () => {
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(
      new Set([PHONE_MAX_WIDTH, SMALL_MAX_WIDTH, MASTHEAD_META_WRAP_MAX_WIDTH])
    );
  });

  it('index.css reads the sheet and tap-target values from layout.ts', () => {
    for (const name of Object.keys(layoutCssVars)) expect(css).toContain(`var(${name})`);
    expect(layoutCssVars).toMatchObject({ '--tap-min': `${TAP_TARGET_MIN_PX}px` });
    expect(TAP_TARGET_MIN_PX).toBeGreaterThanOrEqual(44);
  });

  it('reserves the masthead meta line its wrapped height only where it wraps', () => {
    // The model figures arrive with methodology.json; below the wrap breakpoint
    // they wrap the line onto a second row, which pushed the sidebar down (CLS).
    // Between it and the small breakpoint the line fits, so nothing is reserved.
    expect(layoutCssVars).toMatchObject({
      '--masthead-meta-min': `${MASTHEAD_META_MIN_HEIGHT_PX}px`,
    });
    const block = (width: number) => {
      const at = css.indexOf(`@media (max-width: ${width}px)`);
      expect(at, `no @media block at ${width}px`).toBeGreaterThanOrEqual(0);
      const rest = css.slice(at);
      return rest.slice(0, rest.indexOf('\n}'));
    };
    const reserve = /\.masthead-meta\s*\{[^}]*min-height:\s*var\(--masthead-meta-min\)/;
    expect(MASTHEAD_META_WRAP_MAX_WIDTH).toBeLessThan(SMALL_MAX_WIDTH);
    expect(block(MASTHEAD_META_WRAP_MAX_WIDTH)).toMatch(reserve);
    expect(block(SMALL_MAX_WIDTH)).not.toMatch(reserve);
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
      /[zZ]oom:\s*\d/,
      /strokeWidth=\{\d/,
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

describe('detailBodyState', () => {
  // [loading, comparing, hasDetail] → what the detail section shows.
  const cases: [boolean, boolean, boolean, ReturnType<typeof detailBodyState>][] = [
    [false, false, false, 'rankings'],
    [false, false, true, 'detail'],
    [false, true, false, 'rankings'],
    [false, true, true, 'detail'],
    [true, false, false, 'skeleton'],
    [true, false, true, 'skeleton'],
    [true, true, false, 'skeleton'],
    [true, true, true, 'detail-with-pending-pin'],
  ];
  it.each(cases)('loading=%s comparing=%s hasDetail=%s → %s', (l, c, d, want) => {
    expect(detailBodyState(l, c, d)).toBe(want);
  });
});

describe('component tunables', () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

  it('keeps the rankings length, ramp stops and share confirmation', () => {
    expect(RANKINGS_COUNT).toBe(10);
    expect(PERCENTILE_RAMP_STOPS).toEqual([
      [0, 0],
      [33, 2],
      [50, 3],
      [67, 4],
      [100, 6],
    ]);
    expect(SHARE_CONFIRM_MS).toBe(2000);
  });

  it.each([
    ['./RankingsPanel.tsx', 'RANKINGS_COUNT'],
    ['./MapView.tsx', 'PERCENTILE_RAMP_STOPS'],
    ['./ShareButton.tsx', 'SHARE_CONFIRM_MS'],
  ])('%s imports %s from layout.ts', (f, name) => {
    expect(read(f)).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from './layout'`));
  });

  it('MapView types no ramp stop and ShareButton no timeout', () => {
    expect(read('./MapView.tsx')).not.toMatch(/\d+,\s*RAMP\[\d\]/);
    expect(read('./ShareButton.tsx')).not.toMatch(/,\s*\d{3,}\s*\)/);
  });
});
