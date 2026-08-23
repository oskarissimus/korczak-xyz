import { getLocalizedPath, type Lang, type TranslationKey } from '../../i18n';
import type { PwaApp } from './scope';

/**
 * The site ships several installable web apps from one origin. `site` is the whole of
 * korczak.xyz; the rest are the corners of it worth having on a phone, and each is confined to
 * its own by `scope` - which is also what keeps the rest of the site, none of which is built
 * for a small screen, out of their windows.
 *
 * What qualifies is a thing you reach for away from a desk: tuning a guitar, a song's chords,
 * drilling the neck between takes, logging a nap at 3am. The games that are only fun on a
 * keyboard stay part of `site`.
 *
 * The path patterns that decide which app a URL belongs to live in scope.ts, which ships to
 * the browser; this module does not, because it pulls in the whole translation table.
 */
export type { PwaApp };

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
    path: '/apps/tuner',
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
  flashcards: {
    path: '/apps/flashcards',
    nameKey: 'Flashcards',
    shortNameKey: 'pwa.flashcards.short',
    descriptionKey: 'flashcards.desc',
  },
  events: {
    path: '/apps/events',
    nameKey: 'Events',
    shortNameKey: 'pwa.events.short',
    descriptionKey: 'events.desc',
  },
  'baby-sleep': {
    path: '/apps/baby-sleep',
    nameKey: 'BabySleep',
    shortNameKey: 'pwa.babySleep.short',
    descriptionKey: 'babySleep.desc',
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

/**
 * The inverse, for the `[app].webmanifest` route's own parameter.
 *
 * Split at the *last* hyphen rather than the first: an app id may contain one (`baby-sleep`)
 * and a locale never does. `split('-')` reads `baby-sleep-en` as the app `baby`, which is not
 * in PWA_APPS, so the route renders a manifest of undefined names under the right URL - and an
 * app whose manifest is malformed is simply not installable, with nothing to say why.
 */
export function parseManifestParam(param: string): { app: PwaApp; lang: Lang } {
  const cut = param.lastIndexOf('-');
  return { app: param.slice(0, cut) as PwaApp, lang: param.slice(cut + 1) as Lang };
}
