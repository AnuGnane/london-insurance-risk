// The share URL: ?pc=<postcode>&area=<lsoa>&area2=<lsoa>&filter=<mode>&nation=<id>.
// App reads it once on load and keeps it in sync with the selection; ShareButton
// shares whatever it currently says.
import type { ColorMode } from './types';
import { COLOR_MODES, NATIONS, type Nation } from './utils';

export interface ShareState {
  /** The main area. */
  area: string | null;
  /** The comparison's second area (only beside a main area). */
  area2: string | null;
  /** The postcode behind the main area, if it came from a search. */
  pc: string | null;
  filter: ColorMode;
  /** The rankings' nation; null = all of GB. */
  nation: Nation | null;
}

/** The colour modes a ?filter= may name (the premium is the default, not a filter). */
export const VALID_FILTERS: readonly ColorMode[] = COLOR_MODES.map((m) => m.mode).filter(
  (m) => m !== 'composite'
);

/** A shared link's state; unknown filters and nations fall back to the defaults. */
export function parseShareUrl(search: string): ShareState {
  const params = new URLSearchParams(search);
  const area = params.get('area');
  const f = params.get('filter');
  const n = params.get('nation');
  return {
    area,
    area2: area ? params.get('area2') : null,
    pc: params.get('pc'),
    filter: VALID_FILTERS.find((m) => m === f) ?? 'composite',
    nation: NATIONS.find((x) => x.id === n)?.id ?? null,
  };
}

/** The URL for a state; a postcode or a second area is only kept beside a main area. */
export function buildShareUrl(pathname: string, s: ShareState): string {
  const params = new URLSearchParams();
  if (s.pc && s.area) params.set('pc', s.pc);
  if (s.area) params.set('area', s.area);
  if (s.area && s.area2) params.set('area2', s.area2);
  if (s.filter !== 'composite') params.set('filter', s.filter);
  if (s.nation) params.set('nation', s.nation);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
