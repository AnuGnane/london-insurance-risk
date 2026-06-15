export interface ComponentRisk {
  value: number;
  percentile: number;
  contribution: number;
}

export interface RiskData {
  postcode: string;
  lsoa11cd: string;
  risk_index: number;
  quintile: number;
  components: Record<string, ComponentRisk>;
  calibrated_premium_estimate: number;
  postcode_area: string;
  wtw_anchor_premium?: number;
}

export interface RankingArea {
  code: string;
  name: string;
  risk_index: number;
  quintile: number;
  calibrated_premium: number;
}

export interface Methodology {
  weights: Record<string, number>;
  normalisation: string;
  calibration: {
    r_squared: number;
    coefficients: Record<string, number>;
    backfit_weights: Record<string, number>;
  };
}
