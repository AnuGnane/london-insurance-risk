import { useMemo } from 'react';
import type { Feature } from 'geojson';
import type { AreaDetail, ColorMode } from './types';
import {
  COMPONENT_LABELS,
  gbp,
  computeDistribution,
} from './utils';

interface DetailPanelProps {
  data: AreaDetail | null;
  colorMode: ColorMode;
  lookup: Map<string, Feature>;
}

const QUINTILE_COLORS = [
  '#e5e5e5',
  '#ffffb2',
  '#fecc5c',
  '#fd8d3c',
  '#f03b20',
  '#bd0026',
];

/** Tiny inline sparkline: 20 bars + a marker for the selected bin. */
const Sparkline: React.FC<{
  bins: number[];
  selectedBin: number;
  accent?: string;
}> = ({ bins, selectedBin, accent = 'var(--accent)' }) => (
  <div className="sparkline" aria-hidden="true">
    {bins.map((h, i) => (
      <div
        key={i}
        className={`sparkline-bar${i === selectedBin ? ' sparkline-selected' : ''}`}
        style={{
          height: `${Math.max(2, h * 100)}%`,
          backgroundColor: i === selectedBin ? accent : undefined,
        }}
      />
    ))}
  </div>
);

export const DetailPanel: React.FC<DetailPanelProps> = ({
  data,
  colorMode,
  lookup,
}) => {
  if (!data) return null;

  const color = QUINTILE_COLORS[data.quintile] || QUINTILE_COLORS[0];

  // Sort by contribution (biggest driver first).
  const components = [...data.components].sort(
    (a, b) =>
      (b.contribution ?? b.percentile ?? 0) -
      (a.contribution ?? a.percentile ?? 0)
  );
  const maxContrib = Math.max(
    0.0001,
    ...components.map((c) => c.contribution ?? 0)
  );

  const delta =
    data.calibrated_premium != null && data.wtw_anchor_premium != null
      ? data.calibrated_premium - data.wtw_anchor_premium
      : null;

  // Distribution context: where does this area sit vs all of London?
  const riskDist = useMemo(
    () =>
      lookup.size > 0
        ? computeDistribution(lookup, 'risk_index', data.risk_index)
        : null,
    [lookup, data.risk_index]
  );

  // If a driver filter is active, also show distribution for that metric.
  const activeDriverField =
    colorMode !== 'composite' ? `${colorMode}_pct` : null;
  const activeDriverValue = activeDriverField
    ? data.components.find((c) => c.key === colorMode)?.percentile
    : null;
  const driverDist = useMemo(
    () =>
      activeDriverField != null &&
      activeDriverValue != null &&
      lookup.size > 0
        ? computeDistribution(lookup, activeDriverField, activeDriverValue)
        : null,
    [lookup, activeDriverField, activeDriverValue]
  );

  return (
    <div className="card detail-panel">
      <div className="card-title">{data.title}</div>
      {data.subtitle && (
        <div className="detail-subtitle">{data.subtitle}</div>
      )}

      <div className="risk-score-display">
        <div className="risk-circle" style={{ backgroundColor: color }}>
          {isFinite(data.risk_index) ? data.risk_index.toFixed(1) : '—'}
        </div>
        <div className="risk-text">
          <span className="risk-label">Quintile {data.quintile} of 5</span>
          <span className="stat-label">Risk index · 0 low → 100 high</span>
        </div>
      </div>

      {/* Distribution context */}
      {riskDist && (
        <div className="distribution-context">
          <div className="distribution-statement">
            Higher risk than{' '}
            <strong>{Math.round(riskDist.percentileRank)}%</strong> of GB
            areas
          </div>
          <Sparkline bins={riskDist.bins} selectedBin={riskDist.selectedBin} />
        </div>
      )}

      {/* Driver filter distribution (when a driver is active) */}
      {driverDist && colorMode !== 'composite' && (
        <div className="distribution-context distribution-driver">
          <div className="distribution-statement">
            {COMPONENT_LABELS[colorMode]}:{' '}
            <strong>{Math.round(driverDist.percentileRank)}th</strong>{' '}
            percentile across GB
          </div>
          <Sparkline
            bins={driverDist.bins}
            selectedBin={driverDist.selectedBin}
            accent={QUINTILE_COLORS[data.quintile] || 'var(--accent)'}
          />
        </div>
      )}

      {data.calibrated_premium != null && (
        <div className="stat-row">
          <span className="stat-label">Model expected premium</span>
          <span className="premium-highlight">
            {gbp(data.calibrated_premium)}
          </span>
        </div>
      )}
      {data.wtw_anchor_premium != null && (
        <div className="stat-row">
          <span className="stat-label">
            WTW actual average
            {data.postcode_area ? ` (${data.postcode_area})` : ''}
          </span>
          <span className="stat-value">{gbp(data.wtw_anchor_premium)}</span>
        </div>
      )}
      {delta != null && (
        <div className="stat-row">
          <span className="stat-label">Model vs actual</span>
          <span
            className="stat-value"
            style={{ color: delta >= 0 ? '#bd0026' : '#1a7a3c' }}
          >
            {delta >= 0 ? '+' : '−'}
            {gbp(Math.abs(delta))}
          </span>
        </div>
      )}

      {components.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <div className="card-title">Risk drivers</div>
          {components.map((c) => {
            const barPct =
              c.contribution != null
                ? (c.contribution / maxContrib) * 100
                : c.percentile ?? 0;
            const isHighlighted =
              colorMode !== 'composite' && c.key === colorMode;
            return (
              <div
                key={c.key}
                className={`component-item${isHighlighted ? ' component-highlight' : ''}`}
              >
                <div className="component-header">
                  <span
                    className={isHighlighted ? 'component-name-active' : ''}
                  >
                    {COMPONENT_LABELS[c.key] || c.key}
                  </span>
                  {c.percentile != null && (
                    <span className="stat-value">
                      {c.percentile.toFixed(0)}th pct
                    </span>
                  )}
                </div>
                <div className="bar-container">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.min(100, barPct)}%`,
                      backgroundColor: isHighlighted
                        ? 'var(--accent)'
                        : undefined,
                    }}
                  />
                </div>
                <div className="component-meta">
                  {c.value != null && <>Value {c.value.toFixed(1)}</>}
                  {c.value != null && c.contribution != null && ' · '}
                  {c.contribution != null && (
                    <>{c.contribution.toFixed(1)} pts to score</>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="component-meta" style={{ marginTop: 16 }}>
          Driver breakdown isn't in the map data yet — search a postcode for
          the full profile, or enrich the GeoJSON to show it on click.
        </div>
      )}
    </div>
  );
};
