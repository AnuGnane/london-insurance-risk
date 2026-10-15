import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Feature } from 'geojson';
import {
  gbp,
  dominantDriver,
  quintileColor,
  COMPONENT_LABELS,
  NATIONS,
  type Nation,
} from './utils';
import { countRankable, getRankings } from './api';
import { nextIndex, useRovingList } from './keyboard';

interface RankingsPanelProps {
  onSelectRanking: (code: string, coords?: [number, number]) => void;
  lookup: Map<string, Feature>;
  nation: Nation | null;
  onNationChange: (n: Nation | null) => void;
}

type Order = 'desc' | 'asc';

// The chip row: All, then each nation (null = all of GB).
const NATION_CHIPS: readonly { id: Nation | null; label: string }[] = [
  { id: null, label: 'All' },
  ...NATIONS.map((n) => ({ id: n.id, label: n.label })),
];

export const RankingsPanel: React.FC<RankingsPanelProps> = ({
  onSelectRanking,
  lookup,
  nation,
  onNationChange,
}) => {
  const [order, setOrder] = useState<Order>('desc');
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Rankings are derived from the already-loaded GeoJSON (no API on Pages).
  const rankings = useMemo(
    () => getRankings(lookup, order, 10, nation ?? undefined),
    [order, lookup, nation]
  );
  const nationLabel = NATIONS.find((n) => n.id === nation)?.label;
  const areaCount = useMemo(
    () => (nation ? countRankable(lookup, nation) : 0),
    [lookup, nation]
  );

  // The list is one tab stop: arrows, Home/End and type-ahead move within it.
  const names = useMemo(() => rankings.map((r) => r.name), [rankings]);
  const roving = useRovingList(names, `${order}:${nation ?? 'all'}`);

  // Radio-group keys: arrows move the selection (and focus) along the chips,
  // wrapping round; Home/End go to the first and last chip.
  const onChipKey = (e: KeyboardEvent, index: number) => {
    const key = { ArrowRight: 'ArrowDown', ArrowLeft: 'ArrowUp' }[e.key] ?? e.key;
    const next = nextIndex(key, index, NATION_CHIPS.length, { wrap: true });
    if (next == null) return;
    e.preventDefault();
    onNationChange(NATION_CHIPS[next].id);
    chipRefs.current[next]?.focus();
  };

  return (
    <div className="rankings">
      <div
        className="seg seg-sm nation-chips"
        role="radiogroup"
        aria-label="Rank areas in"
      >
        {NATION_CHIPS.map((c, i) => {
          const on = c.id === nation;
          return (
            <button
              key={c.label}
              ref={(el) => {
                chipRefs.current[i] = el;
              }}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={on ? 'seg-on' : ''}
              onClick={() => onNationChange(c.id)}
              onKeyDown={(e) => onChipKey(e, i)}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <div className="rankings-head">
        <h2 className="section-title">
          {order === 'desc' ? 'Most expensive areas' : 'Least expensive areas'}
          {/* Always mounted, so screen readers announce the scope when it changes. */}
          <span className="rankings-scope" role="status" aria-live="polite">
            {nationLabel && areaCount > 0
              ? `${nationLabel} · ${areaCount.toLocaleString('en-GB')} areas`
              : null}
          </span>
        </h2>
        <div className="seg seg-sm">
          <button
            className={order === 'desc' ? 'seg-on' : ''}
            onClick={() => setOrder('desc')}
          >
            Most
          </button>
          <button
            className={order === 'asc' ? 'seg-on' : ''}
            onClick={() => setOrder('asc')}
          >
            Least
          </button>
        </div>
      </div>

      <div
        role="listbox"
        aria-label={`${order === 'desc' ? 'Most' : 'Least'} expensive areas${nationLabel ? ` in ${nationLabel}` : ''}`}
      >
        {rankings.map((r, i) => {
          const coords =
            r.lng != null && r.lat != null
              ? ([r.lng, r.lat] as [number, number])
              : undefined;

          const feature = lookup.get(r.code);
          const driver = feature?.properties
            ? dominantDriver(feature.properties)
            : null;

          return (
            <button
              key={r.code}
              className="rank-row"
              role="option"
              aria-selected={i === roving.active}
              {...roving.itemProps(i)}
              onClick={() => onSelectRanking(r.code, coords)}
            >
              <span className="rank-num">{i + 1}</span>
              <span
                className="rank-dot"
                style={{ background: quintileColor(r.quintile) }}
              />
              <span className="rank-info">
                <span className="rank-name">{r.name}</span>
                <span className="rank-meta">
                  {driver && (
                    <span className={`driver-chip ${driver.dir === 'up' ? 'chip-up' : 'chip-down'}`}>
                      {driver.dir === 'up' ? '▲' : '▼'} {COMPONENT_LABELS[driver.key] ?? driver.key}
                    </span>
                  )}
                </span>
              </span>
              <span className="rank-premium">{gbp(r.calibrated_premium)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
