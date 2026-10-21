import { describe, expect, it } from 'vitest';
import { nextAttempt, searchBlockedMessage } from './loadState';
import { SEARCH_LOAD_FAILED_MESSAGE, STILL_LOADING_MESSAGE } from './utils';

describe('searchBlockedMessage', () => {
  it('is null once the areas have loaded', () => {
    expect(searchBlockedMessage(true, null)).toBeNull();
  });
  it('says the map is still loading while the fetch runs', () => {
    expect(searchBlockedMessage(false, null)).toBe(STILL_LOADING_MESSAGE);
  });
  it('says the data did not load after a failure', () => {
    expect(searchBlockedMessage(false, 'Failed to fetch')).toBe(SEARCH_LOAD_FAILED_MESSAGE);
    expect(SEARCH_LOAD_FAILED_MESSAGE).toMatch(/did not load/);
  });
  it('ignores a stale error once the areas have loaded', () => {
    expect(searchBlockedMessage(true, 'Failed to fetch')).toBeNull();
  });
});

describe('nextAttempt', () => {
  it('steps the counter so the load effect re-runs', () => {
    expect(nextAttempt(0)).toBe(1);
    expect(nextAttempt(nextAttempt(0))).toBe(2);
  });
});
