import { describe, expect, it } from 'vitest';
import { isCurrent, searchTarget } from './search';

describe('searchTarget', () => {
  it.each([
    // [started as compare, armed when the lookup lands, target]
    [false, false, 'main'],
    [false, true, 'main'],
    [true, true, 'compare'],
    [true, false, 'drop'],
  ] as const)('started %s, armed now %s -> %s', (started, armedNow, want) => {
    expect(searchTarget(started, armedNow)).toBe(want);
  });

  it('a compare cancelled during the lookup never pins its result', () => {
    expect(searchTarget(true, false)).not.toBe('compare');
  });

  it('a cancelled compare does not fall back to replacing the main area', () => {
    expect(searchTarget(true, false)).not.toBe('main');
  });
});

describe('isCurrent', () => {
  it('keeps a fix when nothing was selected while locating', () => {
    expect(isCurrent(3, 3)).toBe(true);
  });

  it('drops a fix that lands after a later tap, search or pair', () => {
    expect(isCurrent(3, 4)).toBe(false);
  });

  it('drops the first of two "Near me" taps when both are in flight', () => {
    let latest = 0;
    const first = ++latest;
    const second = ++latest;
    expect(isCurrent(first, latest)).toBe(false);
    expect(isCurrent(second, latest)).toBe(true);
  });
});
