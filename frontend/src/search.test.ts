import { describe, expect, it } from 'vitest';
import { searchTarget } from './search';

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
