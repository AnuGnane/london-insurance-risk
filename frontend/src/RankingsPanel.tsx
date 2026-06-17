import { useEffect, useState } from 'react';
import type { Feature } from 'geojson';
import type { RankingArea } from './types';
import { gbp, dominantDriver } from './utils';
import { getRankings } from './api';

interface RankingsPanelProps {
  onSelectRanking: (code: string, coords?: [number, number]) => void;
  lookup: Map<string, Feature>;
}

type Order = 'desc' | 'asc';

const DRIVER_SHORT: Record<string, string> = {
  vehicle_crime: 'crime-driven',
  road_casualties: 'collision-driven',
  deprivation: 'deprivation-driven',
  population_density: 'density-driven',
};

export const RankingsPanel: React.FC<RankingsPanelProps> = ({
  onSelectRanking,
  lookup,
}) => {
  const [rankings, setRankings] = useState<RankingArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order>('desc');

  // Rankings are derived from the already-loaded GeoJSON (no API on Pages).
  useEffect(() => {
    setLoading(true);
    setRankings(getRankings(lookup, order, 10));
    setLoading(false);
  }, [order, lookup]);

  return (
    <div className="card rankings-panel">
      <div className="rankings-head">
        <div className="card-title" style={{ margin: 0 }}>
          {order === 'desc' ? 'Highest-risk areas' : 'Lowest-risk areas'}
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <span className="loader" />
        </div>
      ) : (
        <div>
          {rankings.map((r, i) => {
            const coords =
              r.lng != null && r.lat != null
                ? ([r.lng, r.lat] as [number, number])
                : undefined;

            // Dominant driver from the in-memory GeoJSON lookup.
            const feature = lookup.get(r.code);
            const driver = feature?.properties
              ? dominantDriver(feature.properties as Record<string, any>)
              : null;
            const driverChip = driver ? DRIVER_SHORT[driver] : null;

            return (
              <button
                key={r.code}
                className="ranking-item"
                onClick={() => onSelectRanking(r.code, coords)}
              >
                <span className="ranking-info">
                  <span className="ranking-name">
                    {i + 1}. {r.name}
                  </span>
                  <span className="ranking-meta">
                    <span className="stat-label">
                      {gbp(r.calibrated_premium)} expected
                    </span>
                    {driverChip && (
                      <span className="driver-chip">{driverChip}</span>
                    )}
                  </span>
                </span>
                <span className="ranking-score">
                  {r.risk_index.toFixed(1)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
