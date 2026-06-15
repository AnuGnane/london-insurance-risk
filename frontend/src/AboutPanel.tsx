import { COMPONENT_LABELS } from './utils';

interface AboutPanelProps {}

const DATA_SOURCES = [
  {
    key: 'vehicle_crime',
    source: 'police.uk',
    description:
      'Street-level vehicle crime reports from the Metropolitan and City of London police forces, aggregated per LSOA and normalised per 1,000 residents.',
  },
  {
    key: 'road_casualties',
    source: 'DfT STATS19',
    description:
      'Road collisions from the Department for Transport, severity-weighted (slight ×1, serious ×3, fatal ×8) and normalised per 1,000 residents.',
  },
  {
    key: 'deprivation',
    source: 'MHCLG IMD 2019',
    description:
      'The English Index of Multiple Deprivation overall score — a composite of income, employment, health, crime, housing, and environment sub-domains.',
  },
  {
    key: 'population_density',
    source: 'ONS mid-year estimates',
    description:
      'Resident population per square kilometre, derived from the census and ONS mid-year population estimates.',
  },
];

import { useState } from 'react';

export const AboutPanel: React.FC<AboutPanelProps> = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="card about-panel">
      <button className="about-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="card-title" style={{ margin: 0 }}>
          About the data
        </span>
        <span className="stat-label">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="about-body">
          <p className="about-intro">
            This index is a <strong>territorial risk proxy</strong> — it ranks
            London's 4,881 Lower Super Output Areas by factors that correlate
            with motor insurance claims, using only public data. It is{' '}
            <strong>not an insurance quote</strong> and does not use individual
            driver or vehicle information.
          </p>
          <div className="about-sources">
            {DATA_SOURCES.map((s) => (
              <div key={s.key} className="about-source">
                <div className="about-source-header">
                  <span className="about-source-name">
                    {COMPONENT_LABELS[s.key] || s.key}
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
