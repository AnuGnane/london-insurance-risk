/**
 * Client-side data layer for the static (GitHub Pages) build.
 *
 * GitHub Pages can't run the FastAPI backend, so these functions replace the old
 * `/api/*` endpoints with static files + a public postcode API — same shapes, no
 * server. See SHOWCASE_PLAN.md.
 *
 *  - getGeojson()       → static frontend/public/data/areas.geojson
 *  - lookupPostcode()   → postcodes.io (postcode → 2011 LSOA / Data Zone code)
 *  - getRankings()      → sort the already-loaded GeoJSON client-side
 *  - getMethodology()   → static frontend/public/data/methodology.json
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { LsoaProps, Methodology, RankingArea } from './types';

// Vite sets BASE_URL to the configured `base` ('/' in dev, '/london-insurance-risk/'
// for Pages) and always includes a trailing slash, so data URLs resolve in both.
const dataUrl = (name: string): string => `${import.meta.env.BASE_URL}data/${name}`;

const POSTCODES_API = 'https://api.postcodes.io/postcodes';

/** Load the simplified choropleth (our client-side data store). */
export async function getGeojson(): Promise<FeatureCollection> {
  const res = await fetch(dataUrl('areas.geojson'));
  if (!res.ok) throw new Error('Could not load the map data');
  return res.json();
}

export interface PostcodeHit {
  postcode: string;
  lng: number;
  lat: number;
}

/**
 * Resolve a postcode to a coordinate via postcodes.io (free, OGL, CORS-enabled).
 * The caller finds the containing area by point-in-polygon (featureAtPoint) —
 * postcodes.io's `codes.lsoa` is now the 2021/2022 census code, which doesn't
 * match our 2011 `area_code`s, so we use coordinates instead (vintage-independent).
 */
export async function lookupPostcode(postcode: string): Promise<PostcodeHit> {
  const pc = postcode.trim();
  if (!pc) throw new Error('Enter a postcode.');
  const res = await fetch(`${POSTCODES_API}/${encodeURIComponent(pc)}`);
  if (res.status === 404) {
    throw new Error('No match — that postcode is outside Great Britain or not recognised.');
  }
  if (!res.ok) throw new Error('Something went wrong looking up that postcode.');
  const { result } = await res.json();
  if (result?.longitude == null || result?.latitude == null) {
    throw new Error('That postcode has no location (it may be in Northern Ireland).');
  }
  return {
    postcode: result.postcode ?? pc.toUpperCase(),
    lng: result.longitude,
    lat: result.latitude,
  };
}

/** Top/bottom N areas by calibrated premium, computed from the loaded GeoJSON. */
export function getRankings(
  lookup: Map<string, Feature>,
  order: 'asc' | 'desc',
  n = 10
): RankingArea[] {
  const rows: RankingArea[] = [];
  for (const f of lookup.values()) {
    const p = f.properties as LsoaProps;
    if (p?.calibrated_premium == null) continue;
    rows.push({
      code: String(p.lsoa11cd),
      name: p.lsoa_name ? String(p.lsoa_name) : String(p.lsoa11cd),
      risk_index: Number(p.risk_index),
      quintile: Number(p.quintile ?? 0),
      calibrated_premium: Number(p.calibrated_premium),
    });
  }
  rows.sort((a, b) =>
    order === 'desc'
      ? (b.calibrated_premium ?? 0) - (a.calibrated_premium ?? 0)
      : (a.calibrated_premium ?? 0) - (b.calibrated_premium ?? 0)
  );
  return rows.slice(0, n);
}

/** Load the trimmed calibration summary and shape it for the methodology panel. */
export async function getMethodology(): Promise<Methodology | null> {
  try {
    const res = await fetch(dataUrl('methodology.json'));
    if (!res.ok) return null;
    const m = await res.json();
    const fa: Methodology['feature_analysis'] = {};
    for (const [k, v] of Object.entries((m.feature_analysis ?? {}) as Record<string, any>)) {
      fa![k] = {
        bucket: v.bucket,
        partial_r: v.partial_r,
        vif: v.vif,
        verdict: v.verdict,
      };
    }
    const xs = m.cross_source_agreement?.moneysupermarket;
    return {
      normalisation: m.feature_basis ?? 'percentile',
      r_squared: m.r_squared,
      cv_r_squared: m.ridge_cv?.cv_r_squared_mean,
      loao_mae: m.leave_one_area_out?.mae_gbp,
      spearman: m.spearman_pred_vs_actual?.rho,
      n_matched: m.n_matched,
      n_areas: m.n_areas,
      n_quarters: m.n_quarters,
      national_avg: m.national_avg_latest,
      feature_analysis: fa,
      cross_source: xs
        ? {
            name: 'MoneySuperMarket',
            rows: (xs.rows ?? []).map((r: any) => ({
              area_name: r.area_name,
              actual_gbp: r.actual_gbp,
              predicted_gbp: r.predicted_gbp,
            })),
            spearman: xs.spearman_pred_vs_actual?.rho,
          }
        : null,
    };
  } catch {
    return null;
  }
}
