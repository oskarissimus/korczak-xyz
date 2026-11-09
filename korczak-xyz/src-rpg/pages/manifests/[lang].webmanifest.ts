import type { APIRoute } from 'astro';
import { languages, useTranslations, type Lang } from '../../../src/i18n';
import { iconUrl } from '../../../src/utils/pwa/iconUrl';

/**
 * The game installed from everyrpg.korczak.xyz: one app per locale, the whole origin its scope. Same
 * artwork as the copy on korczak.xyz (`src/pages/manifests/[app].webmanifest.ts`), but a different
 * origin is a different app to the browser, so the two never collide.
 */
export const getStaticPaths = () => (Object.keys(languages) as Lang[]).map((lang) => ({ params: { lang } }));

export const GET: APIRoute = ({ params }) => {
  const lang = (params.lang === 'pl' ? 'pl' : 'en') as Lang;
  const t = useTranslations(lang);
  const root = lang === 'pl' ? '/pl/' : '/';
  const icons = [180, 192, 512].map((size) => ({
    src: iconUrl(`rpg-${size}.png`),
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any',
  }));
  icons.push({ src: iconUrl('rpg-maskable.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  return new Response(
    JSON.stringify(
      {
        id: root,
        name: t('Rpg'),
        short_name: t('pwa.rpg.short'),
        description: t('rpg.desc'),
        lang,
        dir: 'ltr',
        start_url: root,
        // The English app is the whole origin, so it keeps a Polish link inside the app too.
        scope: root,
        display: 'standalone',
        theme_color: '#000000',
        background_color: '#000000',
        icons,
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
};
