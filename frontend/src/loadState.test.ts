import { describe, expect, it } from 'vitest';
import { NO_WEBGL_MESSAGE, nextAttempt, searchBlockedMessage, webglAvailable } from './loadState';
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

describe('webglAvailable', () => {
  const maker = (contexts: Record<string, unknown>) => ({
    createElement: () => ({ getContext: (id: string) => contexts[id] ?? null }),
  });
  it('is true with a WebGL 2 context', () => {
    expect(webglAvailable(maker({ webgl2: {} }))).toBe(true);
  });
  it('falls back to WebGL 1', () => {
    expect(webglAvailable(maker({ webgl: {} }))).toBe(true);
  });
  it('is false when neither context can be made', () => {
    expect(webglAvailable(maker({}))).toBe(false);
  });
  it('is false when making the canvas throws, or with no document', () => {
    const throwing = {
      createElement: () => {
        throw new Error('blocked');
      },
    };
    expect(webglAvailable(throwing)).toBe(false);
    expect(webglAvailable(null)).toBe(false);
  });
  it('says the panel still works', () => {
    expect(NO_WEBGL_MESSAGE).toMatch(/WebGL/);
    expect(NO_WEBGL_MESSAGE).toMatch(/still work/);
  });
});
