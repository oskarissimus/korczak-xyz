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

/** `k95-shell-20260805160245-a1b2c3d4` -> `20260805160245-a1b2c3d4`. */
export function cacheVersion(name) {
  const parts = String(name).split('-');
  if (parts.length < 3 || parts[0] !== CACHE_PREFIX) return null;
  return parts.slice(2).join('-');
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
  return 'asset';
}
