/**
 * Postcode search: normalise and validate before any network call, resolve a
 * full postcode or a bare outcode (district) to a point via postcodes.io (free,
 * OGL, CORS-enabled), and remember the last few successful searches.
 *
 * The caller finds the containing area by point-in-polygon (featureAtPoint):
 * postcodes.io's `codes.lsoa` is now the 2021/2022 census code, which doesn't
 * match our 2011 `area_code`s, so we use coordinates instead (vintage-independent).
 */

import { POSTCODE_LOOKUP_TIMEOUT_MS } from './layout';
import { dataUrl } from './api';

const POSTCODES_API = 'https://api.postcodes.io';

// UK postcode shape: outward code (area letters + district) then inward code.
const OUTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const FULL_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$/;
const INWARD_LEN = 3;

export type PostcodeQuery =
  | { kind: 'postcode'; text: string }   // e.g. "E1 6AN"
  | { kind: 'outcode'; text: string };   // e.g. "SW1A"

/** Trim, upper-case, collapse spaces and put the single space before the inward code. */
export function normalisePostcode(input: string): string {
  const compact = input.toUpperCase().replace(/\s+/g, '');
  if (compact.length > INWARD_LEN + 1) {
    const withSpace = `${compact.slice(0, -INWARD_LEN)} ${compact.slice(-INWARD_LEN)}`;
    if (FULL_RE.test(withSpace)) return withSpace;
  }
  return compact;
}

/** A valid full postcode or outcode, or null if the input is not UK-shaped. */
export function parsePostcode(input: string): PostcodeQuery | null {
  const text = normalisePostcode(input);
  if (FULL_RE.test(text)) return { kind: 'postcode', text };
  if (OUTCODE_RE.test(text)) return { kind: 'outcode', text };
  return null;
}

/** Northern Ireland postcodes are the BT area. */
export const isNorthernIreland = (q: PostcodeQuery): boolean => /^BT[0-9]/.test(q.text);

export type PostcodeErrorCode =
  | 'malformed'
  | 'northern_ireland'
  | 'not_found'
  | 'no_location'
  | 'rate_limited'
  | 'offline'
  | 'network'
  | 'timeout';

const MESSAGES: Record<PostcodeErrorCode, string> = {
  malformed:
    "That doesn't look like a UK postcode. Try a full one like E1 6AN, or a district like SW1A.",
  northern_ireland:
    'Northern Ireland isn’t covered: data.police.uk and STATS19 both omit NI, so the model is Great Britain only.',
  not_found: "We couldn't find that postcode. Check it and try again.",
  no_location: 'That postcode has no map location (it may be a PO box or newly issued).',
  rate_limited: 'Too many searches in a short time. Wait a few seconds and try again.',
  offline: 'You appear to be offline. Check your connection and try again.',
  network: "Couldn't reach the postcode service (postcodes.io). Try again in a moment.",
  timeout: "The postcode service (postcodes.io) didn't answer in time. Try again in a moment.",
};

export class PostcodeError extends Error {
  readonly code: PostcodeErrorCode;
  constructor(code: PostcodeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PostcodeError';
    this.code = code;
  }
}

export interface PostcodeHit {
  query: PostcodeQuery;
  label: string;   // "E1 6AN", or "SW1A" for a district
  lng: number;
  lat: number;
}

/** The lookup failures that mean postcodes.io is down, not that the entry is wrong:
 *  only these fall back to the bundled outcode table ('offline' would not reach it). */
const FALLBACK_CODES: readonly PostcodeErrorCode[] = ['network', 'timeout'];

export interface OutcodeFallbackHit {
  outcode: string;
  lsoa11cd: string;
  approximate: true;
}

/** An outcode, or a full postcode's outcode, looked up in the outcode → area table. */
export function resolveOutcodeFallback(
  input: string,
  table: Record<string, string>
): OutcodeFallbackHit | null {
  const query = parsePostcode(input);
  if (!query || isNorthernIreland(query)) return null;
  const outcode = query.kind === 'outcode' ? query.text : query.text.split(' ')[0];
  const lsoa11cd = table[outcode];
  return lsoa11cd ? { outcode, lsoa11cd, approximate: true } : null;
}

