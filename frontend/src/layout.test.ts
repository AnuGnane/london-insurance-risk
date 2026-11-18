import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_WRAP_MAX_WIDTH,
  ATTRIBUTION_MIN_HEIGHT_PX,
  CAMERA,
  META_RESERVE,
  cameraDuration,
  currentRankIndex,
  DESKTOP_FIT_PADDING,
  detailBodyState,
  fitPadding,
  PERCENTILE_RAMP_STOPS,
  PHONE_MAX_WIDTH,
  RANKINGS_COUNT,
  RANKINGS_MAX,
  RANKINGS_STEP,
  nextRankingsCount,
  openedAreaScrollTop,
  PHONE_QUERY,
  SHARE_CONFIRM_MS,
  REDUCED_MOTION_QUERY,
  SMALL_MAX_WIDTH,
  layoutCssVars,
  MASTHEAD_COMPACT_MAX_WIDTH,
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
      new Set([
        PHONE_MAX_WIDTH,
        SMALL_MAX_WIDTH,
        MASTHEAD_COMPACT_MAX_WIDTH,
        MASTHEAD_META_WRAP_MAX_WIDTH,
        ATTRIBUTION_WRAP_MAX_WIDTH,
      ])
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
    expect(block(MASTHEAD_COMPACT_MAX_WIDTH)).not.toMatch(reserve);
  });

  it('lifts the compact legend one attribution row where the strip wraps', () => {
    // On a phone the open attribution is a full-width strip under the legend. Up
    // to 339 px it wraps onto a second 20 px row, which ran under the legend's
    // foot; below the wrap breakpoint the legend sits that row higher.
    const bottomPx = (width: number) => {
      const at = css.indexOf(`@media (max-width: ${width}px)`);
      expect(at, `no @media block at ${width}px`).toBeGreaterThanOrEqual(0);
      const rest = css.slice(at);
      const m = rest.slice(0, rest.indexOf('\n}')).match(
        /\.legend\s*\{[^}]*bottom:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom, 0px\)\)/
      );
      expect(m, `no .legend bottom at ${width}px`).not.toBeNull();
      return Number(m![1]);
    };
    const ATTRIBUTION_ROW_PX = 20;
    expect(ATTRIBUTION_WRAP_MAX_WIDTH).toBeLessThan(MASTHEAD_META_WRAP_MAX_WIDTH);
    expect(ATTRIBUTION_WRAP_MAX_WIDTH).toBeGreaterThanOrEqual(340);
    expect(bottomPx(ATTRIBUTION_WRAP_MAX_WIDTH)).toBe(bottomPx(PHONE_MAX_WIDTH) + ATTRIBUTION_ROW_PX);
    // The narrower block comes later in the file, so it wins at equal specificity.
    expect(css.indexOf(`@media (max-width: ${ATTRIBUTION_WRAP_MAX_WIDTH}px)`)).toBeGreaterThan(
      css.indexOf(`@media (max-width: ${PHONE_MAX_WIDTH}px)`)
    );
  });

  it('tightens the masthead on a phone in portrait without hiding it from screen readers', () => {
    // On a phone the kicker, standfirst and two-row meta line took about half the
    // collapsed sheet, pushing the search off a 568 px screen. Below the compact
    // breakpoint the kicker and standfirst leave the layout, clipped like .sr-only
    // (never display:none, visibility:hidden or aria-hidden, which would drop them
    // from the accessibility tree), and the meta line sits closer under the title.
    expect(MASTHEAD_COMPACT_MAX_WIDTH).toBeLessThan(SMALL_MAX_WIDTH);
    expect(MASTHEAD_COMPACT_MAX_WIDTH).toBeGreaterThan(MASTHEAD_META_WRAP_MAX_WIDTH);
    const at = css.indexOf(`@media (max-width: ${MASTHEAD_COMPACT_MAX_WIDTH}px)`);
    expect(at).toBeGreaterThanOrEqual(0);
    const compact = css.slice(at, at + css.slice(at).indexOf('\n}'));
    const hidden = compact.match(/\.masthead-kicker, \.masthead-standfirst\s*\{([^}]*)\}/)?.[1];
    expect(hidden).toBeDefined();
    expect(hidden).toMatch(/position:\s*absolute/);
    expect(hidden).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
    expect(hidden).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    const sidebar = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8');
    expect(sidebar).toMatch(/<div className="masthead-kicker">[^<]+<\/div>/);
    expect(sidebar).toMatch(/<p className="masthead-standfirst">\s*How much does/);
    // The title, the model figures and "How it works" stay on screen.
    expect(compact).not.toMatch(/\.masthead h1|\.masthead-meta[^{]*\{[^}]*(display:\s*none|visibility)/);
    expect(compact).not.toMatch(/\.masthead-meta a/);
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

describe('nextRankingsCount', () => {
  it('keeps the step and the cap (R-66 ruling 1)', () => {
    expect(RANKINGS_STEP).toBe(20);
    expect(RANKINGS_MAX).toBe(100);
  });

  it.each([
    [RANKINGS_COUNT, 5000, RANKINGS_COUNT + RANKINGS_STEP],
    [RANKINGS_MAX - 5, 5000, RANKINGS_MAX],
    [RANKINGS_MAX, 5000, null],
    [RANKINGS_COUNT, RANKINGS_COUNT + 3, RANKINGS_COUNT + 3],
    [RANKINGS_COUNT, RANKINGS_COUNT, null],
    [RANKINGS_COUNT, 4, null],
    [RANKINGS_COUNT, 0, null],
  ])('from %i of %i areas shows %s', (count, available, want) => {
    expect(nextRankingsCount(count, available)).toBe(want);
  });

  it('walks from the default to the cap in steps', () => {
    const seen: number[] = [];
    for (let c: number | null = RANKINGS_COUNT; c != null; c = nextRankingsCount(c, 5000)) {
      seen.push(c);
    }
    expect(seen[0]).toBe(RANKINGS_COUNT);
    expect(seen.at(-1)).toBe(RANKINGS_MAX);
    expect(seen.slice(1, -1).every((c, i) => c - seen[i] === RANKINGS_STEP)).toBe(true);
  });
});

describe('currentRankIndex', () => {
  const rows = [{ code: 'E01000001' }, { code: 'E01000002' }, { code: 'W01000003' }];

  it.each([
    ['E01000001', 0],
    ['W01000003', 2],
    ['S01000004', -1],
    [null, -1],
  ])('finds %s at %i', (code, want) => {
    expect(currentRankIndex(rows, code)).toBe(want);
  });

  it('is -1 in an empty list', () => {
    expect(currentRankIndex([], 'E01000001')).toBe(-1);
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
    ['./RankingsPanel.tsx', 'nextRankingsCount'],
    ['./MapView.tsx', 'PERCENTILE_RAMP_STOPS'],
    ['./ShareButton.tsx', 'SHARE_CONFIRM_MS'],
  ])('%s imports %s from layout.ts', (f, name) => {
    expect(read(f)).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from './layout'`));
  });

  it('MapView types no ramp stop and ShareButton no timeout', () => {
    expect(read('./MapView.tsx')).not.toMatch(/\d+,\s*RAMP\[\d\]/);
    expect(read('./ShareButton.tsx')).not.toMatch(/,\s*\d{3,}\s*\)/);
  });

  it('reserves the R² figure and the attribution corner from first paint (R-70)', () => {
    // The model figures and MapLibre's attribution arrive after first paint; each
    // shifted what sat beside it (Lighthouse layout-shift trace, R-70).
    const sidebar = read('./Sidebar.tsx');
    const css = read('./index.css');
    expect(sidebar).toMatch(/methodology == null && \(/);
    expect(sidebar).toContain('<b>{META_RESERVE.r2}</b>');
    expect(sidebar).toContain('{META_RESERVE.mae}</span>');
    expect(sidebar).toContain('{META_RESERVE.count}</span>');
    expect(sidebar.match(/className="(sep )?meta-reserve" aria-hidden="true"/g)).toHaveLength(5);
    // Each stand-in has the shape of what replaces it, and is no real figure.
    expect(META_RESERVE.r2).toBe(`R² ${(0).toFixed(3)}`);
    expect(META_RESERVE.count).toMatch(/^0{2},0{3}$/);
    expect(META_RESERVE.mae).toMatch(/^£0+ hold-out error$/);
    // The leave-one-area-out MAE is a mean error on held-out anchor areas, not a
    // band around each small area, so the masthead gives it no "±" and no "per area".
    expect(sidebar).toContain('£{Math.round(methodology.loao_mae)} hold-out error</span>');
    expect(sidebar).not.toMatch(/±£|per area/);
    // A reserved height with one row in it keeps that row at the top.
    expect(css).toMatch(/\.masthead-meta\s*\{[^}]*align-content:\s*flex-start/);
    expect(css).toMatch(/\.masthead-meta \.meta-reserve\s*\{\s*visibility:\s*hidden;/);
    expect(layoutCssVars).toMatchObject({ '--attrib-min': `${ATTRIBUTION_MIN_HEIGHT_PX}px` });
    const at = css.indexOf(`@media (max-width: ${PHONE_MAX_WIDTH}px)`);
    const phone = css.slice(at, at + css.slice(at).indexOf('\n}'));
    expect(phone).toMatch(
      /\.maplibregl-ctrl-bottom-right\s*\{[^}]*min-height:\s*var\(--attrib-min\)[^}]*justify-content:\s*flex-end/
    );
    expect(phone).toMatch(
      /\.maplibregl-ctrl-attrib\.maplibregl-compact-show\s*\{[^}]*width:\s*calc\(100% - 20px\)/
    );
  });

  it('leaves no "·" at either end of a masthead row', () => {
    // On a narrow phone the line wrapped after "£77 hold-out error ·", leaving the
    // separator hanging. Each separator now holds its place unseen, and the item
    // after it draws the dot one gap to its left; when that item starts a row the
    // dot falls outside the line's clip.
    const sidebar = read('./Sidebar.tsx');
    const css = read('./index.css');
    const px = (s: string | undefined) => Number(s?.replace('px', ''));
    const meta = css.match(/\.masthead-meta\s*\{([^}]*)\}/)?.[1] ?? '';
    const gap = px(meta.match(/gap:\s*(\d+px)/)?.[1]);
    expect(gap).toBeGreaterThan(0);
    expect(css).toMatch(/\.masthead-meta \.sep\s*\{\s*visibility:\s*hidden;\s*\}/);
    const dot = css.match(
      /\.masthead-meta > \.sep:not\(\.meta-reserve\) \+ span::before\s*\{([^}]*)\}/
    )?.[1];
    expect(dot).toBeDefined();
    expect(dot).toMatch(/content:\s*'·'/);
    expect(dot).toMatch(/position:\s*absolute/);
    expect(dot).toMatch(/right:\s*100%/);
    // Drawn exactly where its own separator sits: one gap left of the item.
    expect(px(dot?.match(/margin-right:\s*(\d+px)/)?.[1])).toBe(gap);
    // The clip hides a dot at a row's start (a gap or more left of the line) but
    // keeps the link's enlarged tap area (index.css, phone block) whole.
    const [clipY, clipX] = (css.match(/\.masthead-meta\s*\{\s*clip-path:\s*inset\((-\d+px) (-\d+px)\)/) ?? [])
      .slice(1)
      .map((v) => -px(v));
    const [tapY, tapX] = (css.match(/\.masthead-meta a::after\s*\{[^}]*inset:\s*(-\d+px) (-\d+px)/) ?? [])
      .slice(1)
      .map((v) => -px(v));
    expect(clipX).toBeLessThan(gap);
    expect(clipX).toBeGreaterThanOrEqual(tapX);
    expect(clipY).toBeGreaterThanOrEqual(tapY);
    // "How it works" is a 15 px line box (0.6875rem with its rule, measured in
    // headless Chromium at 320 to 480 px); its tap area reaches the minimum.
    expect(15 + 2 * tapY).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
    // Every drawn separator is followed by a plain <span>, the item that draws it.
    const seps = [...sidebar.matchAll(/<span className="sep">·<\/span>/g)];
    expect(seps.length).toBe(2);
    for (const s of seps) {
      const after = sidebar.slice(s.index + s[0].length);
      expect(after.match(/<(?![/>])[^>]*>/)?.[0]).toBe('<span>');
    }
  });
});

describe('the rankings mark the area opened last (R-73)', () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

  it('RankingsPanel marks it with aria-current and Sidebar passes the code it keeps', () => {
    expect(read('./RankingsPanel.tsx')).toContain('aria-current');
    expect(read('./Sidebar.tsx')).toContain('currentCode={lastCode}');
  });

  it('styles the open row with an ink rule and the hover wash', () => {
    const css = read('./index.css');
    const rule = css.match(/\.rank-row\[aria-current="true"\]\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/border-left:\s*3px solid var\(--ink\)/);
    expect(rule?.[1]).toContain('background: var(--paper-wash)');
  });
});

describe('recent searches are reachable from the keyboard (R-77)', () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

  it('Sidebar shows the list from recentsShown and keeps it while focus moves within', () => {
    const sidebar = read('./Sidebar.tsx');
    expect(sidebar).toContain('recentsShown(');
    expect(sidebar).toContain('relatedTarget');
    expect(sidebar).toContain('aria-labelledby="recents-label"');
  });

  it('resets the list style on the recents <ul>', () => {
    const rule = read('./index.css').match(/\.recents-list\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/list-style:\s*none/);
  });
});

describe('a shared postcode link shows its postcode in the box (R-78)', () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

  it('App passes the restored postcode and Sidebar seeds its term from it', () => {
    expect(read('./App.tsx')).toContain('initialTerm={initialTerm(initialLink.pc)}');
    expect(read('./Sidebar.tsx')).toContain('useState(initialTerm)');
  });
});

describe('an opened area is in view (openedAreaScrollTop)', () => {
  it('scrolls the desktop panel to its top, where the area sits under the search', () => {
    expect(openedAreaScrollTop(false, 640)).toBe(0);
  });
  it("scrolls a phone's sheet to the area's own section, past the controls above it", () => {
    expect(openedAreaScrollTop(true, 640.4)).toBe(640);
    expect(openedAreaScrollTop(true, -12)).toBe(0);
  });
  it('the phone query is the sheet breakpoint', () => {
    expect(PHONE_QUERY).toBe(`(max-width: ${PHONE_MAX_WIDTH}px)`);
  });
});
