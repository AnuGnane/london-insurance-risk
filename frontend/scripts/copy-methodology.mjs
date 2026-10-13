// Publish the project write-up beside the map: docs/PROJECT_SUMMARY.html →
// dist/methodology.html. Run by `npm run build`, so the gate builds what deploys.
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../docs/PROJECT_SUMMARY.html', import.meta.url));
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

if (!existsSync(distDir)) {
  console.error('copy-methodology: dist/ is missing; run vite build first');
  process.exit(1);
}
copyFileSync(src, `${distDir}methodology.html`);
console.log('copy-methodology: dist/methodology.html');
