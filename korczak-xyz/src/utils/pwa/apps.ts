import { getLocalizedPath, type Lang, type TranslationKey } from '../../i18n';

/**
 * The site ships three installable web apps from one origin. `site` is the whole of
 * korczak.xyz; `tuner` and `songs` are the two that are worth having on a phone, and each is
 * confined to its own corner by `scope` - which is also what keeps the rest of the site, none
 * of which is built for a small screen, out of their windows.
 */
export type PwaApp = 'site' | 'tuner' | 'songs';

interface PwaAppDef {
  /** Unprefixed path the app opens at. The locale prefix is applied per language. */
  path: string;
  nameKey: TranslationKey;
  /**
   * What iOS writes under the home screen icon. Separate from `nameKey` because the page
   * <title> is always `Something | korczak.xyz`, which iOS truncates to "Songs|korcz...".
   */
  shortNameKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export const PWA_APPS: Record<PwaApp, PwaAppDef> = {
  site: {
    path: '',
    nameKey: 'pwa.site.name',
    shortNameKey: 'pwa.site.short',
    descriptionKey: 'pwa.site.desc',
  },
  tuner: {
    path: '/games/tuner',
    nameKey: 'tuner.title',
    shortNameKey: 'pwa.tuner.short',
    descriptionKey: 'tuner.desc',
  },
  songs: {
    path: '/songs',
    nameKey: 'Songs',
    shortNameKey: 'pwa.songs.short',
    descriptionKey: 'pwa.songs.desc',
  },
};

/** The site's own background colour, so the iOS splash screen matches the page behind it. */
export const PWA_THEME_COLOR = '#000080';

export function startUrl(app: PwaApp, lang: Lang): string {
  return getLocalizedPath(PWA_APPS[app].path, lang) || '/';
}

/**
 * iOS opens links outside the scope in Safari instead of the app. The site app deliberately
 * claims the whole origin; the other two claim only their own subtree.
 */
export function scope(app: PwaApp, lang: Lang): string {
  return app === 'site' ? '/' : startUrl(app, lang);
}

export function manifestPath(app: PwaApp, lang: Lang): string {
  return `/manifests/${app}-${lang}.webmanifest`;
}
