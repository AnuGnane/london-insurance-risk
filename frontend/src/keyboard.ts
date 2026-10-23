// Keyboard navigation: a roving-tabindex list (one item in the tab order, arrows
// move between items) with type-ahead on the items' labels.
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/** Type-ahead keystrokes closer together than this extend one search, in ms. */
export const TYPEAHEAD_RESET_MS = 600;

/**
 * Where a navigation key moves the active index in a list of `count` items:
 * Up/Down one step (stopping at the ends, or going round them with `wrap`),
 * Home/End to the ends. `null` when the key is not a navigation key or the list
 * is empty.
 */
export function nextIndex(
  key: string,
  current: number,
  count: number,
  { wrap = false }: { wrap?: boolean } = {}
): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return wrap ? (current + 1) % count : Math.min(last, current + 1);
    case 'ArrowUp':
      return wrap ? (current - 1 + count) % count : Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/**
 * Where a key moves the choice in a segmented control (a radio group) of `count`
 * items: Left/Up back one and Right/Down on one, going round the ends, Home/End
 * to the ends. `null` for any other key or an empty group.
 */
export function segmentedIndex(key: string, current: number, count: number): number | null {
  const vertical = { ArrowRight: 'ArrowDown', ArrowLeft: 'ArrowUp' }[key] ?? key;
  return nextIndex(vertical, current, count, { wrap: true });
}

/**
 * The first label starting with `query` (case-insensitive), searching from the
 * item after `from` and wrapping round; for a query that extends the current
 * item's own match (typing "sw" on "Swansea"), the current item stays. A query
 * of one letter repeated ("ss") cycles like that letter alone. `null` when
 * nothing matches.
 */
export function typeAheadIndex(labels: readonly string[], query: string, from: number): number | null {
  // One letter typed again ("ss") steps on to the next match, as a single letter does.
  const q = /^(.)\1+$/su.test(query) ? query[0].toLowerCase() : query.toLowerCase();
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

/** What Escape does on the page: clear the search box, close the detail panel, or dismiss the callout. */
export type EscapeAction = 'clear-search' | 'close' | 'dismiss';

/**
 * What a page-level `key` press does, given what is showing: Escape in the search
 * box with text in it clears the box first; otherwise it closes an open detail
 * panel, or, with none open, dismisses the first-visit callout. `null` for any
 * other key, or when focus is in another text field, which keeps its own Escape.
 */
export function escapeAction(
  key: string,
  state: {
    detailOpen: boolean;
    calloutShown: boolean;
    inTextField: boolean;
    inSearchBox?: boolean;
    searchHasText?: boolean;
  }
): EscapeAction | null {
  if (key !== 'Escape' || state.inTextField) return null;
  if (state.inSearchBox && state.searchHasText) return 'clear-search';
  if (state.detailOpen) return 'close';
  if (state.calloutShown) return 'dismiss';
  return null;
}

/** The areas the sheet shows: the detail's code and, while comparing, the second one's. */
export interface SheetCodes {
  code: string | null;
  code2: string | null;
  /** A count of openings of the main area (a search, a map tap, a ranking tap), so
   *  opening the area already shown again is told apart from a re-render (R-74). */
  tick: number;
}

/** Whether the main area was opened again while it was already shown: same code, new tick. */
export function reopenedSameArea(prev: SheetCodes, next: SheetCodes): boolean {
  return next.code != null && next.code === prev.code && next.tick !== prev.tick;
}

/**
 * Whether the sheet scrolls back to the top: true when either area changes to a new
 * one, or the area shown is opened again, so its headline premium is in view; false
 * when an area closes or nothing changed (a re-render).
 */
export function shouldScrollToTop(prev: SheetCodes, next: SheetCodes): boolean {
  const opened = (a: string | null, b: string | null) => b != null && b !== a;
  return (
    opened(prev.code, next.code) || opened(prev.code2, next.code2) || reopenedSameArea(prev, next)
  );
}

/** `<input>` types that are not typed into, so do not keep their own Escape. */
const NON_TEXT_INPUTS = ['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'];

/** Whether `el` is a field that types text (and so keeps its own Escape). */
export function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.includes(el.type);
  return el.isContentEditable || ['TEXTAREA', 'SELECT'].includes(el.tagName);
}
