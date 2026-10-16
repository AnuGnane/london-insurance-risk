// Light / dark: the basemap per scheme, and the CSS tokens MapLibre needs as
// plain colour strings. Dark mode follows the system; there is no manual toggle.

export const DARK_QUERY = '(prefers-color-scheme: dark)';

export const BASEMAP_STYLE = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const;

/** The current value of a CSS custom property on :root (index.css owns the colours). */
export function cssToken(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/** The areas' fill and hairlines, shared by the streamed tiles and the GeoJSON so
 *  the swap from one to the other shows no step. */
export const AREA_STYLE = {
  fillOpacity: 0.72,
  fillOpacityHover: 0.95,
  lineWidth: 0.4,
  lineOpacity: 0.45,
  /** Fade between colour modes (ms). */
  fillColorTransitionMs: 350,
  /** Outline of the selected area, and of the comparison (dashed). */
  selectedLineWidth: 2.5,
  compareDash: [2, 1],
} as const;

/** The search pin and the popups' distance from the point they label (px). */
export const MARKER_STYLE = {
  pinSize: 28,
  pinStrokeWidth: 2.5,
  tapPopupOffset: 10,
  hoverPopupOffset: 14,
} as const;
