import { useMemo, useRef, useState } from 'react';
import type { Feature } from 'geojson';
import { Search, ArrowLeft, ChevronDown, ChevronRight, LocateFixed, X } from 'lucide-react';
import { DetailPanel } from './DetailPanel';
import { RankingsPanel } from './RankingsPanel';
import { AboutPanel } from './AboutPanel';
import { ShareButton } from './ShareButton';
import { Segmented, type SegmentedOption } from './Segmented';
import type { AreaDetail, ColorMode, Methodology } from './types';
import { COMPONENT_LABELS, type Nation } from './utils';
import { examplePairs } from './api';

interface SidebarProps {
  onSearch: (postcode: string) => void;
  onSelectRanking: (code: string, coords?: [number, number]) => void;
  onSelectPair: (a: string, b: string) => void;
  onNearMe: () => Promise<void>;
  onClear: () => void;
  detail: AreaDetail | null;
  error: string | null;
  loading: boolean;
  colorMode: ColorMode;
  onColorModeChange: (m: ColorMode) => void;
  lookup: Map<string, Feature>;
  methodology: Methodology | null;
  recentSearches: string[];
  onClearRecents: () => void;
  sheetExpanded: boolean;
  onToggleSheet: () => void;
  nation: Nation | null;
  onNationChange: (n: Nation | null) => void;
  compare: AreaDetail | null;
  comparing: boolean;
  onCompareToggle: () => void;
  onCompareClear: () => void;
}

const COLOR_MODES: { mode: ColorMode; label: string }[] = [
  { mode: 'composite', label: 'Premium' },
  { mode: 'vehicle_crime', label: 'Crime' },
  { mode: 'imd_crime', label: 'Crime deprivation' },
  { mode: 'aadf_intensity', label: 'Traffic' },
  { mode: 'young_driver_share', label: 'Young drivers' },
  { mode: 'cars_per_household', label: 'Cars/household' },
  { mode: 'deprivation', label: 'Deprivation' },
  { mode: 'flood_risk', label: 'Flood risk' },
  { mode: 'road_casualties', label: 'Casualties' },
  { mode: 'population_density', label: 'Density' },
  { mode: 'traffic_per_capita', label: 'Traffic/capita' },
  { mode: 'ksi_collisions_per_billion_vehicle_miles', label: 'KSI rate' },
];

