/**
 * Client-side data layer for the static (GitHub Pages) build.
 *
 * GitHub Pages can't run the FastAPI backend, so these functions replace the old
 * `/api/*` endpoints with static files + a public postcode API — same shapes, no
 * server. See docs/superpowers/info/SHOWCASE_PLAN.md.
 *
 *  - getGeojson()       → static frontend/public/data/areas.geojson
 *  - resolvePostcode()  → postcodes.io, in postcode.ts (postcode → point → area)
 *  - getRankings()      → sort the already-loaded GeoJSON client-side
 *  - getMethodology()   → static frontend/public/data/methodology.json
 */
import type { Feature, FeatureCollection } from 'geojson';
import type { FeatureStat, LsoaProps, Methodology, RankingArea } from './types';
import { nationOf, type Nation } from './utils';

// Vite sets BASE_URL to the configured `base` ('/' in dev, '/london-insurance-risk/'
// for Pages) and always includes a trailing slash, so data URLs resolve in both.
export const dataUrl = (name: string): string => `${import.meta.env.BASE_URL}data/${name}`;

/** The `pmtiles://` source URL for a data file: absolute against the page, so it
 *  resolves under the Pages base path whatever the page's query string. */
export const tilesUrl = (path: string, pageHref: string): string =>
  `pmtiles://${new URL(path, pageHref).href}`;

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

/** Whether a feature can be ranked: it has a premium and, when a nation is
 *  given, its area code belongs to that nation. */
const rankable = (p: LsoaProps | null, nation?: Nation): p is LsoaProps =>
  p?.calibrated_premium != null && (!nation || nationOf(String(p.lsoa11cd)) === nation);

/**
 * Top/bottom N areas by calibrated premium, computed from the loaded GeoJSON.
 * `nation` restricts the list before the top-N cut, so each nation gets its own ten.
 */
export function getRankings(
  lookup: Map<string, Feature>,
  order: 'asc' | 'desc',
  n = 10,
  nation?: Nation
): RankingArea[] {
  const rows: RankingArea[] = [];
  for (const f of lookup.values()) {
    const p = f.properties as LsoaProps | null;
    if (!rankable(p, nation)) continue;
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

/** A ready-made comparison the landing offers: `a` becomes the main area, `b` the second. */
export interface ExamplePair {
  label: string;
  a: RankingArea;
  b: RankingArea;
}

/**
 * The "Try" pairs, computed live from the loaded areas so no area code is typed in:
 * GB's dearest against its cheapest, and the dearest area in Wales against the
 * dearest in Scotland. A pair is dropped when a side is missing or both are one area.
 */
export function examplePairs(lookup: Map<string, Feature>): ExamplePair[] {
  const top = (order: 'asc' | 'desc', nation?: Nation) =>
    getRankings(lookup, order, 1, nation)[0];
  const candidates = [
    { label: 'Dearest vs cheapest', a: top('desc'), b: top('asc') },
    { label: 'Dearest in Wales vs Scotland', a: top('desc', 'wales'), b: top('desc', 'scotland') },
  ];
  return candidates.filter(
    (p): p is ExamplePair => p.a != null && p.b != null && p.a.code !== p.b.code
  );
}

/** How many areas `getRankings` ranks from (all GB, or one nation). */
export function countRankable(lookup: Map<string, Feature>, nation?: Nation): number {
  let count = 0;
  for (const f of lookup.values()) {
    if (rankable(f.properties as LsoaProps | null, nation)) count++;
  }
  return count;
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
  spatial_multiplier_checks?: { pair: string; predicted_ratio: number }[];
  variance_decomposition?: {
    place_only_r2: number;
    composition_only_r2: number;
    full_r2: number;
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
      multiplier_checks: m.spatial_multiplier_checks
        ? m.spatial_multiplier_checks.map((c) => ({
            pair: c.pair,
            predicted_ratio: c.predicted_ratio,
          }))
        : null,
      variance: m.variance_decomposition
        ? {
            place_only_r2: m.variance_decomposition.place_only_r2,
            composition_only_r2: m.variance_decomposition.composition_only_r2,
            full_r2: m.variance_decomposition.full_r2,
          }
        : null,
    };
  } catch {
    return null;
  }
}
