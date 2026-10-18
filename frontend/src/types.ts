export interface ComponentRisk {
  value: number;
  percentile: number;
  contribution: number;
}

// Response shape from GET /api/risk?postcode=
export interface RiskData {
  postcode: string;
  lsoa11cd: string;
  risk_index: number;
  quintile: number;
  components: Record<string, ComponentRisk>;
  calibrated_premium_estimate: number | null;   // full premium (place + composition)
  premium_place_only?: number | null;            // at national-average demographics
  composition_uplift?: number | null;            // full − place-only (demographic effect)
  postcode_area: string;
  wtw_anchor_premium?: number;
  // Optional — if the backend returns the postcode point we fly there exactly;
  // otherwise the frontend flies to the LSOA's bounds (computed client-side).
  lng?: number;
  lat?: number;
}

// One row from GET /api/rankings
export interface RankingArea {
  code: string;           // lsoa11cd (or postcode district code)
  name: string;
  risk_index: number;
  quintile: number;
  calibrated_premium: number | null;
  lng?: number;           // only needed if rankings are district-level
  lat?: number;
}

// Trimmed calibration summary (static methodology.json on Pages).
export interface FeatureStat {
  bucket: 'place' | 'composition';
  partial_r: number;
  vif: number;
  verdict: string;
}
export interface Methodology {
  normalisation: string;
  r_squared: number;
  cv_r_squared?: number;
  loao_mae?: number;
  spearman?: number;
  n_matched?: number;
  n_areas?: number;
  n_quarters?: number;
  national_avg?: number;
  feature_analysis?: Record<string, FeatureStat>;
  cross_source?: {
    name: string;
    rows: { area_name: string; actual_gbp: number; predicted_gbp: number }[];
    spearman?: number;
  } | null;
  /** Modelled premium ratio for named postcode-area pairs (calibration's
   *  spatial-multiplier sanity checks); null when the JSON lacks them. */
  multiplier_checks?: { pair: string; predicted_ratio: number }[] | null;
  /** R² of place-only, composition-only and full fits (calibration's variance
   *  decomposition); null when the JSON lacks it. */
  variance?: { place_only_r2: number; composition_only_r2: number; full_r2: number } | null;
}

// Properties baked into each GeoJSON feature (see "backend contract" notes).
export interface LsoaProps {
  lsoa11cd: string;
  lsoa_name?: string;
  risk_index: number;
  quintile?: number;
  risk_bucket?: number;          // legacy name — read defensively
  calibrated_premium?: number;
  premium_low?: number;            // 95% CI lower bound (£)
  premium_high?: number;           // 95% CI upper bound (£)
  premium_baseline?: number;     // £ premium with every factor at the median percentile
  [key: string]: string | number | boolean | null | undefined; // *_val, *_pct, *_contrib per component
}

export interface WaterfallStep {
  key: string;
  label: string;
  percentile?: number;
  step: number;                  // signed £ contribution (LMDI; sums with baseline to the total)
  kind: 'place' | 'composition';
  rankedWithin?: RankingGroup;   // the group this layer is ranked within — flag it
}

/** The group a crime layer is ranked within: a nation, or England and Wales
 *  together (vehicle crime, whose recorded-crime sources differ by jurisdiction). */
export type RankingGroup = 'England' | 'Wales' | 'Scotland' | 'England and Wales';

// Unified detail shape rendered by DetailPanel, from EITHER a postcode
// search (rich, via /api/risk) or a map/ranking click (via feature props).
export interface AreaDetailComponent {
  key: string;
  kind: 'driver' | 'diagnostic';
  value?: number;
  percentile?: number;
  contribution?: number;
}

export interface AreaDetail {
  title: string;
  subtitle?: string;
  lsoa11cd: string;
  risk_index: number;
  quintile: number;
  calibrated_premium?: number;
  premium_low?: number;
  premium_high?: number;
  premium_place_only?: number;
  composition_uplift?: number;
  premium_baseline?: number;
  steps?: WaterfallStep[];
  wtw_anchor_premium?: number;
  postcode_area?: string;
  components: AreaDetailComponent[];
}

// What the map should colour by.
export type ColorMode =
  | 'composite'
  | 'vehicle_crime'
  | 'imd_crime'
  | 'young_driver_share'
  | 'cars_per_household'
  | 'road_casualties'
  | 'deprivation'
  | 'flood_risk'
  | 'population_density'
  | 'aadf_intensity'
  | 'traffic_per_capita'
  | 'ksi_collisions_per_billion_vehicle_miles';

// Imperative focus request passed to the map (nonce forces re-fly).
export interface FocusTarget {
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  nonce: number;
}
