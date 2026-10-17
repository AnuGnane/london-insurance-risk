import { useMemo } from 'react';
import type { Feature } from 'geojson';
import { X } from 'lucide-react';
import type { AreaDetail, ColorMode, WaterfallStep } from './types';
import {
  COMPONENT_LABELS,
  gbp,
  ordinalPct,
  computeDistribution,
  quintileColor,
  ledeForQuintile,
  explainArea,
  explainDifference,
  compareSummary,
  QUINTILE_TEXT,
  caveatsFor,
} from './utils';

interface DetailPanelProps {
  data: AreaDetail | null;
  colorMode: ColorMode;
  onColorModeChange: (m: ColorMode) => void;
  lookup: Map<string, Feature>;
  nationalAvg?: number;
  /** The second area of a comparison, if one is pinned. */
  compare: AreaDetail | null;
  /** "Compare with…" is armed, waiting for a map tap or a search. */
  comparing: boolean;
  onCompareToggle: () => void;
  onCompareClear: () => void;
  /** A compare lookup is in flight: a pending row where the second pin will land. */
  pendingPin?: boolean;
}

/** The two areas' names and premiums side by side, keyed to their map outlines. */
const ComparePair: React.FC<{ a: AreaDetail; b: AreaDetail }> = ({ a, b }) => (
  <div className="compare-pair">
    {[a, b].map((d, i) => (
      <div key={d.lsoa11cd} className="compare-cell">
        <span className={`compare-key${i ? ' compare-key-b' : ''}`} aria-hidden="true" />
        <span className="compare-name">{d.title}</span>
        <span className="compare-premium">{gbp(d.calibrated_premium)}</span>
      </div>
    ))}
    <p className="compare-sentence">
      {compareSummary(
        { name: a.title, premium: a.calibrated_premium },
        { name: b.title, premium: b.calibrated_premium }
      )}
    </p>
    {/* One set of caveats for the pair; the hero below does not repeat them. */}
    {caveatsFor(a.lsoa11cd, b.lsoa11cd).map((c) => (
      <p key={c} className="premium-caveat">{c}</p>
    ))}
  </div>
);

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

/** Marks for the two areas of a comparison: told apart by shape, not colour alone. */
const SIDE_MARK = ['●', '◆'] as const;

/** "● City of London 001A  ◆ Westminster 017A" — the key to the paired marks. */
const CompareKey: React.FC<{ names: [string, string] }> = ({ names }) => (
  <div className="compare-legend">
    {names.map((n, i) => (
      <span key={i}>
        <span className={`side-mark side-mark-${i ? 'b' : 'a'}`} aria-hidden="true">{SIDE_MARK[i]}</span>
        {n}
      </span>
    ))}
  </div>
);

/** The five drivers as percentile dots on a 0–100 track (GB median at 50).
 *  Tapping one colours the map by it; tapping it again goes back to premium.
 *  With `others` (a comparison), the second area's percentile is a diamond. */
const DriverDots: React.FC<{
  steps: WaterfallStep[];
  others?: WaterfallStep[];
  /** The two areas' names, for screen readers, when comparing. */
  names?: [string, string];
  colorMode: ColorMode;
  onColorModeChange: (m: ColorMode) => void;
}> = ({ steps, others, names, colorMode, onColorModeChange }) => {
  const groups: { title: string; kind: WaterfallStep['kind'] }[] = [
    { title: 'Place', kind: 'place' },
    { title: 'Who lives there', kind: 'composition' },
  ];
  return (
    <div className={`dots${others ? ' dots-pair' : ''}`}>
      {groups.map((g) => (
        <div
          key={g.kind}
          className="dots-group"
          role="group"
          aria-labelledby={`dots-${g.kind}`}
        >
          <div className="dots-title" id={`dots-${g.kind}`}>{g.title}</div>
          {steps
            .filter((s) => s.kind === g.kind)
            .map((s) => {
              const active = colorMode === s.key;
              const pct = s.percentile;
              const other = others?.find((o) => o.key === s.key);
              const pct2 = other?.percentile;
              return (
                <button
                  key={s.key}
                  type="button"
                  className={`dot-row${active ? ' dot-row-active' : ''}`}
                  aria-pressed={active}
                  title={active ? 'Back to colouring by premium' : `Colour the map by ${s.label}`}
                  onClick={() => onColorModeChange(active ? 'composite' : (s.key as ColorMode))}
                >
                  <span className="dot-label">
                    {s.label}
                    {other && other.rankedWithin !== s.rankedWithin
                      ? [s.rankedWithin, other.rankedWithin].map(
                          (g, i) =>
                            g && (
                              <span key={i} className="diag-tag">
                                within {g}
                                <span aria-hidden="true">{` (${SIDE_MARK[i]})`}</span>
                                {names && <span className="sr-only">{` for ${names[i]}`}</span>}
                              </span>
                            )
                        )
                      : s.rankedWithin && <span className="diag-tag">within {s.rankedWithin}</span>}
                  </span>
                  <span className="dot-track" aria-hidden="true">
                    <span className="dot-median" />
                    {pct != null && (
                      <span className="dot-mark" style={{ left: `${Math.min(100, Math.max(0, pct))}%` }} />
                    )}
                    {pct2 != null && (
                      <span className="dot-mark dot-mark-b" style={{ left: `${Math.min(100, Math.max(0, pct2))}%` }} />
                    )}
                  </span>
                  {other && names ? (
                    <span className="dot-pct">
                      <span aria-hidden="true">{`${ordinalPct(pct)} / ${ordinalPct(pct2)}`}</span>
                      <span className="sr-only">
                        {`${names[0]} ${ordinalPct(pct)} percentile, ${names[1]} ${ordinalPct(pct2)} percentile`}
                      </span>
                    </span>
                  ) : (
                    <span className="dot-pct">{ordinalPct(pct)}</span>
                  )}
                </button>
              );
            })}
        </div>
      ))}
      <div className="dots-scale" aria-hidden="true">
        <span>0</span>
        <span>median</span>
        <span>100</span>
      </div>
    </div>
  );
};

