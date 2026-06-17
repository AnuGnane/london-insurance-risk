import { useMemo } from 'react';
import type { Feature } from 'geojson';
import type { AreaDetail, ColorMode } from './types';
import {
  COMPONENT_LABELS,
  gbp,
  ordinalPct,
  computeDistribution,
  quintileColor,
  ledeForQuintile,
} from './utils';

interface DetailPanelProps {
  data: AreaDetail | null;
  colorMode: ColorMode;
  lookup: Map<string, Feature>;
  nationalAvg?: number;
}

/** 20-bar histogram with the selected bin + an optional national-average notch. */
const Sparkline: React.FC<{
  bins: number[];
  selectedBin: number;
  avgBin?: number;
}> = ({ bins, selectedBin, avgBin }) => (
  <div className="sparkline" aria-hidden="true">
    {bins.map((h, i) => (
      <div
        key={i}
        className={`sparkline-bar${i === selectedBin ? ' sparkline-selected' : ''}`}
        style={{ height: `${Math.max(2, h * 100)}%` }}
      />
    ))}
    {avgBin != null && (
      <div
        className="sparkline-avg"
        style={{ left: `${((avgBin + 0.5) / bins.length) * 100}%` }}
      />
    )}
  </div>
);

export const DetailPanel: React.FC<DetailPanelProps> = ({
  data,
  colorMode,
  lookup,
  nationalAvg,
}) => {
  const premium = data?.calibrated_premium;

  // Premium distribution with the national-average notch (the signature device).
  const dist = useMemo(
    () =>
      data && premium != null && lookup.size > 0
        ? computeDistribution(lookup, 'calibrated_premium', premium, nationalAvg)
        : null,
    [lookup, data, premium, nationalAvg]
  );

  if (!data) return null;

  const color = quintileColor(data.quintile);
  const drivers = data.components.filter((c) => c.kind === 'driver');
  const diagnostics = data.components.filter((c) => c.kind === 'diagnostic');
  // Biggest premium effect first (by absolute £ contribution).
  drivers.sort(
    (a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0)
  );

  const uplift = data.composition_uplift;

  return (
    <div className="detail">
      <div className="detail-area">{data.title}</div>
      {data.subtitle && <div className="detail-code">{data.subtitle}</div>}

      <p className="lede">{ledeForQuintile(data.quintile)}</p>

      {/* Hero £ — ink, with a small ramp swatch as the legend tie-in */}
      <div className="hero">
        <span className="hero-swatch" style={{ background: color }} />
        <div>
          <div className="hero-value">{premium != null ? gbp(premium) : '—'}</div>
          <div className="hero-caption">Estimated annual premium</div>
        </div>
      </div>

      {/* Index + quintile */}
      <div className="index-row">
        <span className="index-figure">
          {isFinite(data.risk_index) ? data.risk_index.toFixed(0) : '—'}
          <span>/100</span>
        </span>
        <span className="qpill" style={{ background: color }}>
          Q{data.quintile} of 5
        </span>
        <span className="index-caption">premium index · 0 cheapest → 100 dearest</span>
      </div>

      {/* Distribution context with the national-average notch */}
      {dist && (
        <div className="dist">
          <div className="dist-statement">
            More expensive than <b>{Math.round(dist.percentileRank)}%</b> of GB areas
            {nationalAvg != null && premium != null && (
              <>
                {' · '}
                {premium >= nationalAvg ? '+' : '−'}
                {gbp(Math.abs(premium - nationalAvg))} vs the GB average
              </>
            )}
          </div>
          <Sparkline
            bins={dist.bins}
            selectedBin={dist.selectedBin}
            avgBin={dist.avgBin}
          />
        </div>
      )}

      {/* The three numbers */}
      {data.premium_place_only != null && (
        <div className="threenums">
          <div className="threenum">
            <span className="threenum-label">Full estimate</span>
            <span className="threenum-value">{gbp(premium)}</span>
          </div>
          <div className="threenum">
            <span className="threenum-label">Place only (avg demographics)</span>
            <span className="threenum-value">{gbp(data.premium_place_only)}</span>
          </div>
          <div className="threenum">
            <span className="threenum-label">Who lives there</span>
            <span className="threenum-value uplift">
              {uplift != null ? `${uplift >= 0 ? '+' : '−'}${gbp(Math.abs(uplift))}` : '—'}
            </span>
          </div>
        </div>
      )}

      {data.wtw_anchor_premium != null && (
        <div style={{ marginTop: 14 }}>
          <div className="stat-row">
            <span className="stat-label">
              WTW actual average
              {data.postcode_area ? ` (${data.postcode_area})` : ''}
            </span>
            <span className="stat-value">{gbp(data.wtw_anchor_premium)}</span>
          </div>
        </div>
      )}

      {/* Premium drivers */}
      {drivers.length > 0 && (
        <div className="section" style={{ borderTop: 'none', paddingBottom: 0 }}>
          <span className="eyebrow">What moves the premium</span>
          <div className="drivers">
            {drivers.map((c) => {
              const active = colorMode !== 'composite' && c.key === colorMode;
              const pct = c.percentile ?? 0;
              const contrib = c.contribution;
              return (
                <div
                  key={c.key}
                  className={`driver${active ? ' driver-active' : ''}`}
                >
                  <div className="driver-head">
                    <span className="driver-name">
                      {COMPONENT_LABELS[c.key] || c.key}
                    </span>
                    {c.percentile != null && (
                      <span className="driver-pct">{ordinalPct(pct)} pct</span>
                    )}
                  </div>
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  {contrib != null && (
                    <div className="driver-meta">
                      <span className="pos">
                        {contrib >= 0 ? '+' : '−'}{gbp(Math.abs(contrib))}
                      </span>{' '}
                      vs the GB-average area
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Diagnostic layers — mapped, but evidence-gated out of the premium */}
      {diagnostics.length > 0 && (
        <div className="section" style={{ paddingBottom: 0 }}>
          <span className="eyebrow">Also mapped — diagnostics</span>
          <div className="drivers">
            {diagnostics.map((c) => {
              const active = colorMode !== 'composite' && c.key === colorMode;
              const pct = c.percentile ?? 0;
              return (
                <div
                  key={c.key}
                  className={`driver${active ? ' driver-active' : ''}`}
                >
                  <div className="driver-head">
                    <span className="driver-name">
                      {COMPONENT_LABELS[c.key] || c.key}
                      <span className="diag-tag">diagnostic</span>
                    </span>
                    <span className="driver-pct">{ordinalPct(pct)} pct</span>
                  </div>
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="drivers-note">
            Diagnostic layers are shown on the map but the calibration found no
            independent premium signal once the drivers above are accounted for.
          </p>
        </div>
      )}
    </div>
  );
};
