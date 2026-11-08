// @ts-check
/**
 * rpg.korczak.xyz: the game and nothing else. `npm run build:rpg`, run only by
 * .github/workflows/rpg-release.yml.
 *
 * The site's config with another source tree (`src-rpg/`, see its README) and another public dir,
 * so none of korczak.xyz's pages, redirects or files are built. Everything else — the commit hash,
 * the Sentry upload, i18n — is the site's, so the two cannot drift. No sitemap or MDX: three pages
 * per locale need neither. `--mode rpg` (`.env.rpg`) is what points it at the korczak-rpg project.
 */
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import site from './astro.config.mjs';

export default defineConfig({
  ...site,
  site: 'https://rpg.korczak.xyz',
  srcDir: './src-rpg',
  publicDir: './public-rpg',
  integrations: [react()],
});
