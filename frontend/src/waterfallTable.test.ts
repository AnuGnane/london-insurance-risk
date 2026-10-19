// The premium waterfall is a real table, so a screen reader hears its name, column
// names and a row count. Its CSS never changes a table element's `display`: Blink
// and WebKit drop the table semantics when it does.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const src = read('./DetailPanel.tsx');
const css = read('./index.css');

const start = src.indexOf('Premium waterfall');
const open = src.indexOf('<table', start);
const table = src.slice(open, src.indexOf('</table>', open));

describe('the waterfall table', () => {
  it('is a table', () => {
    expect(start).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(start);
    expect(table).toMatch(/^<table\s+className=\{`waterfall/);
  });

  it('has a caption carrying the breakdown name', () => {
    expect(table).toMatch(/<caption[^>]*>/);
    const caption = table.slice(table.indexOf('<caption'), table.indexOf('</caption>'));
    expect(caption).toContain('Breakdown of the estimated premium by factor');
    expect(caption).toContain('Breakdown of the estimated premiums by factor');
  });

  it('has column and row headers, and the total in a tfoot', () => {
    expect(table).toContain('<thead>');
    expect(table).toContain('scope="col"');
    expect(table).toContain('scope="row"');
    expect(table).toContain('<tfoot>');
    const tbody = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'));
    expect(tbody).toContain('Typical GB area');
    expect(tbody.indexOf('Typical GB area')).toBeLessThan(tbody.indexOf('data.steps.map'));
    expect(table.slice(table.indexOf('<tfoot>'))).toContain("'This area'");
  });

  it('hides the bars from screen readers', () => {
    expect(src).toMatch(/className=\{`wf-bar[^>]*aria-hidden="true"/s);
  });

  it('gives every bar cell a hidden share of the largest step', () => {
    const cells = table.split('<td className="wf-cell-track">').slice(1);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      const cell = c.slice(0, c.indexOf('</td>'));
      const spans = [...cell.matchAll(/<span className="sr-only">([\s\S]*?)<\/span>/g)];
      expect(spans.length).toBeGreaterThan(0);
      for (const [, text] of spans) {
        expect(text).toContain('maxAbs');
        expect(text).toContain('% of the largest step');
      }
    }
  });

  it('pads only the last step row, so an empty step list leaves the anchor unpadded', () => {
    expect(css).toMatch(/\.waterfall tbody tr\.wf-step:last-child > \*\s*\{[^}]*padding-bottom/);
    expect(css).not.toMatch(/\.waterfall tbody tr:last-child/);
  });

  it('puts no aria-label on a div without a role', () => {
    const divs = [...src.matchAll(/<div\b[^>]*>/gs)].map((m) => m[0]);
    expect(divs.length).toBeGreaterThan(0);
    for (const d of divs) if (/\baria-label=/.test(d)) expect(d).toMatch(/\brole=/);
  });

  it('sets no display on the table or its cells', () => {
    // The last compound of a selector names a table element when it is the table
    // itself, a table tag, or a class the waterfall puts on a row or cell.
    const onTableEl = (compound: string) =>
      /^\.waterfall\b/.test(compound) ||
      /^(table|caption|colgroup|col|thead|tbody|tfoot|tr|th|td)\b/.test(compound) ||
      /\.wf-(row|step|anchor|total|active|cell)\b/.test(compound);
    let checked = 0;
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const s of sel.split(',').map((x) => x.trim())) {
        if (!s.includes('waterfall') && !/\.wf-(row|step|anchor|total|active|cell)\b/.test(s)) continue;
        const last = s.split(/\s+|>/).filter(Boolean).pop()!;
        if (!onTableEl(last)) continue;
        checked++;
        expect(`${s} { ${body.trim()} }`).not.toMatch(/(^|[\s;{])display\s*:/);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
