import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The share card (og.png) went missing from the live site when ubuntu-latest moved
// to an Ubuntu that the pinned Playwright had no Chromium for: the install step was
// allowed to fail and og-image.mjs skipped the card without failing the build.
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ogScript = read('./og-image.mjs');
const workflows = {
  deploy: read('../../.github/workflows/deploy-pages.yml'),
  ci: read('../../.github/workflows/ci.yml'),
};

describe('the og:image cannot be skipped silently in CI or the deploy', () => {
  it('og-image.mjs fails the build when OG_IMAGE_REQUIRED=1 and skips only without it', () => {
    expect(ogScript).toMatch(/process\.env\.OG_IMAGE_REQUIRED === '1'/);
    expect(ogScript).toMatch(/if \(REQUIRED\) \{[\s\S]*?process\.exitCode = 1;/);
    expect(ogScript).toMatch(/statSync\(out\)\.size > 0/);
  });

  it.each(Object.entries(workflows))('%s: requires a non-empty og.png on ubuntu-latest', (_, yml) => {
    expect(yml).not.toMatch(/runs-on:\s*ubuntu-\d/);
    const install = yml.match(/- name: Install Chromium for the og:image\n((?:\s{8}.*\n)+)/)?.[1];
    expect(install).toContain('npx playwright install --with-deps chromium');
    expect(install).not.toMatch(/continue-on-error/);
    const build = yml.match(/- name: Build \(GitHub Pages base path\)\n((?:\s{8}.*\n)+)/)?.[1];
    expect(build).toMatch(/OG_IMAGE_REQUIRED: '1'/);
    expect(yml).toMatch(/test -s dist\/og\.png \|\|/);
  });

  it('deploy: checks og.png before uploading the Pages artifact', () => {
    const check = workflows.deploy.indexOf('test -s dist/og.png');
    const upload = workflows.deploy.indexOf('actions/upload-pages-artifact');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(upload);
  });
});
