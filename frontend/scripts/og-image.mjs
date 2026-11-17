// Render the share card (og:image) to dist/og.png with Playwright's Chromium.
// Run by `npm run build` after copy-methodology.mjs. Locally a share image is a
// nicety: if Chromium is not installed, log it and exit 0 so the build still
// succeeds. The CI and deploy workflows set OG_IMAGE_REQUIRED=1, which turns that
// skip (or an empty file) into a failed build, so the site is never published
// without its og:image (a failed deploy leaves the previous site up).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OG_SIZE, ogHtml } from './og-template.mjs';

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const distDir = path('../dist/');
const out = `${distDir}og.png`;
// Web fonts load from Google Fonts; past this the card renders with fallbacks.
const FONT_WAIT_MS = 8000;
const LAUNCH_TIMEOUT_MS = 30000;
const REQUIRED = process.env.OG_IMAGE_REQUIRED === '1';

if (!existsSync(distDir)) {
  console.error('og-image: dist/ is missing; run vite build first');
  process.exit(1);
}

let browser;
try {
  const methodology = JSON.parse(readFileSync(path('../public/data/methodology.json'), 'utf8'));
  const css = readFileSync(path('../src/index.css'), 'utf8');
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ timeout: LAUNCH_TIMEOUT_MS });
  const page = await browser.newPage({ viewport: OG_SIZE });
  await page.setContent(ogHtml(methodology, css), { waitUntil: 'load', timeout: FONT_WAIT_MS }).catch(() => {});
  let timer;
  await Promise.race([
    page.evaluate(() => document.fonts.ready).catch(() => {}),
    new Promise((r) => {
      timer = setTimeout(r, FONT_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  await page.screenshot({ path: out });
  if (!(statSync(out).size > 0)) throw new Error('dist/og.png is empty');
  console.log(`og-image: dist/og.png (${statSync(out).size} bytes)`);
} catch (e) {
  const why = String(e?.message ?? e).split('\n')[0];
  if (REQUIRED) {
    console.error(`og-image: FAILED, no usable dist/og.png and OG_IMAGE_REQUIRED=1 (${why})`);
    process.exitCode = 1;
  } else {
    console.log(`og-image: skipped, no dist/og.png (${why})`);
  }
} finally {
  await browser?.close().catch(() => {});
}
