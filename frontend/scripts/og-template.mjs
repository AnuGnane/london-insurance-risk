// The share card (og:image) as an HTML page, rendered to dist/og.png by
// og-image.mjs. Every figure comes from the baked methodology.json; colours and
// fonts come from src/index.css's light tokens. Pure, so it is unit-tested.

/** Width and height of the card in CSS px (the Open Graph 1.91:1 size). */
export const OG_SIZE = { width: 1200, height: 630 };

/** A custom property's value from a CSS source (its first, light-scheme definition). */
export function cssVar(css, name, fallback) {
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : fallback;
}

/**
 * The three figures on the card, formatted as the masthead formats them:
 * R² to three places, the leave-one-area-out MAE as "±£77", and the matched
 * anchor observations. null where the JSON lacks the field (never typed in).
 */
export function ogFigures(m) {
  const r2 = m?.r_squared;
  const mae = m?.leave_one_area_out?.mae_gbp;
  const n = m?.n_matched;
  return {
    r2: typeof r2 === 'number' ? r2.toFixed(3) : null,
    mae: typeof mae === 'number' ? `±£${Math.round(mae).toLocaleString('en-GB')}` : null,
    n: typeof n === 'number' ? n.toLocaleString('en-GB') : null,
  };
}

/** The card's HTML. `css` is index.css's source, for the colour and font tokens. */
export function ogHtml(m, css = '') {
  const t = {
    paper: cssVar(css, '--paper', '#fbf7f0'),
    ink: cssVar(css, '--ink', '#24211c'),
    soft: cssVar(css, '--ink-soft', '#4a443b'),
    accent: cssVar(css, '--accent', '#c8102e'),
    rule: cssVar(css, '--rule', '#e4dccd'),
    display: cssVar(css, '--font-display', "Georgia, 'Times New Roman', serif"),
    sans: cssVar(css, '--font-sans', 'system-ui, sans-serif'),
  };
  const f = ogFigures(m);
  const stat = (value, label) =>
    value == null ? '' : `<div class="stat"><div class="v">${value}</div><div class="l">${label}</div></div>`;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@500;600&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: ${OG_SIZE.width}px; height: ${OG_SIZE.height}px; }
  body { background: ${t.paper}; color: ${t.ink}; font-family: ${t.sans};
    box-sizing: border-box; padding: 72px 80px; border-top: 14px solid ${t.accent};
    display: flex; flex-direction: column; }
  .kicker { font-size: 22px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: ${t.soft}; }
  h1 { font-family: ${t.display}; font-weight: 600; font-size: 104px; line-height: 1; margin: 22px 0 18px; }
  .stand { font-family: ${t.display}; font-style: italic; font-size: 36px; color: ${t.soft}; margin: 0; max-width: 960px; }
  .stats { margin-top: auto; display: flex; gap: 64px; border-top: 2px solid ${t.rule}; padding-top: 28px; }
  .v { font-family: ${t.display}; font-size: 54px; font-weight: 600; }
  .l { font-size: 22px; color: ${t.soft}; margin-top: 4px; }
</style></head>
<body>
  <div class="kicker">Territorial pricing · open-data model</div>
  <h1>The Price of Place</h1>
  <p class="stand">How much does where you park move your car-insurance premium? Every small area in Great Britain, mapped.</p>
  <div class="stats">
    ${stat(f.r2, 'panel R²')}
    ${stat(f.mae, 'per area, leave-one-area-out error')}
    ${stat(f.n, 'anchor observations')}
  </div>
</body></html>`;
}
