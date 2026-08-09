/**
 * Pure decisions the service worker makes, kept out of the worker so they can be tested.
 *
 * There is no jsdom in this project, so a `fetch` handler is not a reachable state in a test.
 * Anything here that is wrong is wrong on every request the site serves, so it lives as plain
 * functions over plain values and `sw.template.js` does nothing but call them. The generator
 * inlines this file into `dist/sw.js` rather than importing it, which keeps the worker a
 * classic script — the safest thing to hand to iOS.
 */

export const CACHE_PREFIX = 'k95';

export function cacheName(kind, version) {
  return `${CACHE_PREFIX}-${kind}-${version}`;
}

/**
 * `k95-shell-20260805160245-a1b2c3d4` -> `20260805160245-a1b2c3d4`.
 *
 * Read from the *end*, not from the third segment onwards: a tier is named after its app and
 * an app id may contain a hyphen (`baby-sleep`), while a build id is always exactly the two
 * segments `<timestamp>-<digest>`. Counting from the left, `k95-baby-sleep-<build>` reports its
 * version as `sleep-<build>` — a version string matching no other cache, so `cachesToDelete`
 * never sweeps that tier and `documentCacheOrder` files it under "some older build" forever.
 * Nothing about that failure is visible from the outside; the cache simply grows.
 */
export function cacheVersion(name) {
  const parts = String(name).split('-');
  if (parts.length < 4 || parts[0] !== CACHE_PREFIX) return null;
  return parts.slice(-2).join('-');
}

/**
 * Which caches to drop on activate.
 *
 * Retains the previous build as well as the current one. Without that grace window,
 * `skipWaiting` has a real hazard: a tab still running the old HTML lazily imports an island
 * chunk whose hashed name was just deleted, and the page dies. Build ids lead with a
 * timestamp so they sort chronologically. Caches belonging to anything else on the origin are
 * never touched.
 */
export function cachesToDelete(names, currentVersion, keep = 2) {
  const ours = names.filter((name) => cacheVersion(name) !== null);
  const versions = [...new Set(ours.map(cacheVersion))];
  const older = versions
    .filter((version) => version !== currentVersion)
    .sort()
    .reverse()
    .slice(0, Math.max(0, keep - 1));
  const retained = new Set([currentVersion, ...older]);
  return ours.filter((name) => !retained.has(cacheVersion(name)));
}

/**
 * Which caches to search for a document, best first.
 *
 * `caches.match()` with no cache name searches every cache in *creation* order — oldest first —
 * so the previous build that `activate` deliberately retains wins over the current one. For a
 * content-hashed asset that is harmless: same name, same bytes. For a document it is the whole
 * problem, because the URL is stable and the markup behind it is a build old.
 */
export function documentCacheOrder(names, currentVersion) {
  const ours = names.filter((name) => cacheVersion(name) !== null);
  const current = ours.filter((name) => cacheVersion(name) === currentVersion);
  const older = ours
    .filter((name) => cacheVersion(name) !== currentVersion)
    .sort((a, b) => (cacheVersion(a) < cacheVersion(b) ? 1 : -1));
  return [...current, ...older];
}

/**
 * `trailingSlash: 'ignore'` means `/songs/x` and `/songs/x/` are one page reachable under two
 * URLs. Cached under both they would be two entries, and a hit under one spelling would miss
 * under the other, so every document is keyed on the slashless form.
 */
export function normalizePathname(pathname) {
  if (typeof pathname !== 'string' || pathname === '') return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Whether a same-origin path serves a page.
 *
 * Every route on this site is extensionless — Astro's directory output plus
 * `trailingSlash: 'ignore'` — and every same-origin non-document carries a file extension:
 * `/_astro/*`, `/fonts/*`, `/icons/*`, `/manifests/*.webmanifest`, `/logo.png`. No route slug
 * in the content collections contains a dot, so the last path segment is a reliable signal —
 * and the only one available, per `classifyRequest`.
 */
export function looksLikeDocumentPath(pathname) {
  const path = normalizePathname(pathname);
  return !/\.[^./]+$/.test(path.slice(path.lastIndexOf('/')));
}

/**
 * How a request should be handled.
 *
 * - `bypass`   the worker must not call respondWith at all
 * - `document` an HTML page: network-first, so an online visitor's markup always matches the
 *              chunk hashes that were just deployed
 * - `asset`    everything else same-origin: cache-first
 */
export function classifyRequest({ method, mode, destination, cache, sameOrigin, pathname }) {
  if (method !== 'GET') return 'bypass';

  // Firebase Auth and Firestore hold long-lived streaming connections, and one bad offline
  // token refresh already poisons the Firestore client permanently (see src/lib/firebase.ts).
  // YouTube embeds are cross-origin too. Nothing off this origin is ours to touch.
  if (!sameOrigin) return 'bypass';

  // island-recovery.js probes with `cache: 'no-store'` and reloads on the answer; answering it
  // from cache would tell it the network is back when it is not, and it would spend its
  // per-pathname reload budget in a loop.
  if (cache === 'no-store' || cache === 'reload') return 'bypass';

  // The browser's own update check for the worker. Serving it from cache is the iOS cache
  // trap: the app would never get a new worker again.
  if (normalizePathname(pathname) === '/sw.js') return 'bypass';

  if (mode === 'navigate' || destination === 'document') return 'document';

  // A page can also be requested without either of those labels, and the labels are all a
  // request carries: ClientRouter fetches the next page's markup with a bare `fetch()`, which
  // arrives as mode 'cors', destination '', indistinguishable from a data fetch. There is no
  // header to key off either — `internalFetchHeaders` compiles to `{}` without an adapter, so
  // a static build marks these fetches with nothing at all. Astro's `<link rel="prefetch">`
  // has the same shape.
  //
  // Classified as an asset, a song page went to the cache-first path written for fonts and
  // hashed chunks, and an installed songbook went on serving the previous build's markup under
  // a URL whose content had changed. The path is the only thing left to decide on.
  if (looksLikeDocumentPath(pathname)) return 'document';

  return 'asset';
}
