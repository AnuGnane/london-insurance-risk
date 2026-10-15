// "Near me": browser geolocation -> the area the user is standing in.
// Nothing here is stored or put in the URL; the caller shows the area by its code only.
import type { Feature } from 'geojson';
import { NEAR_ME_MAX_AGE_MS, NEAR_ME_MAX_DEGREES, NEAR_ME_TIMEOUT_MS } from './layout';
import { boundsCentre, featureAtPoint, featureBounds, pointInFeature } from './utils';

export type LocateErrorKind = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'outside';

const MESSAGES: Record<LocateErrorKind, string> = {
  unsupported: 'This browser cannot share your location. Try a postcode instead.',
  denied: 'Location access was blocked. Allow it for this site, or search a postcode.',
  unavailable: 'Your location is unavailable right now. Try a postcode instead.',
  timeout: 'Finding your location took too long. Try again, or search a postcode.',
  outside: 'You appear to be outside Great Britain, which is all this map covers.',
};

export class LocateError extends Error {
  readonly kind: LocateErrorKind;
  constructor(kind: LocateErrorKind) {
    super(MESSAGES[kind]);
    this.name = 'LocateError';
    this.kind = kind;
  }
}

/**
 * The area at a point: the one containing it, else the nearest by bounds centre as
 * long as that centre lies within `maxDegrees` (a fix just off a coast or between
 * polygons). Null for a point outside GB, which `featureAtPoint` alone would still
 * match to its nearest area.
 */
export function locateArea(
  features: Feature[],
  lng: number,
  lat: number,
  maxDegrees = NEAR_ME_MAX_DEGREES
): Feature | null {
  const f = featureAtPoint(features, lng, lat);
  if (!f) return null;
  if (pointInFeature(lng, lat, f)) return f;
  const b = featureBounds(f);
  if (!b) return null;
  const [cx, cy] = boundsCentre(b);
  return Math.hypot(cx - lng, cy - lat) <= maxDegrees ? f : null;
}

const ERROR_KINDS: Record<number, LocateErrorKind> = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

/** One position fix, as a promise; geolocation's error codes become LocateErrors. */
function currentPosition(geo: Pick<Geolocation, 'getCurrentPosition'>): Promise<[number, number]> {
  return new Promise((resolve, reject) =>
    geo.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new LocateError(ERROR_KINDS[e.code] ?? 'unavailable')),
      { timeout: NEAR_ME_TIMEOUT_MS, maximumAge: NEAR_ME_MAX_AGE_MS }
    )
  );
}

/** The area the device is in. `geo` is `navigator.geolocation` (injected for tests). */
export async function findMyArea(
  geo: Pick<Geolocation, 'getCurrentPosition'> | undefined,
  features: Feature[]
): Promise<Feature> {
  if (!geo) throw new LocateError('unsupported');
  const [lng, lat] = await currentPosition(geo);
  const f = locateArea(features, lng, lat);
  if (!f) throw new LocateError('outside');
  return f;
}
