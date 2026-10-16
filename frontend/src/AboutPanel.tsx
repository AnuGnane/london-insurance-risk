import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { COMPONENT_LABELS, formatFigure } from './utils';
import { DATA_SOURCES } from './dataSources';

export const AboutPanel: React.FC<{ areaCount: number }> = ({ areaCount }) => {
  const [open, setOpen] = useState(false);

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
        </div>
      )}
    </div>
  );
};
