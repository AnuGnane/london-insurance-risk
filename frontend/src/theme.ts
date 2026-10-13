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
