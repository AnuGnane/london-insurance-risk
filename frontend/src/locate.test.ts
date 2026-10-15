import { describe, expect, it } from 'vitest';
import type { Feature } from 'geojson';
import { findMyArea, LocateError, locateArea } from './locate';
import { NEAR_ME_MAX_DEGREES } from './layout';

const square = (code: string, x0: number, y0: number, x1: number, y1: number): Feature => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
  },
  properties: { lsoa11cd: code },
});

// Two neighbouring areas near London.
const AREAS = [square('E01', -0.2, 51.5, -0.1, 51.6), square('E02', -0.1, 51.5, 0, 51.6)];

const code = (f: Feature | null) => (f?.properties as { lsoa11cd: string } | null)?.lsoa11cd;

describe('locateArea', () => {
  it('finds the area containing the point', () => {
    expect(code(locateArea(AREAS, -0.15, 51.55))).toBe('E01');
    expect(code(locateArea(AREAS, -0.05, 51.55))).toBe('E02');
  });

  it('falls back to the nearest area just off its edge', () => {
    expect(code(locateArea(AREAS, -0.05, 51.62))).toBe('E02');
  });

  it('rejects a point beyond the threshold', () => {
    expect(locateArea(AREAS, 2.35, 48.86)).toBeNull(); // Paris
    expect(locateArea(AREAS, -0.05, 51.55 + NEAR_ME_MAX_DEGREES + 0.01)).toBeNull();
  });

  it('honours a given threshold', () => {
    expect(code(locateArea(AREAS, -0.05, 51.8, 1))).toBe('E02');
  });

  it('finds nothing among no areas', () => {
    expect(locateArea([], -0.1, 51.5)).toBeNull();
  });
});

type Geo = Pick<Geolocation, 'getCurrentPosition'>;

const fixAt = (lng: number, lat: number): Geo => ({
  getCurrentPosition: (ok) =>
    ok({ coords: { longitude: lng, latitude: lat } } as GeolocationPosition),
});

const failWith = (code: number): Geo => ({
  getCurrentPosition: (_ok, err) =>
    err?.({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }),
});

describe('findMyArea', () => {
  it('resolves to the area at the position', async () => {
    expect(code(await findMyArea(fixAt(-0.15, 51.55), AREAS))).toBe('E01');
  });

  it.each([
    [1, 'denied', 'Location access was blocked. Allow it for this site, or search a postcode.'],
    [2, 'unavailable', 'Your location is unavailable right now. Try a postcode instead.'],
    [3, 'timeout', 'Finding your location took too long. Try again, or search a postcode.'],
  ])('geolocation error %i is %s', async (errCode, kind, message) => {
    const err = await findMyArea(failWith(errCode), AREAS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect((err as LocateError).kind).toBe(kind);
    expect((err as LocateError).message).toBe(message);
  });

  it('says when the position is outside GB', async () => {
    const err = await findMyArea(fixAt(2.35, 48.86), AREAS).catch((e: unknown) => e);
    expect((err as LocateError).kind).toBe('outside');
    expect((err as LocateError).message).toBe(
      'You appear to be outside Great Britain, which is all this map covers.'
    );
  });

  it('says when the browser has no geolocation', async () => {
    const err = await findMyArea(undefined, AREAS).catch((e: unknown) => e);
    expect((err as LocateError).kind).toBe('unsupported');
  });
});
