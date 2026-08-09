/**
 * Which installable app a path belongs to.
 *
 * Split out from apps.ts because this half ships to the browser, and apps.ts imports the whole
 * i18n table.
 */
export type PwaApp = 'site' | 'tuner' | 'songs' | 'fretboard' | 'baby-sleep';

/**
 * The scoped subtrees, in both locales. `site` is everything else, so it is not listed - it is
 * the fallback, and being a superset of the others it could never be matched by order.
 *
 * Each pattern claims the app's whole subtree, not just its landing page, so the tabs within
 * one app (the fretboard's stats, the sleep log's stats and share) stay inside it - both for
 * the manifest's `scope`, which decides what iOS opens in the app rather than in Safari, and
 * for crossesAppBoundary, which would otherwise make every tab click a full page load.
 */
const SCOPED: ReadonlyArray<{ app: PwaApp; pattern: RegExp }> = [
  { app: 'tuner', pattern: /^(\/pl)?\/games\/tuner(\/|$)/ },
  { app: 'songs', pattern: /^(\/pl)?\/songs(\/|$)/ },
  { app: 'fretboard', pattern: /^(\/pl)?\/games\/fretboard(\/|$)/ },
  { app: 'baby-sleep', pattern: /^(\/pl)?\/games\/baby-sleep(\/|$)/ },
];

function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function appForPath(pathname: string): PwaApp {
  const path = normalize(pathname);
  for (const { app, pattern } of SCOPED) {
    if (pattern.test(path)) return app;
  }
  return 'site';
}

export function localeForPath(pathname: string): 'en' | 'pl' {
  return /^\/pl(\/|$)/.test(normalize(pathname)) ? 'pl' : 'en';
}

/**
 * The manifest a path links, named rather than fetched. There is one per app *per locale*, so
 * the locale is as much a part of this identity as the app is.
 */
export function manifestIdentity(pathname: string): string {
  return `${appForPath(pathname)}-${localeForPath(pathname)}`;
}

/**
 * Whether moving between two paths changes which installable app the page offers.
 *
 * This matters because Safari reads `<link rel="manifest">`, the page title and the touch icon
 * when a *document* loads, and never looks again. Astro's ClientRouter swaps all three
 * correctly in the DOM on a client-side navigation — verified — but Safari goes on offering
 * whatever it captured at the last full load. Reach the tuner by clicking through the site and
 * "Add to Home Screen" proposes the app you last hard-loaded, with the tuner's icon pasted on
 * top: the name, the start URL and the scope all belong to something else.
 *
 * Navigation *within* one app and locale is unaffected, since those pages all link the same
 * manifest — which is why clicking through the songbook stays a soft navigation.
 */
export function crossesAppBoundary(fromPath: string, toPath: string): boolean {
  return manifestIdentity(fromPath) !== manifestIdentity(toPath);
}
