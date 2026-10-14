// Pins the figures on the published write-up (docs/PROJECT_SUMMARY.html, served as
// methodology.html) to the committed data, so the next bake cannot leave them stale.
// Every expected value is read from methodology.json or areas.geojson and formatted
// the way the page prints it; no figure is typed into this test. Data-free: both
// files are committed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { formatFigure, formatSci, nationOf } from './utils';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../../docs/PROJECT_SUMMARY.html');
const m = JSON.parse(read('../public/data/methodology.json'));

// The stat cards at the top of the page: [figure, caption].
const stats = [...html.matchAll(/<div class="stat"><b>(.*?)<\/b><span>(.*?)<\/span><\/div>/g)].map(
  (x) => [x[1], x[2]] as const
);
const card = (caption: RegExp) => {
  const hit = stats.find(([, c]) => caption.test(c));
  if (!hit) throw new Error(`no stat card matching ${caption}`);
  return hit;
};

/**
 * Figures with no field in the committed JSON. They were hand-checked against the
 * README and AUDIT (R-7, PR #22) and are listed here, not asserted:
 *  - temporal back-test MAE: README.md:25, AUDIT.md:159
 *  - the modelled premium span: README.md:28
 */
const HAND_CHECKED = ['temporal back-test MAE', 'modelled annual-premium span'] as const;

describe('PROJECT_SUMMARY.html stat cards', () => {
  it('finds the six cards', () => {
    expect(stats).toHaveLength(6);
    for (const what of HAND_CHECKED) expect(stats.some(([, c]) => c.includes(what))).toBe(true);
  });

  it('R², observations, areas and quarters match methodology.json', () => {
    const [figure, caption] = card(/panel fit/);
    expect(figure).toBe(`R² ${formatFigure(m.r_squared, 3)}`);
    expect(caption).toContain(`${m.n_matched} matched anchor observations`);
    expect(caption).toContain(`${m.n_areas} areas`);
    expect(caption).toContain(`up to ${m.n_quarters} quarters`);
  });

  it('the leave-one-area-out MAE matches methodology.json', () => {
    expect(card(/leave-one-area-out MAE/)[0]).toBe(`£${formatFigure(m.leave_one_area_out.mae_gbp, 2)}`);
  });

  it('Spearman matches methodology.json (stopgap: rounded or truncated)', () => {
    // A known mismatch, left for Anu to rule on (R-16 PR): the page, README.md:26 and
    // AUDIT.md:203 show 0.974, but rho rounds to 0.975. Every other figure on the page
    // is rounded. Until the ruling, the card may show rho rounded or truncated to three
    // places, and nothing else, so a later change to rho still fails here.
    const rho: number = m.spearman_pred_vs_actual.rho;
    const shown = card(/Spearman/)[0];
    expect([formatFigure(rho, 3), (Math.trunc(rho * 1000) / 1000).toFixed(3)]).toContain(shown);
  });

  it('the area count and its nation split match areas.geojson', () => {
    const fc: FeatureCollection = JSON.parse(read('../public/data/areas.geojson'));
    const count = { england: 0, wales: 0, scotland: 0 };
    for (const f of fc.features) {
      const n = nationOf(String(f.properties?.lsoa11cd));
      if (n) count[n]++;
    }
    const [figure, caption] = card(/LSOAs \/ Data Zones priced/);
    expect(figure).toBe(formatFigure(fc.features.length));
    expect(caption).toContain(`${formatFigure(count.england)} England`);
    expect(caption).toContain(`${formatFigure(count.wales)} Wales`);
    expect(caption).toContain(`${formatFigure(count.scotland)} Scotland`);
  });
});

describe('PROJECT_SUMMARY.html figures R-7 corrected', () => {
  const fa = m.feature_analysis;
  it('young-driver partial r', () => {
    expect(html).toContain(`partial r ≈ +${formatFigure(fa.young_driver_share_pct.partial_r, 2)}`);
  });
  it('IMD crime partial r and p', () => {
    expect(html).toContain(
      `partial r +${formatFigure(fa.imd_crime_pct.partial_r, 2)}, p=${formatSci(fa.imd_crime_pct.partial_p)}`
    );
  });
  it('place-only R²', () => {
    expect(html).toContain(`place alone (R²&nbsp;${formatFigure(m.variance_decomposition.place_only_r2, 2)})`);
  });
  it('the City of London vs Truro multiplier', () => {
    const check = m.spatial_multiplier_checks.find((c: { pair: string }) => /City of London vs Truro/.test(c.pair));
    expect(html).toContain(`City of London at ≈${formatFigure(check.predicted_ratio, 1)}× Truro`);
  });
});
