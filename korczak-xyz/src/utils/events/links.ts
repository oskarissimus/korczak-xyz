/*
 * Where a notification lands.
 *
 * A push is about one event, and until this existed every tap opened the feed's first screen: the
 * banner named a concert, the app opened on twenty of them, and finding the one that rang was left
 * to the reader. The notice carries enough to say which row it meant, so it says so.
 *
 * In the portable set because both ends of that link are here — the Cloud Function writes the URL
 * into the payload and the feed reads it back out. A path built in one runtime and parsed in the
 * other by two separate copies of the spelling is the drift this directory exists to prevent.
 */

export const EVENT_PARAM = 'event';

/** The feed tab, with the trailing slash the in-app links use so a tap costs no redirect. */
export const FEED_PATH = '/apps/events/';

/**
 * The path a notification about one event should open.
 *
 * It carries the **fingerprint**, not the event id. Two sources routinely hold the same night —
 * Ticketmaster and the house's own page — and the feed shows one of them: `dedupeByFingerprint`
 * keeps whichever has a ticket link, which need not be the document the notice was minted from. An
 * id would then name a row that is not on the screen. An ignore is keyed on the fingerprint for
 * exactly this reason, and the reasoning applies here verbatim.
 */
export function eventLink(fingerprint: string): string {
  const key = typeof fingerprint === 'string' ? fingerprint.trim() : '';
  // A notice with no fingerprint is not a thing that happens, but landing on the feed is a working
  // notification and a thrown error in the sender is a silent one.
  if (!key) return FEED_PATH;
  return `${FEED_PATH}?${EVENT_PARAM}=${encodeURIComponent(key)}`;
}

/**
 * The fingerprint a deep link asked for, or null for an ordinary visit.
 *
 * Total: anything unreadable is an ordinary visit, because the alternative is an app that fails to
 * open at all when a query string is malformed.
 */
export function eventFocusOf(search: string): string | null {
  if (typeof search !== 'string' || !search) return null;
  try {
    const value = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(
      EVENT_PARAM,
    );
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The same path in the reader's own locale.
 *
 * `/apps/events` and `/pl/apps/events` are two *installed apps* — separate manifests, separate
 * scopes, separate home-screen icons (`manifestIdentity` in pwa/scope.ts is what says so). So a
 * Polish install handed the English path does not just read English: the tap falls outside its
 * scope, the service worker finds no window of its own to focus, and iOS opens Safari instead of
 * the app. The subscription records the language of the page it was made on, which is what makes
 * this answerable at send time.
 */
export function localizePath(path: string, lang: 'en' | 'pl'): string {
  if (lang !== 'pl' || typeof path !== 'string' || !path.startsWith('/')) return path;
  return /^\/pl(\/|$|\?)/.test(path) ? path : `/pl${path}`;
}
