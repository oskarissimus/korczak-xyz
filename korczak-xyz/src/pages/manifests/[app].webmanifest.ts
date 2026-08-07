import type { APIRoute } from 'astro';
import { languages, useTranslations, type Lang } from '../../i18n';
import {
  PWA_APPS,
  PWA_THEME_COLOR,
  manifestPath,
  scope,
  startUrl,
  type PwaApp,
} from '../../utils/pwa/apps';
import { iconUrl } from '../../utils/pwa/iconUrl';

/**
 * One manifest per app per locale, generated rather than hand-written so the app names come
 * from the same translation table as everything else on the site.
 *
 * iOS reads the manifest linked from the page you install from, so which of these a visitor
 * gets is decided by the `pwa` prop on that page's Layout.
 */
export const getStaticPaths = () =>
  (Object.keys(PWA_APPS) as PwaApp[]).flatMap((app) =>
    (Object.keys(languages) as Lang[]).map((lang) => ({ params: { app: `${app}-${lang}` } })),
  );

export const GET: APIRoute = ({ params }) => {
  const [app, lang] = (params.app ?? '').split('-') as [PwaApp, Lang];
  const def = PWA_APPS[app];
  const t = useTranslations(lang);

  // Every src carries the artwork's content hash; see iconUrl.ts for why a stable icon URL is
  // not safe behind a week-long CDN cache.
  const icons = [180, 192, 512].map((size) => ({
    src: iconUrl(`${app}-${size}.png`),
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any',
  }));
  icons.push({
    src: iconUrl(`${app}-maskable.png`),
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  });

  return new Response(
    JSON.stringify(
      {
        // A stable id keeps the three apps distinct to the browser even though they share an
        // origin, and survives start_url changing later.
        id: manifestPath(app, lang),
        name: t(def.nameKey),
        short_name: t(def.shortNameKey),
        description: t(def.descriptionKey),
        lang,
        dir: 'ltr',
        start_url: startUrl(app, lang),
        scope: scope(app, lang),
        display: 'standalone',
        theme_color: PWA_THEME_COLOR,
        background_color: PWA_THEME_COLOR,
        icons,
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
};
