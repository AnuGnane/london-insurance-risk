import { useEffect, useState } from 'react';
import type { Feature } from 'geojson';
import type { RankingArea } from './types';
import { gbp, dominantDriver, quintileColor, COMPONENT_LABELS } from './utils';
import { getRankings } from './api';

interface RankingsPanelProps {
  onSelectRanking: (code: string, coords?: [number, number]) => void;
  lookup: Map<string, Feature>;
}

type Order = 'desc' | 'asc';

export const RankingsPanel: React.FC<RankingsPanelProps> = ({
  onSelectRanking,
  lookup,
}) => {
  const [rankings, setRankings] = useState<RankingArea[]>([]);
  const [order, setOrder] = useState<Order>('desc');

  // Rankings are derived from the already-loaded GeoJSON (no API on Pages).
  useEffect(() => {
    setRankings(getRankings(lookup, order, 10));
  }, [order, lookup]);

  return (
    <div className="rankings">
      <div className="rankings-head">
        <div className="section-title">
          {order === 'desc' ? 'Most expensive areas' : 'Least expensive areas'}
        </div>
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

      <div>
        {rankings.map((r, i) => {
          const coords =
            r.lng != null && r.lat != null
              ? ([r.lng, r.lat] as [number, number])
              : undefined;

          const feature = lookup.get(r.code);
          const driver = feature?.properties
            ? dominantDriver(feature.properties as Record<string, any>)
            : null;

          return (
            <button
              key={r.code}
              className="rank-row"
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
                    <span className="driver-chip">
                      {COMPONENT_LABELS[driver] ?? driver}
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