/** The baked outcode table (make showcase-outcodes), or null when it is missing or
 *  unreadable: no file means no fallback, never an error of its own. */
export async function loadOutcodeTable(
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, string> | null> {
  try {
    const res = await fetchImpl(dataUrl('outcodes.json'));
    if (!res.ok) return null;
    const table: unknown = await res.json();
    return table && typeof table === 'object' ? (table as Record<string, string>) : null;
  } catch {
    return null;
  }
}

// Fetched on the first lookup that needs it, and kept once it loads; a failed load
// is not kept, so the next outage tries again.
let outcodeTable: Promise<Record<string, string> | null> | null = null;
const cachedOutcodeTable = () =>
  (outcodeTable ??= loadOutcodeTable().then((t) => {
    if (!t) outcodeTable = null;
    return t;
  }));

/** The approximate area for a search postcodes.io failed on, or null when the
 *  failure is not an outage, there is no table, or the outcode is not in it. */
export async function outcodeFallback(
  input: string,
  err: unknown,
  load: () => Promise<Record<string, string> | null> = cachedOutcodeTable
): Promise<OutcodeFallbackHit | null> {
  if (!(err instanceof PostcodeError) || !FALLBACK_CODES.includes(err.code)) return null;
  const table = await load();
  return table ? resolveOutcodeFallback(input, table) : null;
}

interface PostcodesIoResult {
  postcode?: string;
  outcode?: string;
  longitude?: number | null;
  latitude?: number | null;
}

/**
 * Resolve a search box entry to a point. Throws PostcodeError with a message
 * fit for the panel; malformed and Northern Ireland input never hits the network.
 */
export async function resolvePostcode(
  input: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = POSTCODE_LOOKUP_TIMEOUT_MS
): Promise<PostcodeHit> {
  const query = parsePostcode(input);
  if (!query) throw new PostcodeError('malformed');
  if (isNorthernIreland(query)) throw new PostcodeError('northern_ireland');

  const path = query.kind === 'postcode' ? 'postcodes' : 'outcodes';
  // A stalled connection would otherwise leave the search "Searching" for the
  // browser's own limit, which on a phone is minutes.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${POSTCODES_API}/${path}/${encodeURIComponent(query.text)}`, {
      signal: controller.signal,
    });
  } catch (e) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) throw new PostcodeError('offline');
    throw new PostcodeError(
      e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network'
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new PostcodeError('not_found');
  if (res.status === 429) throw new PostcodeError('rate_limited');
  if (!res.ok) throw new PostcodeError('network');

  let result: PostcodesIoResult | undefined;
  try {
    ({ result } = await res.json());
  } catch {
    throw new PostcodeError('network');
  }
  if (result?.longitude == null || result?.latitude == null) {
    throw new PostcodeError('no_location');
  }
  const label =
    query.kind === 'postcode' ? result.postcode ?? query.text : result.outcode ?? query.text;
  return { query, label, lng: result.longitude, lat: result.latitude };
}

// ---------------------------------------------------------------------------
// Recent searches (localStorage; every access guarded, the app works without it)
// ---------------------------------------------------------------------------

export const RECENT_SEARCHES_MAX = 5;
const RECENT_KEY = 'price-of-place:recent-searches';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const defaultStorage = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The last successful searches, newest first. Empty if storage is unavailable. */
export function loadRecentSearches(storage: StorageLike | null = defaultStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((s): s is string => typeof s === 'string').slice(0, RECENT_SEARCHES_MAX)
      : [];
  } catch {
    return [];
  }
}

/**
 * Put `label` first (once) in `current`, keep the newest RECENT_SEARCHES_MAX,
 * persist them if storage allows, and return them (the in-memory list still
 * works for this visit when storage throws).
 */
export function addRecentSearch(
  current: string[],
  label: string,
  storage: StorageLike | null = defaultStorage()
): string[] {
  const next = [label, ...current.filter((s) => s !== label)].slice(0, RECENT_SEARCHES_MAX);
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: keep the in-memory list for this visit.
  }
  return next;
}

export function clearRecentSearches(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(RECENT_KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}
