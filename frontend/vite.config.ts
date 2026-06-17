import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The static GitHub Pages build is served from
// https://<user>.github.io/london-insurance-risk/, so assets + data must resolve
// under that sub-path. CI sets GITHUB_PAGES=1 (see deploy-pages.yml); local dev
// stays at '/'. The app is fully static now — no /api proxy needed.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/london-insurance-risk/' : '/',
  plugins: [react()],
})
