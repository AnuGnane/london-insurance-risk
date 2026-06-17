import { useState } from 'react';
import type { Feature } from 'geojson';
import { Search, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
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
  methodology: Methodology | null;
}

const COLOR_MODES: { mode: ColorMode; label: string }[] = [
  { mode: 'composite', label: 'Premium' },
  { mode: 'vehicle_crime', label: 'Crime' },
  { mode: 'deprivation', label: 'Deprivation' },
  { mode: 'aadf_intensity', label: 'Traffic' },
  { mode: 'road_casualties', label: 'Casualties' },
  { mode: 'population_density', label: 'Density' },
  { mode: 'traffic_per_capita', label: 'Traffic/capita' },
  { mode: 'ksi_collisions_per_billion_vehicle_miles', label: 'KSI rate' },
];

const fmt = (n: number | undefined, dp: number): string =>
  n == null ? '—' : n.toFixed(dp);

const MethodologyPanel: React.FC<{ m: Methodology | null }> = ({ m }) => {
  const [open, setOpen] = useState(false);
  if (!m) return null;

  // Strongest independent predictors first (by |partial r|).
  const features = Object.entries(m.feature_analysis ?? {})
    .map(([k, v]) => ({ key: k.replace(/_pct$/, ''), ...v }))
    .sort((a, b) => Math.abs(b.partial_r) - Math.abs(a.partial_r));

  return (
    <div className="section">
      <button
        className="disclosure-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="eyebrow">How it's built</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="disclosure-body">
          <div className="metric-strip">
            <div className="metric">
              <div className="metric-value">{fmt(m.r_squared, 3)}</div>
              <span className="metric-label">Panel R²</span>
            </div>
            <div className="metric">
              <div className="metric-value">£{Math.round(m.loao_mae ?? 0)}</div>
              <span className="metric-label">LOAO MAE</span>
            </div>
            <div className="metric">
              <div className="metric-value">{fmt(m.spearman, 2)}</div>
              <span className="metric-label">Spearman ρ</span>
            </div>
          </div>
          <p className="note">
            A relative territorial index — <b>log(area premium ÷ national
            average)</b> — fitted on percentile features and calibrated against
            the published WTW/Confused.com price index
            {m.n_matched && m.n_areas
              ? ` (${m.n_matched} observations across ${m.n_areas} postcode areas)`
              : ''}
            . It explains {m.r_squared != null ? (m.r_squared * 100).toFixed(0) : '—'}%
            of the variance in real average premiums; predictions rank areas at
            ρ {fmt(m.spearman, 2)} against actual.
          </p>

          {features.length > 0 && (
            <div className="feature-table">
              <div className="feature-kicker">
                Independent signal (partial r, net of the others)
              </div>
              {features.map((f) => (
                <div key={f.key} className="feature-row">
                  <span className="f-name">
                    {COMPONENT_LABELS[f.key] ?? f.key}
                  </span>
                  <span className="f-r">
                    {f.partial_r >= 0 ? '+' : '−'}
                    {Math.abs(f.partial_r).toFixed(2)}
                    {'  ·  VIF '}
                    {f.vif.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {m.cross_source && m.cross_source.rows.length > 0 && (
            <div className="feature-table" style={{ marginTop: 14 }}>
              <div className="feature-kicker">
                Cross-source check — {m.cross_source.name} (predicted vs actual)
              </div>
              {m.cross_source.rows.map((r) => (
                <div key={r.area_name} className="feature-row">
                  <span className="f-name">{r.area_name}</span>
                  <span className="f-r">
                    £{Math.round(r.predicted_gbp)} vs £{Math.round(r.actual_gbp)}
                  </span>
                </div>
              ))}
            </div>
          )}
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
  methodology,
}) => {
  const [term, setTerm] = useState('');
  const submit = () => {
    if (term.trim().length > 1) onSearch(term.trim());
  };

  return (
    <div className="sidebar">
      <header className="masthead">
        <div className="masthead-kicker">Territorial pricing · open-data model</div>
        <h1>The Price of Place</h1>
        <p className="masthead-standfirst">
          How much does where you park move your car-insurance premium?
        </p>
        <div className="masthead-meta">
          {methodology?.r_squared != null && (
            <>
              <span>
                <b>R² {methodology.r_squared.toFixed(3)}</b>
              </span>
              <span className="sep">·</span>
            </>
          )}
          {methodology?.loao_mae != null && (
            <>
              <span>±£{Math.round(methodology.loao_mae)} per area</span>
              <span className="sep">·</span>
            </>
          )}
          <span>41,729 areas mapped</span>
        </div>
      </header>

      <div className="sidebar-content">
        <div className="section">
          <div className="search-bar">
            <Search className="search-icon" size={18} />
            <input
              type="text"
              placeholder="Search a postcode — e.g. E1 6AN"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              spellCheck={false}
              aria-label="Search a postcode"
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <span className="eyebrow">Colour the map by</span>
            <div className="seg">
              {COLOR_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  className={colorMode === mode ? 'seg-on' : ''}
                  onClick={() => onColorModeChange(mode)}
                  title={mode === 'composite' ? 'Estimated premium' : COMPONENT_LABELS[mode]}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="search-error" style={{ marginTop: 14 }} role="alert">
              {error}
            </div>
          )}
        </div>

        {loading ? (
          <div className="section">
            <div className="skel-line" style={{ width: '55%', height: 40, marginBottom: 14 }} />
            <div className="skel-line" style={{ width: '80%', marginBottom: 8 }} />
            <div className="skel-line" style={{ width: '70%' }} />
          </div>
        ) : detail ? (
          <div className="section">
            <button className="back-link" onClick={onClear}>
              <ArrowLeft size={14} /> Back to rankings
            </button>
            <DetailPanel
              data={detail}
              colorMode={colorMode}
              lookup={lookup}
              nationalAvg={methodology?.national_avg}
            />
          </div>
        ) : (
          <div className="section">
            <RankingsPanel onSelectRanking={onSelectRanking} lookup={lookup} />
          </div>
        )}

        <MethodologyPanel m={methodology} />
        <AboutPanel />

        <div className="section" style={{ borderTop: 'none', paddingTop: 8 }}>
          <div className="disclaimer">
            <b>Not an insurance quote.</b> A relative proxy for territorial risk
            from public data — crime, deprivation, traffic intensity and local
            demographics — calibrated against published average premiums. It uses
            no individual driver or vehicle details.
          </div>
        </div>
      </div>
    </div>
  );
};
