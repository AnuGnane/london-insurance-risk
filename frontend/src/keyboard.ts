// Keyboard navigation: a roving-tabindex list (one item in the tab order, arrows
// move between items) with type-ahead on the items' labels.
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/** Type-ahead keystrokes closer together than this extend one search, in ms. */
export const TYPEAHEAD_RESET_MS = 600;

/**
 * Where a navigation key moves the active index in a list of `count` items:
 * Up/Down one step (stopping at the ends), Home/End to the ends. `null` when the
 * key is not a navigation key or the list is empty.
 */
export function nextIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return Math.min(last, current + 1);
    case 'ArrowUp':
      return Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/**
 * The first label starting with `query` (case-insensitive), searching from the
 * item after `from` and wrapping round; for a query that extends the current
 * item's own match (typing "sw" on "Swansea"), the current item stays. `null`
 * when nothing matches.
 */
export function typeAheadIndex(labels: readonly string[], query: string, from: number): number | null {
  const q = query.toLowerCase();
  if (!q || labels.length === 0) return null;
  const starts = (i: number) => labels[i].toLowerCase().startsWith(q);
  if (q.length > 1 && from >= 0 && from < labels.length && starts(from)) return from;
  for (let k = 1; k <= labels.length; k++) {
    const i = (from + k) % labels.length;
    if (starts(i)) return i;
  }
  return null;
}

/**
 * A roving-tabindex list. Spread `itemProps(i)` on each item: the active one is
 * the only one in the tab order, Up/Down/Home/End move focus, and printable keys
 * jump by label. Enter/Space are left to the items (native buttons click). A new
 * `resetKey` (say, a different sort order) starts again from the first item.
 */
export function useRovingList(labels: readonly string[], resetKey: string) {
  const [state, setState] = useState({ key: resetKey, index: 0 });
  const refs = useRef<(HTMLElement | null)[]>([]);
  const typed = useRef({ query: '', at: 0 });

  const raw = state.key === resetKey ? state.index : 0;
  const active = Math.max(0, Math.min(raw, labels.length - 1));

  const moveTo = (i: number) => {
    setState({ key: resetKey, index: i });
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const next = nextIndex(e.key, i, labels.length);
    if (next != null) {
      e.preventDefault();
      moveTo(next);
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === ' ') return;
    const now = e.timeStamp;
    const query =
      now - typed.current.at < TYPEAHEAD_RESET_MS ? typed.current.query + e.key : e.key;
    typed.current = { query, at: now };
    const hit = typeAheadIndex(labels, query, i);
    if (hit != null) {
      e.preventDefault();
      moveTo(hit);
    }
  };

  const itemProps = (i: number) => ({
    ref: (el: HTMLElement | null) => {
      refs.current[i] = el;
    },
    tabIndex: i === active ? 0 : -1,
    onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i),
    onFocus: () => {
      if (i !== active) setState({ key: resetKey, index: i });
    },
  });

  return { active, itemProps };
}
