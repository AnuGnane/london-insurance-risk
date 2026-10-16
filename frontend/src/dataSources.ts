// "About the data": one entry per data source behind a map colour mode. Wording
// follows README.md's data-sources table and DATA_PROVENANCE_AND_TRANSFORMS.md.

export const DATA_SOURCES: { key: string; label?: string; source: string; description: string }[] = [
  {
    key: 'vehicle_crime',
    source: 'police.uk',
    description:
      'Street-level vehicle crime from England & Wales forces (data.police.uk), per LSOA, per 1,000 residents. Scotland uses Recorded Crime in Scotland, ranked within its own source.',
  },
  {
    key: 'imd_crime',
    label: 'Crime deprivation (IMD)',
    source: 'IoD / WIMD / SIMD',
    description:
      "The crime sub-domain of each nation's deprivation index (England IoD2019 Crime · Wales WIMD2019 Community Safety · Scotland SIMD2020v2 Crime), ranked within nation. Replaced overall deprivation as a premium driver in the 2026-07 evidence gate (partial r +0.43).",
  },
  {
    key: 'deprivation',
    source: 'IoD / WIMD / SIMD',
    description:
      "Each nation's own overall deprivation index (England IoD2019 · Wales WIMD2019 · Scotland SIMD2020v2), ranked within nation. A map diagnostic since 2026-07 — its premium signal is carried by the crime sub-domain.",
  },
  {
    key: 'flood_risk',
    source: 'EA / NRW / SEPA',
    description:
      'Share of each area inside a High/Medium river-and-sea flood zone (England RoFRS via Defra · Wales NRW · Scotland SEPA), ranked within nation. Evidence-gated OUT of the car premium (flood exposure tracks rurality, which is cheap to insure) — shown as a diagnostic.',
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
  {
    key: 'population_density',
    source: 'Census population + ONS / ScotGov boundaries',
    description:
      "Residents per km² of each area's boundary. Evidence-gated out of the premium model and replaced by point-level AADF traffic — shown on the map as a diagnostic.",
  },
  {
    key: 'traffic_per_capita',
    source: 'DfT local-authority road traffic',
    description:
      "Local-authority annual traffic shared out to areas by population. The demoted first traffic measure: an inverse-density proxy (rural through-roads score highest), so a map diagnostic, not a premium driver.",
  },
  {
    key: 'ksi_collisions_per_billion_vehicle_miles',
    label: 'KSI rate',
    source: 'DfT STATS19 + DfT traffic',
    description:
      'Fatal and serious (killed or seriously injured) collisions on the DfT traffic denominator. A map diagnostic: no independent signal once traffic exposure is controlled.',
  },
];

// Colour modes described inside another entry rather than their own.
export const DATA_SOURCE_ALIASES: Record<string, string> = {
  cars_per_household: 'young_driver_share',
};
