import type { RiskData } from './types';

interface DetailPanelProps {
  data: RiskData | null;
}

const QUINTILE_COLORS = [
  '#e5e5e5', // 0 (fallback)
  '#ffffb2', // 1 (lowest risk)
  '#fecc5c', // 2
  '#fd8d3c', // 3
  '#f03b20', // 4
  '#bd0026'  // 5 (highest risk)
];

const COMPONENT_LABELS: Record<string, string> = {
  vehicle_crime: 'Vehicle Crime',
  road_casualties: 'Road Casualties',
  deprivation: 'Deprivation (IMD)',
  population_density: 'Population Density',
};

export const DetailPanel: React.FC<DetailPanelProps> = ({ data }) => {
  if (!data) return null;

  const color = QUINTILE_COLORS[data.quintile] || QUINTILE_COLORS[0];

  return (
    <div className="card detail-panel">
      <div className="card-title">Risk Profile: {data.postcode}</div>
      
      <div className="risk-score-display">
        <div className="risk-circle" style={{ backgroundColor: color }}>
          {data.risk_index.toFixed(1)}
        </div>
        <div className="risk-text">
          <span className="risk-label">Risk Quintile {data.quintile}</span>
          <span className="stat-label">0 = Low, 100 = High</span>
        </div>
      </div>

      <div className="stat-row">
        <span className="stat-label">Model Expected Premium</span>
        <span className="premium-highlight">£{data.calibrated_premium_estimate}</span>
      </div>
      {data.wtw_anchor_premium && (
        <div className="stat-row">
          <span className="stat-label">WTW Actual Average ({data.postcode_area})</span>
          <span className="stat-value" style={{ color: 'var(--text-secondary)'}}>
            £{data.wtw_anchor_premium}
          </span>
        </div>
      )}

      <div style={{ marginTop: '24px' }}>
        <div className="card-title">Risk Drivers</div>
        {Object.entries(data.components).map(([key, comp]) => (
          <div key={key} className="component-item">
            <div className="component-header">
              <span>{COMPONENT_LABELS[key] || key}</span>
              <span className="stat-value">{comp.percentile.toFixed(0)}th pct</span>
            </div>
            {/* The bar shows the relative contribution out of maximum possible (approx 40%) */}
            <div className="bar-container">
              <div 
                className="bar-fill" 
                style={{ width: `${Math.min(100, comp.contribution * 100 * 2.5)}%` }}
              />
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Value: {comp.value.toFixed(1)} | Contributes: {(comp.contribution * 100).toFixed(1)}% to score
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
