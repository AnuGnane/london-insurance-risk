// Live regions read a change, not a value: setting the same text twice is silent.
// `announce` clears the region, then sets the text after a short pause, so a repeat
// tap is read again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ANNOUNCE_CLEAR_MS } from './layout';

/**
 * Clear the live region now, set `text` after `delayMs`. Returns a cancel function
 * that drops the pending set (a newer message, or unmount).
 */
export function announce<T extends string | null>(
  set: (value: T | '') => void,
  text: T,
  delayMs: number = ANNOUNCE_CLEAR_MS,
): () => void {
  set('');
  const id = setTimeout(() => set(text), delayMs);
  return () => clearTimeout(id);
}

/**
 * A live region's text: `say` re-announces even an unchanged message; `set` is plain
 * state (no clear first) and cancels a pending `say`.
 */
export function useAnnouncer<T extends string | null>(
  initial: T,
): [T | '', (text: T) => void, (text: T | '') => void] {
  const [text, setText] = useState<T | ''>(initial);
  const cancel = useRef<() => void>(() => {});
  useEffect(() => () => cancel.current(), []);
  const say = useCallback((t: T) => {
    cancel.current();
    cancel.current = announce<T>(setText, t);
  }, []);
  const set = useCallback((t: T | '') => {
    cancel.current();
    cancel.current = () => {};
    setText(t);
  }, []);
  return [text, say, set];
}
