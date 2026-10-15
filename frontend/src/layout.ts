// Layout tunables for the phone sheet, touch and map framing — one module.
// CSS media queries cannot read variables, so the two breakpoints are repeated
// as literals in index.css; layout.test.ts fails if they drift apart.
import { useCallback, useSyncExternalStore } from 'react';

/** Map on top, panel as a bottom sheet (index.css `@media (max-width: 820px)`). */
export const PHONE_MAX_WIDTH = 820;
/** Narrow phones: the waterfall drops its bars (index.css `@media (max-width: 560px)`). */
export const SMALL_MAX_WIDTH = 560;

/** Touch-first devices: no hover popup, a tap card instead. */
export const TOUCH_QUERY = '(hover: none)';

/** Bottom-sheet heights on a phone, as a share of the dynamic viewport. */
export const SHEET_HEIGHT = { collapsed: '40%', expanded: '70%' } as const;

/** Minimum tap target on touch layouts (Apple HIG / WCAG 2.5.5), CSS px. */
export const TAP_TARGET_MIN_PX = 44;

/** "Near me": how far (degrees) a located point may sit from the nearest area's
 *  bounds centre when no area contains it, before it counts as outside GB. */
export const NEAR_ME_MAX_DEGREES = 0.1;

/** "Near me": how long to wait for a position fix, ms. */
export const NEAR_ME_TIMEOUT_MS = 10_000;

/** "Near me": how old a cached fix may be and still be used, ms. */
export const NEAR_ME_MAX_AGE_MS = 60_000;

/** CSS custom properties that carry these values into index.css. */
export const layoutCssVars = {
  '--sheet-collapsed': SHEET_HEIGHT.collapsed,
  '--sheet-expanded': SHEET_HEIGHT.expanded,
  '--tap-min': `${TAP_TARGET_MIN_PX}px`,
} as React.CSSProperties;

// fitBounds framing: the desktop value, and how it scales on a small map.
export const DESKTOP_FIT_PADDING = 120;
const FIT_PADDING_FRACTION = 0.1;
const FIT_PADDING_MIN = 16;
/** Extra bottom room on a phone so the selected area clears the compact legend
 *  (which sits above MapLibre's attribution strip). */
const PHONE_LEGEND_ALLOWANCE = 96;

export interface FitPadding { top: number; right: number; bottom: number; left: number; }

/**
 * fitBounds padding for a map container of `width` x `height` CSS px. Desktop
 * keeps the original 120 on every side; on a phone the padding shrinks with the
 * map (which sits above the sheet) and leaves extra room at the bottom for the
 * legend, without ever eating more than half the map in either direction.
 */
export function fitPadding(width: number, height: number, viewportWidth: number): FitPadding {
  if (viewportWidth > PHONE_MAX_WIDTH) {
    const p = DESKTOP_FIT_PADDING;
    return { top: p, right: p, bottom: p, left: p };
  }
  const side = Math.max(
    FIT_PADDING_MIN,
    Math.min(DESKTOP_FIT_PADDING, Math.round(Math.min(width, height) * FIT_PADDING_FRACTION))
  );
  const bottom = Math.min(side + PHONE_LEGEND_ALLOWANCE, Math.floor(height / 2) - side);
  return { top: side, right: side, bottom: Math.max(side, bottom), left: side };
}

/** Subscribe to a media query (SSR-free: this app is client-only). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
