// The landing's "what am I looking at" card: shown until dismissed, never beside
// an area. Its sentences are taken word for word from README.md's opening and
// the About intro (callout.test.ts checks); the area count is not among them.
import { defaultStorage, type StorageLike } from './postcode';

/** One boolean, beside the recent searches' key; nothing else is stored. */
const CALLOUT_KEY = 'price-of-place:callout-dismissed';

export const CALLOUT_COPY: readonly string[] = [
  "A territorial risk proxy ranking Great Britain's small areas by factors that correlate with motor-insurance claims, using only public data.",
  'It is not an insurance quote and uses no individual driver or vehicle details.',
];

/** The card shows on the landing until dismissed, and never once an area is open. */
export function shouldShowCallout(dismissed: boolean, hasDetail: boolean): boolean {
  return !dismissed && !hasDetail;
}

/** Whether "Got it" was tapped on an earlier visit. False if storage is unavailable. */
export function loadCalloutDismissed(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(CALLOUT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember "Got it"; when storage is blocked the card still goes for this visit. */
export function saveCalloutDismissed(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(CALLOUT_KEY, '1');
  } catch {
    // Storage full or blocked: dismissed for this visit only.
  }
}
