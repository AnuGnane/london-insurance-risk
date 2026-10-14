// Render the share card (og:image) to dist/og.png with Playwright's Chromium.
// Run by `npm run build` after copy-methodology.mjs. A share image is a nicety:
// if Chromium cannot run here, log it and exit 0 so the build (and the deploy)
// never breaks on it.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OG_SIZE, ogHtml } from './og-template.mjs';

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const distDir = path('../dist/');
const out = `${distDir}og.png`;
// Web fonts load from Google Fonts; past this the card renders with fallbacks.
const FONT_WAIT_MS = 8000;
const LAUNCH_TIMEOUT_MS = 30000;

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
  console.log('og-image: dist/og.png');
} catch (e) {
  console.log(`og-image: skipped, no dist/og.png (${String(e?.message ?? e).split('\n')[0]})`);
} finally {
  await browser?.close().catch(() => {});
}
