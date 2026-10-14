import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssVar, ogFigures, ogHtml } from './og-template.mjs';

const committed = JSON.parse(
  readFileSync(new URL('../public/data/methodology.json', import.meta.url), 'utf8')
);
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

describe('og-image template', () => {
  it('shows the three figures from the committed methodology.json', () => {
    const f = ogFigures(committed);
    // Formatted from the JSON's own fields, the way the masthead formats them.
    expect(f.r2).toBe(committed.r_squared.toFixed(3));
    expect(f.mae).toBe(`±£${Math.round(committed.leave_one_area_out.mae_gbp)}`);
    expect(f.n).toBe(String(committed.n_matched));
    const html = ogHtml(committed, css);
    for (const v of [f.r2, f.mae, f.n]) expect(html).toContain(`<div class="v">${v}</div>`);
    expect(html).toContain('anchor observations');
  });

  it('leaves out a figure the JSON lacks instead of inventing one', () => {
    const html = ogHtml({ r_squared: 0.5 }, css);
    expect(html).toContain('<div class="v">0.500</div>');
    expect(html).not.toContain('per area');
    expect(html).not.toContain('anchor observations');
  });

  it('takes its colours from index.css', () => {
    expect(cssVar(css, '--paper', 'x')).toMatch(/^#/);
    expect(ogHtml(committed, css)).toContain(`background: ${cssVar(css, '--paper', 'x')}`);
    expect(cssVar('', '--paper', '#fff')).toBe('#fff');
  });
});
