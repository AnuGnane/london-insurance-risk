// Where a postcode search's result goes, decided after the lookup returns.
//
// A search started while "Compare with…" was armed (with a main area to compare
// against) pins its result as the second area. The armed state is read again once
// the lookup lands: if the visitor cancelled it (the ×) or the comparison was
// settled another way in the meantime, the result is dropped and nothing new is
// shown. A search started unarmed always goes to the main area.

export type SearchTarget = 'main' | 'compare' | 'drop';

export function searchTarget(startedAsCompare: boolean, armedNow: boolean): SearchTarget {
  if (!startedAsCompare) return 'main';
  return armedNow ? 'compare' : 'drop';
}
