import { useEffect, useState } from 'react';
import type { Feature } from 'geojson';
import { Search, ArrowLeft } from 'lucide-react';
import { DetailPanel } from './DetailPanel';
import { RankingsPanel } from './RankingsPanel';
import { AboutPanel } from './AboutPanel';
import type { AreaDetail, ColorMode, Methodology } from './types';
import { COMPONENT_LABELS } from './utils';

interface SidebarProps {
  onSearch: (postcode: string) => void;
  onSelectRanking: (code: string, coords?: [number, number]) => void;
  onClear: () => void;
  detail: AreaDetail | null;
  error: string | null;
  loading: boolean;
  colorMode: ColorMode;
  onColorModeChange: (m: ColorMode) => void;
  lookup: Map<string, Feature>;
}

const COLOR_MODES: { mode: ColorMode; label: string }[] = [
  { mode: 'composite', label: 'Premium' },
  { mode: 'vehicle_crime', label: 'Crime' },
  { mode: 'road_casualties', label: 'Casualties' },
  { mode: 'deprivation', label: 'Deprivation' },
  { mode: 'population_density', label: 'Density' },
];

// Optional methodology panel — silently hides if /api/methodology isn't there.
const MethodologyPanel: React.FC = () => {
  const [m, setM] = useState<Methodology | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/methodology')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setM(data))
      .catch(() => {});
  }, []);

  if (!m) return null;

  return (
    <div className="card methodology">
      <button className="methodology-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="card-title" style={{ margin: 0 }}>How it's built</span>
        <span className="stat-label">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="methodology-body">
          <div className="stat-row">
            <span className="stat-label">Calibration R²</span>
            <span className="stat-value">
              {m.calibration.r_squared != null
                ? m.calibration.r_squared.toFixed(3)
                : '—'}
            </span>
          </div>
          <p className="methodology-note">
            Explains{' '}
            {m.calibration.r_squared != null
              ? (m.calibration.r_squared * 100).toFixed(0)
              : '—'}
            % of the variance in real average premiums across GB postcode
            areas (WTW/Confused). Index normalised by {m.normalisation}.
          </p>
          <div className="methodology-weights">
            {Object.entries(m.weights).map(([k, w]) => (
              <div key={k} className="stat-row">
                <span className="stat-label">
                  {COMPONENT_LABELS[k] || k}
                </span>
                <span className="stat-value">
                  {(Number(w) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  onSearch,
  onSelectRanking,
  onClear,
  detail,
  error,
  loading,
  colorMode,
  onColorModeChange,
  lookup,
}) => {
  const [term, setTerm] = useState('');

  const submit = () => {
    if (term.trim().length > 1) onSearch(term.trim());
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>GB Territory Risk</h1>
        <p>
          A composite open-data proxy for motor insurance risk across Great Britain.
        </p>
      </div>

      <div className="sidebar-content">
        <div className="search-bar">
          <Search className="search-icon" size={18} />
          <input
            type="text"
            placeholder="Search a postcode (e.g. E1 6AN)"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            spellCheck={false}
          />
        </div>

        <div>
          <div className="control-label">Filter map by</div>
          <div className="seg seg-wrap">
            {COLOR_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                className={colorMode === mode ? 'seg-on' : ''}
                onClick={() => onColorModeChange(mode)}
                title={
                  mode === 'composite'
                    ? 'Composite risk'
                    : COMPONENT_LABELS[mode]
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div style={{ textAlign: 'center' }}>
            <span className="loader" />
          </div>
        )}

        {error && <div className="search-error">{error}</div>}

        {detail && !loading ? (
          <>
            <button className="back-link" onClick={onClear}>
              <ArrowLeft size={14} /> Back to rankings
            </button>
            <DetailPanel
              data={detail}
              colorMode={colorMode}
              lookup={lookup}
            />
          </>
        ) : (
          !loading && (
            <RankingsPanel
              onSelectRanking={onSelectRanking}
              lookup={lookup}
            />
          )
        )}

        <MethodologyPanel />
        <AboutPanel />

        <div className="disclaimer">
          <strong>What this is:</strong> a relative proxy for territorial risk
          built from public data (crime, collisions, deprivation, density),
          calibrated against published average premiums. It is{' '}
          <strong>not</strong> an insurance quote.
        </div>
      </div>
    </div>
  );
};
