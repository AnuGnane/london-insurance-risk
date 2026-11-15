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
