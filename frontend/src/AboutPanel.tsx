import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  COMPONENT_LABELS,
  ELSEWHERE_COPY,
  formatFigure,
  NATIONS,
  premiumSpanSentence,
  type Nation,
} from './utils';
import type { PremiumSpan, SpanEnd } from './api';
import { DATA_SOURCES } from './dataSources';

const [ELSEWHERE_BEFORE, ELSEWHERE_AFTER] = ELSEWHERE_COPY.split('vouched.autos');

export const AboutPanel: React.FC<{
  areaCount: number;
  nationCounts: Record<Nation, number>;
  premiumSpan: PremiumSpan | null;
  onSelectArea: (code: string, coords?: [number, number]) => void;
}> = ({ areaCount, nationCounts, premiumSpan, onSelectArea }) => {
  // A nation's row is left out when the bake carries none of its areas.
  const anyNation = NATIONS.some((n) => nationCounts[n.id] > 0);

  const [open, setOpen] = useState(false);
  const words = premiumSpan ? premiumSpanSentence(premiumSpan) : null;

  // Each end of the span opens its area, as a ranking row does.
  const areaButton = (end: SpanEnd) => (
    <button
      type="button"
      className="about-area"
      onClick={() =>
        onSelectArea(end.code, end.lon != null && end.lat != null ? [end.lon, end.lat] : undefined)
      }
    >
      {end.name}
    </button>
  );

  return (
    <div className="section">
      <button
        className="disclosure-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="eyebrow">About the data</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="disclosure-body">
          <p className="about-intro">
            A <b>territorial risk proxy</b> ranking Great Britain's{' '}
            {areaCount > 0 && `${formatFigure(areaCount)} `}small areas by factors
            that correlate with motor-insurance claims, using only public data. It is <b>not an insurance quote</b> and uses no
            individual driver or vehicle details.
          </p>
          {anyNation && (
            <table className="feature-table">
              <caption className="sr-only">Areas mapped, by nation</caption>
              <thead>
                <tr>
                  <th scope="col">Nation</th>
                  <th scope="col">Areas</th>
                </tr>
              </thead>
              <tbody>
                {NATIONS.map((n) =>
                  nationCounts[n.id] > 0 ? (
                    <tr key={n.id}>
                      <th scope="row">{n.label}</th>
                      <td>{formatFigure(nationCounts[n.id])}</td>
                    </tr>
                  ) : null
                )}
              </tbody>
            </table>
          )}
          {premiumSpan && words && (
            <p className="about-intro">
              {words.before}
              {areaButton(premiumSpan.low)}
              {words.middle}
              {areaButton(premiumSpan.high)}
              {words.after}
            </p>
          )}
          <div>
            {DATA_SOURCES.map((s) => (
              <div key={s.key} className="about-source">
                <div className="about-source-header">
                  <span className="about-source-name">
                    {s.label ?? COMPONENT_LABELS[s.key] ?? s.key}
                  </span>
                  <span className="about-source-origin">{s.source}</span>
                </div>
                <p className="about-source-desc">{s.description}</p>
              </div>
            ))}
          </div>
          <p className="about-elsewhere">
            {ELSEWHERE_BEFORE}
            <a href="https://vouched.autos">vouched.autos</a>
            {ELSEWHERE_AFTER}
          </p>
        </div>
      )}
    </div>
  );
};
