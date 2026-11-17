/**
 * Pure helpers for the GeoJSON load: what a search says before the areas have
 * arrived, and the counter a "Try again" bumps to re-run the load.
 */
import { SEARCH_LOAD_FAILED_MESSAGE, STILL_LOADING_MESSAGE } from './utils';

/** Why a postcode search cannot place its area yet, or null once the areas loaded. */
export function searchBlockedMessage(
  geojsonLoaded: boolean,
  geoError: string | null
): string | null {
  if (geojsonLoaded) return null;
  return geoError != null ? SEARCH_LOAD_FAILED_MESSAGE : STILL_LOADING_MESSAGE;
}

/** Whether the GeoJSON download may start: once the streamed tiles have coloured
 *  the map (or failed to), or once the wait for them (AREAS_WAIT_FOR_TILES_MS) is
 *  over. Until then the tiles have the bandwidth to themselves. */
export const areasMayLoad = (tilesSettled: boolean, waitOver: boolean): boolean =>
  tilesSettled || waitOver;

/** The next load attempt: a new value re-runs the effect that fetches the GeoJSON. */
export const nextAttempt = (attempt: number): number => attempt + 1;

/** Shown in the map's place when the browser cannot draw it. */
export const NO_WEBGL_MESSAGE =
  'This browser cannot draw the map: WebGL is switched off or not supported. ' +
  'Search, the rankings and area details still work in the panel.';

/** Something that can make a canvas, as `document` does (a stub in tests). */
export interface CanvasMaker {
  createElement(tag: 'canvas'): { getContext(id: string): unknown };
}

/** Whether MapLibre can draw here: a WebGL 2 or WebGL 1 context can be created. */
export function webglAvailable(doc: CanvasMaker | null = typeof document === 'undefined' ? null : document): boolean {
  if (!doc) return false;
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
