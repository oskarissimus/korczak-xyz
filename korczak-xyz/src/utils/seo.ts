/**
 * Canonical URLs, hreflang pairs and the index/noindex policy — the whole set in one table,
 * because every one of them is a statement about the *same* question ("which URL is this page,
 * and should it be in the index at all") and answering it in three places is how they drift apart.
 *
 * Search Console went red in Sep 2026 with "Duplicate without user-selected canonical" and "Page
 * with redirect". Both were self-inflicted and neither was subtle:
 *
 *  - Nothing on the site emitted <link rel="canonical">, so "user-selected" was literally true:
 *    no page selected one, and Google clustered the app tabs by itself and picked a winner.
 *  - Every app tab (/apps/transit/, /apps/transit/alerts/, /apps/transit/raw/, ...) server-renders
 *    the same shell: same <title>, the same default description, a tab strip and a skeleton. The
 *    content that makes those routes different arrives from Firestore after hydration and is
 *    per-user, so a crawler sees four identical pages however long it waits. They are genuinely
 *    one indexable thing, and CANONICAL_PARENT says so out loud instead of leaving Google to guess.
 *
 * The trailing slash is not cosmetic here. Astro builds `about/index.html` and Cloudflare 307s
 * `/about` to `/about/`, so `/about/` is the only form that answers 200 — a canonical or a sitemap
 * entry without the slash would point at a redirect, which is the other half of what Search Console
 * was complaining about. Everything this module emits goes through canonicalPath().
 */

export const SITE = 'https://korczak.xyz';

/** Routes with no Polish counterpart. Everything else on the site is a matched pair. */
const NO_ALTERNATES = new Set(['/404/', '/offline/']);

/**
 * Pages that should not be in the index at all: a sign-in form, two admin panels, the two
 * invite-link landing pages, and the service worker's offline fallback. None of them mean anything
 * to someone arriving cold from a search result, and the share pages are only reachable with a
 * token in the first place. `follow` rather than `none` — the links out of them are still worth
 * crawling.
 */
const NOINDEX = new Set([
  '/login/',
  '/admin/',
  '/offline/',
  '/404/',
  '/apps/anesthesia/admin/',
  '/apps/baby-sleep/config/',
  '/apps/baby-sleep/share/',
  '/apps/shopping/share/',
]);

/**
 * Secondary tabs, mapped to the app they belong to. These stay crawlable and keep working as URLs
 * — the tab strip links to them and an installed app precaches them — but they point their
 * canonical at the app root, so the cluster resolves to one indexed page per app rather than to
 * whichever tab Google happened to like.
 */
const CANONICAL_PARENT: Record<string, string> = {
  '/apps/baby-sleep/checklist/': '/apps/baby-sleep/',
  '/apps/baby-sleep/climate/': '/apps/baby-sleep/',
  '/apps/baby-sleep/stats/': '/apps/baby-sleep/',
  '/apps/events/alerts/': '/apps/events/',
  '/apps/events/sources/': '/apps/events/',
  '/apps/flashcards/chords/': '/apps/flashcards/',
  '/apps/flashcards/neck/': '/apps/flashcards/',
  '/apps/transit/alerts/': '/apps/transit/',
  '/apps/transit/raw/': '/apps/transit/',
  '/apps/transit/routes/': '/apps/transit/',
  '/apps/typing/keys/': '/apps/typing/',
  '/apps/typing/stats/': '/apps/typing/',
};

/** `/about` and `/about/index.html` and `/about/` are one page; the slashed form is the one that 200s. */
export function canonicalPath(pathname: string): string {
  let p = pathname.replace(/index\.html$/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p.replace(/\/{2,}/g, '/');
}

/** Strip the locale prefix to get the route key both languages share. */
function routeKey(path: string): string {
  return path.startsWith('/pl/') ? path.slice(3) : path === '/pl/' ? '/' : path;
}

/** Put a language-neutral route key back into a locale. */
function localized(key: string, lang: 'en' | 'pl'): string {
  if (lang === 'en') return key;
  return key === '/' ? '/pl/' : `/pl${key}`;
}

export interface PageSeo {
  /** Absolute URL for <link rel="canonical">. */
  canonical: string;
  /** Absolute hreflang alternates, empty when the page is noindex or has no translation. */
  alternates: { hreflang: string; href: string }[];
  noindex: boolean;
}

export function getPageSeo(pathname: string, lang: 'en' | 'pl'): PageSeo {
  const path = canonicalPath(pathname);
  const key = routeKey(path);
  const noindex = NOINDEX.has(key);

  // A noindex page keeps a self-referencing canonical. Pointing it at another URL would be two
  // contradictory instructions about the same page, and Google resolves that by ignoring one of
  // them — which one is not something to leave to chance.
  const canonicalTarget = !noindex && CANONICAL_PARENT[key]
    ? localized(CANONICAL_PARENT[key], lang)
    : path;

  // hreflang is only read on a page that is canonical to itself, and is only allowed to name
  // canonical URLs. A consolidated tab advertising its own two locales would be claiming to be
  // an indexable page in the same breath as its canonical disclaims it, and Google resolves that
  // by dropping the whole annotation set. The app root it points at carries the pair instead.
  const selfCanonical = canonicalTarget === path;
  const alternates = noindex || !selfCanonical || NO_ALTERNATES.has(key)
    ? []
    : [
        { hreflang: 'en', href: SITE + localized(key, 'en') },
        { hreflang: 'pl', href: SITE + localized(key, 'pl') },
        { hreflang: 'x-default', href: SITE + localized(key, 'en') },
      ];

  return { canonical: SITE + canonicalTarget, alternates, noindex };
}

/** True when this route belongs in the sitemap: indexable and canonical to itself. */
export function isIndexable(pathname: string): boolean {
  const key = routeKey(canonicalPath(pathname));
  return !NOINDEX.has(key) && !CANONICAL_PARENT[key];
}
