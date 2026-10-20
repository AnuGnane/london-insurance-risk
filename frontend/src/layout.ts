// Layout tunables for the phone sheet, touch and map framing — one module.
// CSS media queries cannot read variables, so the three breakpoints are repeated
// as literals in index.css; layout.test.ts fails if they drift apart.
import { useCallback, useSyncExternalStore } from 'react';

/** Map on top, panel as a bottom sheet (index.css `@media (max-width: 820px)`). */
export const PHONE_MAX_WIDTH = 820;
/** Narrow phones: the waterfall drops its bars (index.css `@media (max-width: 560px)`). */
export const SMALL_MAX_WIDTH = 560;
/** Where the masthead meta line wraps onto a second row once methodology.json
 *  fills it in (index.css `@media (max-width: 440px)`; measured in headless
 *  Chromium: two rows up to 437 px, one from 439 px, rounded up to 440). */
export const MASTHEAD_META_WRAP_MAX_WIDTH = 440;

/** Touch-first devices: no hover popup, a tap card instead. */
export const TOUCH_QUERY = '(hover: none)';

/** The same query `index.css` uses to stop its own animations. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Bottom-sheet heights on a phone, as a share of the dynamic viewport. */
export const SHEET_HEIGHT = { collapsed: '40%', expanded: '70%' } as const;

/** Minimum tap target on touch layouts (Apple HIG / WCAG 2.5.5), CSS px. */
export const TAP_TARGET_MIN_PX = 44;

/** The masthead's meta line (R², the ± error, the area count, "How it works")
 *  wraps onto a second row below MASTHEAD_META_WRAP_MAX_WIDTH once methodology.json
 *  fills in the model figures. Its two-row height, CSS px, is reserved from
 *  first paint so the sidebar under it does not shift (measured at 320 to 430 px,
 *  with the web fonts and with the fallbacks: 43 either way). */
export const MASTHEAD_META_MIN_HEIGHT_PX = 43;

/** "Near me": how far (degrees) a located point may sit from the nearest area's
 *  bounds centre when no area contains it, before it counts as outside GB. */
export const NEAR_ME_MAX_DEGREES = 0.1;

/** "Near me": how long to wait for a position fix, ms. */
export const NEAR_ME_TIMEOUT_MS = 10_000;

/** Postcode search: how long to wait for postcodes.io before giving up, ms. */
export const POSTCODE_LOOKUP_TIMEOUT_MS = 8_000;

/** "Near me": how old a cached fix may be and still be used, ms. */
export const NEAR_ME_MAX_AGE_MS = 60_000;

/** What the sidebar's detail section shows. A postcode lookup normally swaps it
 *  for the skeleton, but while a compare is armed over a shown area the area (and
 *  its "(cancel)") stays, with a pending row where the second pin will land. */
export type DetailBodyState = 'rankings' | 'skeleton' | 'detail' | 'detail-with-pending-pin';
export const detailBodyState = (
  loading: boolean,
  comparing: boolean,
  hasDetail: boolean
): DetailBodyState => {
  if (loading) return comparing && hasDetail ? 'detail-with-pending-pin' : 'skeleton';
  return hasDetail ? 'detail' : 'rankings';
};

/** Live regions: how long a repeated message stays cleared before it is set again,
 *  ms, so screen readers read the same text twice (see announce.ts). */
export const ANNOUNCE_CLEAR_MS = 100;

/** CSS custom properties that carry these values into index.css. */
export const layoutCssVars = {
  '--sheet-collapsed': SHEET_HEIGHT.collapsed,
  '--sheet-expanded': SHEET_HEIGHT.expanded,
  '--tap-min': `${TAP_TARGET_MIN_PX}px`,
  '--masthead-meta-min': `${MASTHEAD_META_MIN_HEIGHT_PX}px`,
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

/** The map's camera: where it opens, and how it moves to a searched area. */
export const CAMERA = {
  initialView: { longitude: -2.5, latitude: 54.5, zoom: 5.2 },
  /**
   * Cap the zoom: the static geometry is simplified to ~180 m, so zooming in
   * tight on one small area exposes coarse polygons — keep some context.
   */
  focusZoom: 11,
  flightMs: 1100,
} as const;

/** How long a camera move takes: a cut (0) under Reduce Motion, else a flight. */
export const cameraDuration = (reduced: boolean): number => (reduced ? 0 : CAMERA.flightMs);

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
