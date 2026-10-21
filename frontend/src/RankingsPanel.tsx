import { useMemo, useState } from 'react';
import type { Feature } from 'geojson';
import {
  gbp,
  dominantDriver,
  quintileColor,
  COMPONENT_LABELS,
  NATIONS,
  LOAD_FAILED_MESSAGE,
  RETRY_LABEL,
  rankingsScope,
  type Nation,
} from './utils';
import { countRankable, getRankings } from './api';
import { useRovingList } from './keyboard';
import { Segmented, type SegmentedOption } from './Segmented';

interface RankingsPanelProps {
  onSelectRanking: (code: string, coords?: [number, number]) => void;
  lookup: Map<string, Feature>;
  nation: Nation | null;
  onNationChange: (n: Nation | null) => void;
  loadError: string | null;
  onRetry: () => void;
}

type Order = 'desc' | 'asc';

// The chip row: All, then each nation (null = all of GB).
const NATION_CHIPS: readonly SegmentedOption<Nation | null>[] = [
  { value: null, label: 'All' },
  ...NATIONS.map((n) => ({ value: n.id, label: n.label })),
];

const ORDERS: readonly SegmentedOption<Order>[] = [
  { value: 'desc', label: 'Most' },
  { value: 'asc', label: 'Least' },
];

export const RankingsPanel: React.FC<RankingsPanelProps> = ({
  onSelectRanking,
  lookup,
  nation,
  onNationChange,
  loadError,
  onRetry,
}) => {
  const [order, setOrder] = useState<Order>('desc');

  // Rankings are derived from the already-loaded GeoJSON (no API on Pages).
  const rankings = useMemo(
    () => getRankings(lookup, order, 10, nation ?? undefined),
    [order, lookup, nation]
  );
  const nationLabel = NATIONS.find((n) => n.id === nation)?.label;
  const areaCount = useMemo(
    () => countRankable(lookup, nation ?? undefined),
    [lookup, nation]
  );

  // The list is one tab stop: arrows, Home/End and type-ahead move within it.
  const names = useMemo(() => rankings.map((r) => r.name), [rankings]);
  const roving = useRovingList(names, `${order}:${nation ?? 'all'}`);

  return (
    <div className="rankings">
      <Segmented
        className="seg-sm nation-chips"
        label="Rank areas in"
        options={NATION_CHIPS}
        value={nation}
        onChange={onNationChange}
      />
      <div className="rankings-head">
        <h2 className="section-title">
          {order === 'desc' ? 'Most expensive areas' : 'Least expensive areas'}
          {/* Always mounted, so screen readers announce the scope when it changes. */}
          <span className="rankings-scope" role="status" aria-live="polite">
            {rankingsScope(nation, areaCount)}
          </span>
        </h2>
        <Segmented
          className="seg-sm"
          label="Order"
          options={ORDERS}
          value={order}
          onChange={setOrder}
        />
      </div>

      {loadError ? (
        // The listbox would stay empty for ever: say why, and offer the same retry as the map.
        <div className="rankings-error">
          <p>{LOAD_FAILED_MESSAGE}</p>
          <button type="button" className="retry-btn" onClick={onRetry}>
            {RETRY_LABEL}
          </button>
        </div>
      ) : (
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
                // Selection follows focus, a single-select listbox's convention (R-26 ruling).
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
      )}
    </div>
  );
};
