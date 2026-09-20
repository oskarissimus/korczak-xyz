// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import rehypeWrapImages from './src/plugins/rehype-wrap-images.mjs';
import { isIndexable } from './src/utils/seo';

/*
 * The Sentry release, and the same string `Navbar.astro` puts in the status bar. Both run
 * `git rev-parse --short HEAD` at build time against the real .git that actions/checkout leaves
 * behind, so an issue in Sentry and the hash on the page name the same deploy.
 *
 * Falls back to 'dev' rather than throwing: a tarball checkout with no .git still has to build.
 */
let commitHash = 'dev';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // No git here; 'dev' is honest about that.
}

/*
 * Source map upload is opt-in on the token being present, which it is only in GitHub Actions.
 * SENTRY_AUTH_TOKEN is the one Sentry credential that can do damage - it writes to the project -
 * so unlike the DSN it is a repository secret and never reaches the bundle. Without it the build
 * is exactly what it was before, minus readable stack traces in Sentry.
 *
 * `filesToDeleteAfterUpload` is what keeps the maps off Cloudflare: they are uploaded to Sentry
 * and then removed from dist/, so the deployed site does not serve the site's own sources.
 */
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryPlugins = sentryAuthToken
  ? [
      sentryVitePlugin({
        org: 'oskar-korczak',
        project: 'korczak-xyz',
        /*
         * No `url`. This org is on Sentry's EU region, so `https://de.sentry.io` looks like the
         * right thing to set and is in fact ignored: an org auth token carries its own region,
         * sentry-cli prefers that over anything configured here, and it said so on every build —
         * "Using https://sentry.io (embedded in token) rather than manually-configured URL".
         * The upload lands in the EU org either way (verified: org oskar-korczak, project
         * korczak-xyz, release = the commit hash). A line that cannot change the outcome and
         * prints a warning is worse than no line, and if the token is ever replaced with one for
         * another region, the token is what decides — not this file.
         */
        authToken: sentryAuthToken,
        release: { name: commitHash },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
    ]
  : [];

export default defineConfig({
  devToolbar: { enabled: false },
  site: 'https://korczak.xyz',
  trailingSlash: 'ignore',
  compressHTML: true,
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'pl'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    react(),
    mdx(),
    /*
     * The site had no sitemap at all until Sep 2026, which left Google to find 199 pages by
     * following links and to guess which of them were the same page. `isIndexable` is the same
     * table `Layout.astro` canonicalises from, so the sitemap lists exactly the URLs that are
     * canonical to themselves: no noindex page, and one entry per app rather than one per tab.
     * A sitemap that disagrees with the canonicals is worse than none — it asks Google to index
     * a URL the page itself disclaims.
     */
    sitemap({
      filter: (page) => isIndexable(new URL(page).pathname),
      i18n: { defaultLocale: 'en', locales: { en: 'en', pl: 'pl' } },
    }),
  ],
  markdown: {
    shikiConfig: {
      theme: 'css-variables',
      wrap: true,
    },
    rehypePlugins: [rehypeWrapImages],
  },
  vite: {
    define: {
      __COMMIT_HASH__: JSON.stringify(commitHash),
      /*
       * Tree-shaking flags the Sentry bundle reads at build time. The integration list in
       * src/lib/sentry.ts already omits replay and feedback, but these drop the code paths that
       * reference them outright, so a dependency bump cannot quietly put ~40KB back in the
       * bundle that was explicitly chosen to be errors-only.
       */
      __SENTRY_DEBUG__: false,
      __RRWEB_EXCLUDE_SHADOW_DOM__: true,
      __RRWEB_EXCLUDE_IFRAME__: true,
      __SENTRY_EXCLUDE_REPLAY_WORKER__: true,
    },
    // Uploaded to Sentry, then deleted from dist/ by the plugin above. Without them every frame
    // in every issue is a line number in a minified chunk.
    build: { sourcemap: sentryAuthToken ? true : false },
    plugins: sentryPlugins,
  },
});
