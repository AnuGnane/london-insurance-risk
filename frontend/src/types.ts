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

// GET /api/methodology (optional endpoint — panel hides if it 404s)
export interface Methodology {
  weights: Record<string, number>;
  normalisation: string;
  calibration: {
    r_squared: number;
    coefficients: Record<string, number>;
    backfit_weights?: Record<string, number>;
  };
}

// Properties baked into each GeoJSON feature (see "backend contract" notes).
export interface LsoaProps {
  lsoa11cd: string;
  lsoa_name?: string;
  risk_index: number;
  quintile?: number;
  risk_bucket?: number;          // legacy name — read defensively
  calibrated_premium?: number;
  [key: string]: any;            // *_val, *_pct, *_contrib per component
}

// Unified detail shape rendered by DetailPanel, from EITHER a postcode
// search (rich, via /api/risk) or a map/ranking click (via feature props).
export interface AreaDetailComponent {
  key: string;
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
  wtw_anchor_premium?: number;
  postcode_area?: string;
  components: AreaDetailComponent[];
}

// What the map should colour by.
export type ColorMode =
  | 'composite'
  | 'vehicle_crime'
  | 'road_casualties'
  | 'deprivation'
  | 'population_density';

// Imperative focus request passed to the map (nonce forces re-fly).
export interface FocusTarget {
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  nonce: number;
}