export const DetailPanel: React.FC<DetailPanelProps> = ({
  data,
  colorMode,
  onColorModeChange,
  lookup,
  nationalAvg,
  compare,
  comparing,
  onCompareToggle,
  onCompareClear,
  pendingPin = false,
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
  const diagnostics = data.components.filter((c) => c.kind === 'diagnostic');

  const uplift = data.composition_uplift;

  return (
    <div className="detail">
      <h2 className="detail-area">{data.title}</h2>
      {data.subtitle && <div className="detail-code">{data.subtitle}</div>}

      {compare && <ComparePair a={data} b={compare} />}
      <div className="compare-actions">
        <button
          className={`compare-btn${comparing ? ' compare-armed' : ''}`}
          aria-pressed={comparing}
          onClick={onCompareToggle}
        >
          {comparing
            ? 'Tap an area or search a postcode… (cancel)'
            : compare
              ? 'Compare with another…'
              : 'Compare with…'}
        </button>
        {compare && (
          <button className="compare-clear" onClick={onCompareClear} aria-label="Stop comparing">
            <X size={14} />
          </button>
        )}
      </div>
      {pendingPin && (
        <div className="skel-line compare-pending" aria-hidden="true" />
      )}

      <p className="lede">{ledeForQuintile(data.quintile)}</p>

      {/* Hero £ — ink, with a small ramp swatch as the legend tie-in */}
      <div className="hero">
        <span className="hero-swatch" style={{ background: color }} />
        <div>
          <div className="hero-value">{premium != null ? gbp(premium) : '—'}</div>
          {data.premium_low != null && data.premium_high != null && (
            <div className="hero-range">
              {gbp(data.premium_low)}–{gbp(data.premium_high)}
            </div>
          )}
          <div className="hero-caption">
            {data.premium_low != null ? 'Estimated annual premium (95% range)' : 'Estimated annual premium'}
          </div>
          {!compare &&
            caveatsFor(data.lsoa11cd).map((c) => (
              <p key={c} className="premium-caveat">{c}</p>
            ))}
        </div>
      </div>

      {/* Index + quintile */}
      <div className="index-row">
        <span className="index-figure">
          {isFinite(data.risk_index) ? data.risk_index.toFixed(0) : '—'}
          <span>/100</span>
        </span>
        <span
          className="qpill"
          style={{ background: color, color: QUINTILE_TEXT[Math.min(5, Math.max(1, Math.round(data.quintile))) - 1] }}
        >
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

      {/* Premium waterfall — exact, order-invariant bridge from the typical-GB baseline */}
      {data.steps && data.premium_baseline != null && premium != null && (() => {
        // A comparison pairs every row with the second area's (same drivers, same order).
        const cmp =
          compare?.steps && compare.premium_baseline != null && compare.calibrated_premium != null
            ? {
                steps: compare.steps,
                baseline: compare.premium_baseline,
                premium: compare.calibrated_premium,
              }
            : null;
        const maxAbs = Math.max(
          1,
          ...[...data.steps, ...(cmp?.steps ?? [])].map((s) => Math.abs(s.step))
        );
        const names: [string, string] = [data.title, compare?.title ?? ''];
        const bar = (s: WaterfallStep, side: 0 | 1) => {
          const up = s.step >= 0;
          return (
            <span
              key={side}
              className={`wf-bar ${up ? 'wf-up' : 'wf-down'}${side ? ' wf-bar-b' : ''}`}
              style={{ width: `${(Math.abs(s.step) / maxAbs) * 50}%` }}
            />
          );
        };
        const delta = (s: WaterfallStep, side?: 0 | 1) => {
          const up = s.step >= 0;
          return (
            <span key={side ?? 0} className={`wf-delta ${up ? 'pos' : 'neg'}`}>
              {side != null && (
                <>
                  <span className={`side-mark side-mark-${side ? 'b' : 'a'}`} aria-hidden="true">
                    {SIDE_MARK[side]}
                  </span>
                  <span className="sr-only">{`${names[side]}: `}</span>
                </>
              )}
              <span className="wf-arrow" aria-hidden="true">{up ? '▲' : '▼'}</span>
              {up ? '+' : '−'}{gbp(Math.abs(s.step))}
            </span>
          );
        };
        const amounts = (a: number, b: number, style?: React.CSSProperties) =>
          cmp ? (
            <span className="wf-amount wf-pair">
              <span style={style}>
                <span className="side-mark side-mark-a" aria-hidden="true">{SIDE_MARK[0]}</span>
                <span className="sr-only">{`${names[0]}: `}</span>
                {gbp(a)}
              </span>
              <span>
                <span className="side-mark side-mark-b" aria-hidden="true">{SIDE_MARK[1]}</span>
                <span className="sr-only">{`${names[1]}: `}</span>
                {gbp(b)}
              </span>
            </span>
          ) : (
            <span className="wf-amount" style={style}>{gbp(a)}</span>
          );
        return (
          <div className="section" style={{ borderTop: 'none', paddingBottom: 0 }}>
            <span className="eyebrow">Why this price</span>
            <p className="explain">
              {cmp
                ? explainDifference(
                    { name: data.title, steps: data.steps, premium },
                    { name: names[1], steps: cmp.steps, premium: cmp.premium }
                  )
                : explainArea(data.steps, data.premium_baseline, premium)}
            </p>
            {cmp && <CompareKey names={names} />}
            <DriverDots
              steps={data.steps}
              others={cmp?.steps}
              names={cmp ? names : undefined}
              colorMode={colorMode}
              onColorModeChange={onColorModeChange}
            />
            <details className="pct-explainer">
              <summary>What is a percentile?</summary>
              <p>
                A percentile ranks this area against the other areas it is compared with:
                the 91st percentile scores higher than about 91% of them, and the 50th is
                the middle one. Most factors compare across Great Britain; crime and
                deprivation are ranked within comparable groups, never across them, so
                vehicle crime is ranked within Scotland for a Scottish area and within
                England and Wales otherwise. Tap a factor to colour the map by it.
              </p>
            </details>
            <div
              className={`waterfall${cmp ? ' waterfall-pair' : ''}`}
              aria-label={
                cmp
                  ? `Breakdown of the estimated premiums by factor: ${SIDE_MARK[0]} ${names[0]}, ${SIDE_MARK[1]} ${names[1]}`
                  : 'Breakdown of the estimated premium by factor'
              }
            >
              <div className="wf-row wf-anchor">
                <span className="wf-label">Typical GB area</span>
                {amounts(data.premium_baseline, cmp?.baseline ?? 0)}
              </div>
              {data.steps.map((s) => {
                const active = colorMode !== 'composite' && s.key === colorMode;
                const other = cmp?.steps.find((o) => o.key === s.key);
                return (
                  <div key={s.key} className={`wf-row wf-step${active ? ' wf-active' : ''}`}>
                    <span className="wf-label">
                      {s.label}
                      {s.percentile != null && !cmp && (
                        <span className="wf-pct">{ordinalPct(s.percentile)} pct</span>
                      )}
                      {s.rankedWithin && !cmp && <span className="diag-tag">within {s.rankedWithin}</span>}
                    </span>
                    <span className="wf-track">
                      {bar(s, 0)}
                      {other && bar(other, 1)}
                    </span>
                    {other ? (
                      <span className="wf-deltas">
                        {delta(s, 0)}
                        {delta(other, 1)}
                      </span>
                    ) : (
                      delta(s)
                    )}
                  </div>
                );
              })}
              <div className="wf-row wf-total">
                <span className="wf-label">{cmp ? 'These areas' : 'This area'}</span>
                {amounts(premium, cmp?.premium ?? 0, { color })}
              </div>
            </div>
            <p className="drivers-note">
              Each step is this area's factor versus a national-median area; the steps add up
              exactly to the estimate, and each factor's share is independent of ordering.
            </p>
          </div>
        );
      })()}

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