const COLOR_OPTIONS: readonly SegmentedOption<ColorMode>[] = COLOR_MODES.map(
  ({ mode, label }) => ({
    value: mode,
    label,
    title: mode === 'composite' ? 'Estimated premium' : COMPONENT_LABELS[mode],
  })
);

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
  onSelectPair,
  onNearMe,
  onClear,
  detail,
  error,
  loading,
  colorMode,
  onColorModeChange,
  lookup,
  methodology,
  recentSearches,
  onClearRecents,
  sheetExpanded,
  onToggleSheet,
  nation,
  onNationChange,
  compare,
  comparing,
  onCompareToggle,
  onCompareClear,
}) => {
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = (q: string) => {
    if (loading || !q.trim()) return;
    setTerm(q);
    onSearch(q.trim());
  };
  const showRecents = focused && term === '' && recentSearches.length > 0;
  // The landing's one-tap comparisons, once the areas have loaded (empty before).
  const pairs = useMemo(() => examplePairs(lookup), [lookup]);
  const [pairSaid, setPairSaid] = useState('');
  const [locating, setLocating] = useState(false);
  const nearMe = async () => {
    if (locating) return;  // not `disabled`: that would drop keyboard focus
    setLocating(true);
    setPairSaid('Finding your location…');
    try {
      await onNearMe();
    } finally {
      setLocating(false);
      setPairSaid('');
    }
  };

  return (
    <aside className="sidebar" aria-label="Search, rankings and area details">
      {/* Phone only (hidden on desktop by CSS): collapse / expand the bottom sheet. */}
      <button
        className="sheet-handle"
        onClick={onToggleSheet}
        aria-expanded={sheetExpanded}
        aria-label={sheetExpanded ? 'Collapse the panel' : 'Expand the panel'}
      >
        <span className="sheet-grip" aria-hidden="true" />
      </button>
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
          <span className="sep">·</span>
          {/* Built into dist/ by scripts/copy-methodology.mjs (not served by `npm run dev`). */}
          <a href={`${import.meta.env.BASE_URL}methodology.html`}>How it works</a>
        </div>
      </header>

      <div className="sidebar-content">
        <div className="section">
          <form
            className="search-bar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              search(term);
            }}
          >
            <div className="search-field">
            <Search className="search-icon" size={18} />
            <input
              ref={inputRef}
              id="postcode-search"
              type="text"
              placeholder="Postcode or district, e.g. E1 6AN"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              spellCheck={false}
              autoComplete="postal-code"
              autoCapitalize="characters"
              enterKeyHint="search"
              aria-label="Search a postcode or postcode district"
            />
            {term && (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setTerm('');
                  inputRef.current?.focus();  // back to the box, recents showing
                }}
                aria-label="Clear the search"
              >
                <X size={16} />
              </button>
            )}
            </div>
            <button
              type="submit"
              className="search-go"
              disabled={loading || !term.trim()}
              aria-busy={loading}
            >
              {loading ? <span className="loader loader-sm" aria-hidden="true" /> : null}
              {loading ? 'Searching' : 'Search'}
            </button>
          </form>

          {showRecents && (
            // onMouseDown keeps focus in the input so the list does not vanish mid-tap.
            <div className="recents" onMouseDown={(e) => e.preventDefault()}>
              <div className="recents-head">
                <span className="eyebrow">Recent</span>
                <button type="button" className="recents-clear" onClick={onClearRecents}>
                  clear
                </button>
              </div>
              {recentSearches.map((r) => (
                <button key={r} type="button" className="recent" onClick={() => search(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}

          {pairs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <span className="eyebrow">Try</span>
              <div className="seg seg-sm">
                <button
                  type="button"
                  onClick={nearMe}
                  aria-busy={locating}
                  title="Show the area you are in (your location is not stored)"
                >
                  <LocateFixed size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} />{' '}
                  {locating ? 'Locating…' : 'Near me'}
                </button>
                {pairs.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    title={`${p.a.name} vs ${p.b.name}`}
                    onClick={() => {
                      onSelectPair(p.a.code, p.b.code);
                      setPairSaid(`Comparing ${p.a.name} with ${p.b.name}`);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <span className="sr-only" role="status">{pairSaid}</span>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <span className="eyebrow">Colour the map by</span>
            <Segmented
              label="Colour the map by"
              options={COLOR_OPTIONS}
              value={colorMode}
              onChange={onColorModeChange}
            />
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
            <div className="detail-actions">
              <button className="back-link" onClick={onClear}>
                <ArrowLeft size={14} /> Back to rankings
              </button>
              <ShareButton title={detail.title} />
            </div>
            <DetailPanel
              data={detail}
              colorMode={colorMode}
              onColorModeChange={onColorModeChange}
              lookup={lookup}
              nationalAvg={methodology?.national_avg}
              compare={compare}
              comparing={comparing}
              onCompareToggle={onCompareToggle}
              onCompareClear={onCompareClear}
            />
          </div>
        ) : (
          <div className="section">
            <RankingsPanel
              onSelectRanking={onSelectRanking}
              lookup={lookup}
              nation={nation}
              onNationChange={onNationChange}
            />
          </div>
        )}

        <MethodologyPanel m={methodology} />
        <AboutPanel />

        <div className="section" style={{ borderTop: 'none', paddingTop: 8 }}>
          <div className="disclaimer">
            <b>Not an insurance quote.</b> A relative proxy for territorial risk
            from public data — vehicle crime, crime deprivation, traffic
            intensity and local demographics — calibrated against published
            average premiums. It uses no individual driver or vehicle details.
          </div>
        </div>
      </div>
    </aside>
  );
};
