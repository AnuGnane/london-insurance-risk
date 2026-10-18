import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addRecentSearch,
  clearRecentSearches,
  isNorthernIreland,
  loadOutcodeTable,
  loadRecentSearches,
  outcodeFallback,
  normalisePostcode,
  parsePostcode,
  PostcodeError,
  RECENT_SEARCHES_MAX,
  resolveOutcodeFallback,
  resolvePostcode,
} from './postcode';
import { readFileSync } from 'node:fs';
import { POSTCODE_LOOKUP_TIMEOUT_MS } from './layout';

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
    expect(f).toHaveBeenCalledWith('https://api.postcodes.io/postcodes/E1%206AN', {
      signal: expect.any(AbortSignal),
    });
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
    expect(f).toHaveBeenCalledWith('https://api.postcodes.io/outcodes/SW1A', {
      signal: expect.any(AbortSignal),
    });
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

  describe('a lookup that never answers', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Answers only by rejecting once its signal aborts, like a stalled request. */
    const stalled = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          );
        })
    );

    it('times out after POSTCODE_LOOKUP_TIMEOUT_MS', async () => {
      vi.useFakeTimers();
      const result = codeOf(resolvePostcode('E1 6AN', stalled));
      await vi.advanceTimersByTimeAsync(POSTCODE_LOOKUP_TIMEOUT_MS - 1);
      expect(stalled.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe('timeout');
    });

    it('leaves no timer behind when the answer comes at once', async () => {
      vi.useFakeTimers();
      const f = vi.fn(async () =>
        json({ result: { postcode: 'E1 6AN', longitude: -0.0723, latitude: 51.5166 } })
      );
      const hit = await resolvePostcode('E1 6AN', f);
      expect(hit.label).toBe('E1 6AN');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('says the service did not answer in time', () => {
      expect(new PostcodeError('timeout').message).toBe(
        "The postcode service (postcodes.io) didn't answer in time. Try again in a moment."
      );
    });
  });

  it('gives each error a distinct message for the panel', () => {
    const codes = [
      'malformed', 'northern_ireland', 'not_found', 'no_location',
      'rate_limited', 'offline', 'network', 'timeout',
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

// A fixture table: the real one is baked on the Mac (make showcase-outcodes).
const TABLE: Record<string, string> = { CV21: 'E01000001', SW1A: 'E01000002' };

describe('resolveOutcodeFallback', () => {
  it('looks up a bare outcode', () => {
    expect(resolveOutcodeFallback('cv21', TABLE)).toEqual({
      outcode: 'CV21',
      lsoa11cd: 'E01000001',
      approximate: true,
    });
  });
  it("looks up a full postcode's outcode", () => {
    expect(resolveOutcodeFallback('sw1a1aa', TABLE)).toEqual({
      outcode: 'SW1A',
      lsoa11cd: 'E01000002',
      approximate: true,
    });
  });
  it('gives null for an outcode not in the table, or a malformed entry', () => {
    expect(resolveOutcodeFallback('ZZ9', TABLE)).toBeNull();
    expect(resolveOutcodeFallback('hello', TABLE)).toBeNull();
  });
  it('gives null for Northern Ireland', () => {
    expect(resolveOutcodeFallback('BT1', { BT1: 'N00000001' })).toBeNull();
  });
});

describe('loadOutcodeTable', () => {
  it('fetches the baked table', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(TABLE)));
    expect(await loadOutcodeTable(f)).toEqual(TABLE);
    expect(String(f.mock.calls[0][0])).toMatch(/data\/outcodes\.json$/);
  });
  it('treats a missing file as no fallback', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    expect(await loadOutcodeTable(f)).toBeNull();
  });
  it('treats an unreachable or unreadable file as no fallback', async () => {
    expect(await loadOutcodeTable(vi.fn().mockRejectedValue(new TypeError('x')))).toBeNull();
    const bad = vi.fn().mockResolvedValue(new Response('not json'));
    expect(await loadOutcodeTable(bad)).toBeNull();
  });
});

describe('outcodeFallback', () => {
  const load = () => Promise.resolve(TABLE);
  it.each(['network', 'timeout'] as const)('falls back when postcodes.io fails with %s', async (code) => {
    const hit = await outcodeFallback('CV21 1AA', new PostcodeError(code), load);
    expect(hit?.lsoa11cd).toBe('E01000001');
  });
  it.each(['offline', 'not_found', 'rate_limited', 'malformed'] as const)(
    'does not fall back on %s',
    async (code) => {
      const loader = vi.fn(load);
      expect(await outcodeFallback('CV21', new PostcodeError(code), loader)).toBeNull();
      expect(loader).not.toHaveBeenCalled();
    }
  );
  it('does not fall back on an error that is not a lookup failure', async () => {
    expect(await outcodeFallback('CV21', new Error('x'), load)).toBeNull();
  });
  it('gives null when there is no table', async () => {
    expect(await outcodeFallback('CV21', new PostcodeError('network'), () => Promise.resolve(null))).toBeNull();
  });
});

describe('no outcode or area code typed into App.tsx', () => {
  const src = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
  it('carries no area code', () => {
    expect(src).not.toMatch(/['"`][ESW]0[0-9]{7}['"`]/);
  });
  it('carries no outcode literal', () => {
    expect(src).not.toMatch(/['"`][A-Z]{1,2}[0-9][A-Z0-9]?( [0-9][A-Z]{2})?['"`]/);
  });
});
