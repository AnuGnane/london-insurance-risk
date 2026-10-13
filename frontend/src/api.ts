/**
 * Client-side data layer for the static (GitHub Pages) build.
 *
 * GitHub Pages can't run the FastAPI backend, so these functions replace the old
 * `/api/*` endpoints with static files + a public postcode API — same shapes, no
 * server. See SHOWCASE_PLAN.md.
 *
 *  - getGeojson()       → static frontend/public/data/areas.geojson
 *  - resolvePostcode()  → postcodes.io, in postcode.ts (postcode → point → area)
 *  - getRankings()      → sort the already-loaded GeoJSON client-side
 *  - getMethodology()   → static frontend/public/data/methodology.json
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { FeatureStat, LsoaProps, Methodology, RankingArea } from './types';

// Vite sets BASE_URL to the configured `base` ('/' in dev, '/london-insurance-risk/'
// for Pages) and always includes a trailing slash, so data URLs resolve in both.
export const dataUrl = (name: string): string => `${import.meta.env.BASE_URL}data/${name}`;

// How often the download readout updates (bytes received between reports).
const PROGRESS_STEP_BYTES = 512 * 1024;

/**
 * Load the simplified choropleth (our client-side data store). `onProgress` gets
 * the bytes received so far, for a loading readout; it is skipped when the
 * browser cannot stream the response body.
 */
export async function getGeojson(
  onProgress?: (bytes: number) => void
): Promise<FeatureCollection> {
  const res = await fetch(dataUrl('areas.geojson'));
  if (!res.ok) throw new Error('Could not load the map data');
  if (!onProgress || !res.body) return res.json();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received - reported >= PROGRESS_STEP_BYTES) {
      reported = received;
      onProgress(received);
    }
  }
  onProgress(received);
  // Hand the chunks to a Blob and drop our references, so only one copy of the
  // body is alive while it is parsed (this matters on low-memory phones).
  const blob = new Blob(chunks as BlobPart[]);
  chunks.length = 0;
  return new Response(blob).json();
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

// The subset of the baked methodology.json that the panel reads.
interface RawMethodology {
  feature_basis?: string;
  r_squared: number;
  ridge_cv?: { cv_r_squared_mean?: number };
  leave_one_area_out?: { mae_gbp?: number };
  spearman_pred_vs_actual?: { rho?: number };
  n_matched?: number;
  n_areas?: number;
  n_quarters?: number;
  national_avg_latest?: number;
  feature_analysis?: Record<string, FeatureStat>;
  cross_source_agreement?: {
    moneysupermarket?: {
      rows?: { area_name: string; actual_gbp: number; predicted_gbp: number }[];
      spearman_pred_vs_actual?: { rho?: number };
    };
  };
}

/** Load the trimmed calibration summary and shape it for the methodology panel. */
export async function getMethodology(): Promise<Methodology | null> {
  try {
    const res = await fetch(dataUrl('methodology.json'));
    if (!res.ok) return null;
    const m: RawMethodology = await res.json();
    const fa: Methodology['feature_analysis'] = {};
    for (const [k, v] of Object.entries(m.feature_analysis ?? {})) {
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
            rows: (xs.rows ?? []).map((r) => ({
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
