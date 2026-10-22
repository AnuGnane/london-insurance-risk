import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announce, rankingsShownMessage } from './announce';
import { ANNOUNCE_CLEAR_MS } from './layout';

describe('announce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('clears the region, then sets the text after the pause', () => {
    const seen: string[] = [];
    announce((v) => seen.push(v), 'Comparing A with B');
    expect(seen).toEqual(['']);
    vi.advanceTimersByTime(ANNOUNCE_CLEAR_MS - 1);
    expect(seen).toEqual(['']);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['', 'Comparing A with B']);
  });

  it('reads the same text twice as two changes', () => {
    const seen: string[] = [];
    const set = (v: string) => seen.push(v);
    announce(set, 'Comparing A with B');
    vi.runAllTimers();
    announce(set, 'Comparing A with B');
    vi.runAllTimers();
    expect(seen).toEqual(['', 'Comparing A with B', '', 'Comparing A with B']);
  });

  it('drops the pending text when cancelled', () => {
    const seen: string[] = [];
    const cancel = announce((v) => seen.push(v), 'stale');
    cancel();
    vi.runAllTimers();
    expect(seen).toEqual(['']);
  });

  it('keeps a null message distinct from the cleared state', () => {
    const seen: (string | null)[] = [];
    announce<string | null>((v) => seen.push(v), null, 0);
    vi.runAllTimers();
    expect(seen).toEqual(['', null]);
  });
});

describe('rankingsShownMessage', () => {
  it('says how many of how many areas the list shows', () => {
    expect(rankingsShownMessage(30, 1234)).toBe('Showing 30 of 1,234 areas');
    expect(rankingsShownMessage(100, 100)).toBe('Showing 100 of 100 areas');
  });
});
