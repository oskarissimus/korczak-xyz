// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import rehypeWrapImages from './src/plugins/rehype-wrap-images.mjs';
import { isIndexable } from './src/utils/seo';

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
});
