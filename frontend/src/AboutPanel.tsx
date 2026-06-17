import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { COMPONENT_LABELS } from './utils';

const DATA_SOURCES: { key: string; label?: string; source: string; description: string }[] = [
  {
    key: 'vehicle_crime',
    source: 'police.uk',
    description:
      'Street-level vehicle crime from England & Wales forces (data.police.uk), per LSOA, per 1,000 residents. Scotland uses Recorded Crime in Scotland, ranked within its own source.',
  },
  {
    key: 'deprivation',
    source: 'IoD / WIMD / SIMD',
    description:
      "Each nation's own deprivation index (England IoD2019 · Wales WIMD2019 · Scotland SIMD2020v2), ranked within nation so the scales are comparable.",
  },
  {
    key: 'aadf_intensity',
    source: 'DfT road traffic (AADF)',
    description:
      'Mean Annual Average Daily Flow of DfT count points within 2 km of the area centroid — a direct measure of local road business. The premium driver that replaced raw density (partial r +0.38).',
  },
  {
    key: 'young_driver_share',
    label: 'Demographic controls',
    source: 'Census 2021 / 2022',
    description:
      'Young-driver share (17–24) and cars per household, from Census via Nomis (E&W) and UK Data Service (Scotland). These separate the place effect from who lives there.',
  },
  {
    key: 'road_casualties',
    source: 'DfT STATS19',
    description:
      'Severity-weighted road collisions (slight ×1, serious ×3, fatal ×8) per 1,000 residents. A map diagnostic, not a premium driver.',
  },
];

export const AboutPanel: React.FC = () => {
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
            A <b>territorial risk proxy</b> ranking Great Britain's 41,729 small
            areas by factors that correlate with motor-insurance claims, using
            only public data. It is <b>not an insurance quote</b> and uses no
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
