import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addRecentSearch,
  clearRecentSearches,
  isNorthernIreland,
  loadRecentSearches,
  normalisePostcode,
  parsePostcode,
  PostcodeError,
  RECENT_SEARCHES_MAX,
  resolvePostcode,
} from './postcode';

describe('normalisePostcode', () => {
  it.each([
    ['e1 6an', 'E1 6AN'],
    ['  E16AN ', 'E1 6AN'],
    ['sw1a   1aa', 'SW1A 1AA'],
    ['SW1A1AA', 'SW1A 1AA'],
    ['m1 1ae', 'M1 1AE'],
    ['eh1  1yz', 'EH1 1YZ'],
    ['sw1a', 'SW1A'],
    [' e1 ', 'E1'],
  ])('%j -> %j', (input, want) => {
    expect(normalisePostcode(input)).toBe(want);
  });
});

describe('parsePostcode', () => {
  it('recognises full postcodes and bare outcodes', () => {
    expect(parsePostcode('e16an')).toEqual({ kind: 'postcode', text: 'E1 6AN' });
    expect(parsePostcode('SW1A')).toEqual({ kind: 'outcode', text: 'SW1A' });
    expect(parsePostcode('e1')).toEqual({ kind: 'outcode', text: 'E1' });
    expect(parsePostcode('B33 8TH')).toEqual({ kind: 'postcode', text: 'B33 8TH' });
  });
  it.each(['', '   ', 'hello', '12345', 'E1 6A', 'E1 6ANN', 'SW1A 1A', 'Q'])(
    'rejects %j',
    (input) => {
      expect(parsePostcode(input)).toBeNull();
    }
  );
});

describe('isNorthernIreland', () => {
  it('flags BT postcodes and districts only', () => {
    expect(isNorthernIreland(parsePostcode('BT1 1AA')!)).toBe(true);
    expect(isNorthernIreland(parsePostcode('bt7')!)).toBe(true);
    expect(isNorthernIreland(parsePostcode('B1 1AA')!)).toBe(false);
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof PostcodeError ? e.code : `not a PostcodeError: ${String(e)}`;
  }
  return 'resolved';
};

describe('resolvePostcode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a full postcode via /postcodes', async () => {
    const f = vi.fn(async () =>
      json({ result: { postcode: 'E1 6AN', longitude: -0.0723, latitude: 51.5166 } })
    );
    const hit = await resolvePostcode(' e16an ', f);
    expect(String(f.mock.calls[0])).toBe('https://api.postcodes.io/postcodes/E1%206AN');
    expect(hit).toEqual({
      query: { kind: 'postcode', text: 'E1 6AN' },
      label: 'E1 6AN',
      lng: -0.0723,
      lat: 51.5166,
    });
  });

  it('resolves an outcode via /outcodes', async () => {
    const f = vi.fn(async () =>
      json({ result: { outcode: 'SW1A', longitude: -0.135, latitude: 51.501 } })
    );
    const hit = await resolvePostcode('sw1a', f);
    expect(String(f.mock.calls[0])).toBe('https://api.postcodes.io/outcodes/SW1A');
    expect(hit.query.kind).toBe('outcode');
    expect(hit.label).toBe('SW1A');
  });

  it('rejects malformed input and Northern Ireland without a network call', async () => {
    const f = vi.fn();
    expect(await codeOf(resolvePostcode('not a postcode', f))).toBe('malformed');
    expect(await codeOf(resolvePostcode('BT1 1AA', f))).toBe('northern_ireland');
    expect(f).not.toHaveBeenCalled();
  });

  it('maps HTTP failures to distinct errors', async () => {
    expect(await codeOf(resolvePostcode('ZZ1 1ZZ', async () => json({}, 404)))).toBe('not_found');
    expect(await codeOf(resolvePostcode('E1 6AN', async () => json({}, 429)))).toBe(
      'rate_limited'
    );
    expect(await codeOf(resolvePostcode('E1 6AN', async () => json({}, 500)))).toBe('network');
  });

  it('reports a result with no coordinates', async () => {
    const f = async () => json({ result: { postcode: 'E1 6AN', longitude: null, latitude: null } });
    expect(await codeOf(resolvePostcode('E1 6AN', f))).toBe('no_location');
  });

  it('tells offline apart from other network failures', async () => {
    const fail = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    vi.stubGlobal('navigator', { onLine: false });
    expect(await codeOf(resolvePostcode('E1 6AN', fail))).toBe('offline');
    vi.stubGlobal('navigator', { onLine: true });
    expect(await codeOf(resolvePostcode('E1 6AN', fail))).toBe('network');
  });

  it('gives each error a distinct message for the panel', () => {
    const codes = [
      'malformed', 'northern_ireland', 'not_found', 'no_location',
      'rate_limited', 'offline', 'network',
    ] as const;
    const messages = codes.map((c) => new PostcodeError(c).message);
    expect(new Set(messages).size).toBe(codes.length);
    expect(new PostcodeError('northern_ireland').message).toMatch(/Northern Ireland/);
  });
});

/** An in-memory Storage stand-in. */
const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('recent searches', () => {
  it('keeps the newest first, without duplicates, capped', () => {
    const s = memoryStorage();
    let list = loadRecentSearches(s);
    expect(list).toEqual([]);
    for (const pc of ['E1 6AN', 'SW1A', 'M1 1AE', 'E1 6AN', 'B33 8TH', 'EH1 1YZ', 'CF10 1EP']) {
      list = addRecentSearch(list, pc, s);
    }
    expect(list).toHaveLength(RECENT_SEARCHES_MAX);
    expect(list).toEqual(['CF10 1EP', 'EH1 1YZ', 'B33 8TH', 'E1 6AN', 'M1 1AE']);
    expect(loadRecentSearches(s)).toEqual(list);
  });

  it('clears', () => {
    const s = memoryStorage();
    addRecentSearch([], 'E1 6AN', s);
    clearRecentSearches(s);
    expect(loadRecentSearches(s)).toEqual([]);
  });

  it('ignores corrupt stored values', () => {
    const s = memoryStorage();
    s.setItem('price-of-place:recent-searches', '{not json');
    expect(loadRecentSearches(s)).toEqual([]);
    s.setItem('price-of-place:recent-searches', JSON.stringify(['E1 6AN', 42, null]));
    expect(loadRecentSearches(s)).toEqual(['E1 6AN']);
  });

  it('works in memory when storage throws or is missing', () => {
    expect(loadRecentSearches(throwingStorage)).toEqual([]);
    expect(addRecentSearch(['SW1A'], 'E1 6AN', throwingStorage)).toEqual(['E1 6AN', 'SW1A']);
    expect(() => clearRecentSearches(throwingStorage)).not.toThrow();
    expect(addRecentSearch([], 'E1 6AN', null)).toEqual(['E1 6AN']);
  });
});
