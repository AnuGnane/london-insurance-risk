import { describe, expect, it } from 'vitest';
import { nextIndex, typeAheadIndex } from './keyboard';

describe('nextIndex', () => {
  it('steps down and up, stopping at the ends', () => {
    expect(nextIndex('ArrowDown', 0, 10)).toBe(1);
    expect(nextIndex('ArrowDown', 9, 10)).toBe(9);
    expect(nextIndex('ArrowUp', 5, 10)).toBe(4);
    expect(nextIndex('ArrowUp', 0, 10)).toBe(0);
  });
  it('jumps to the ends with Home and End', () => {
    expect(nextIndex('Home', 7, 10)).toBe(0);
    expect(nextIndex('End', 2, 10)).toBe(9);
  });
  it('ignores other keys and empty lists', () => {
    expect(nextIndex('Enter', 3, 10)).toBeNull();
    expect(nextIndex('a', 3, 10)).toBeNull();
    expect(nextIndex('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('typeAheadIndex', () => {
  const names = ['Swansea 025F', 'Cardiff 033F', 'Swansea 025B', 'Camden 028B', 'Newport 004A'];
  it('finds the next name starting with a letter, after the current one', () => {
    expect(typeAheadIndex(names, 's', 0)).toBe(2);
    expect(typeAheadIndex(names, 'c', 1)).toBe(3);
  });
  it('wraps round the end of the list', () => {
    expect(typeAheadIndex(names, 's', 2)).toBe(0);
    expect(typeAheadIndex(names, 'n', 4)).toBe(4);
  });
  it('keeps the current item while a longer query still matches it', () => {
    expect(typeAheadIndex(names, 'ca', 1)).toBe(1);
    expect(typeAheadIndex(names, 'cam', 1)).toBe(3);
  });
  it('is case-insensitive and returns null when nothing matches', () => {
    expect(typeAheadIndex(names, 'N', 0)).toBe(4);
    expect(typeAheadIndex(names, 'x', 0)).toBeNull();
    expect(typeAheadIndex([], 's', 0)).toBeNull();
    expect(typeAheadIndex(names, '', 0)).toBeNull();
  });
});
