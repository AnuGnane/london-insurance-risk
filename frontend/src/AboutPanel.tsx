import { COMPONENT_LABELS } from './utils';

interface AboutPanelProps {}

const DATA_SOURCES = [
  {
    key: 'vehicle_crime',
    source: 'police.uk',
    description:
      'Street-level vehicle crime reports from all England and Wales police forces (data.police.uk), aggregated per LSOA and normalised per 1,000 residents. Scotland is excluded from this data source; those areas show no data and the index reweights accordingly.',
  },
  {
    key: 'road_casualties',
    source: 'DfT STATS19',
    description:
      'Road collisions from the Department for Transport, severity-weighted (slight ×1, serious ×3, fatal ×8) and normalised per 1,000 residents.',
  },
  {
    key: 'ksi_collisions_per_billion_vehicle_miles',
    source: 'DfT STATS19 + Road traffic statistics',
    description:
      'Fatal and serious collisions per billion vehicle miles (DfT traffic exposure as the denominator). A map diagnostic: the Phase 3 calibration found no independent premium signal once crime, deprivation and density are controlled, so it does not drive the premium.',
  },
  {
    key: 'deprivation',
    source: 'IoD / WIMD / SIMD',
    description:
      'Deprivation score from each nation\'s own index (England IoD2019 · Wales WIMD2019 · Scotland SIMD2020v2), ranked within each nation separately before combining so the scales are comparable.',
  },
  {
    key: 'population_density',
    source: 'ONS mid-year estimates',
    description:
      'Resident population per square kilometre, derived from the census and ONS mid-year population estimates.',
  },
  {
    key: 'traffic_per_capita',
    source: 'DfT Road traffic statistics',
    description:
      'Local-authority annual vehicle miles allocated to small areas by population share. A map diagnostic: at this grain it behaves as an inverse-density proxy (rural through-roads score highest), so Phase 3 kept it off the premium model pending point-level traffic data.',
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
            Great Britain's 41,729 small areas (LSOAs in England & Wales,
            Data Zones in Scotland) by factors that correlate with motor
            insurance claims, using only public data. It is{' '}
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
