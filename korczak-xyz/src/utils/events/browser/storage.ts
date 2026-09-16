/*
 * LocalStorage for the events app.
 *
 * Its own module, and its own eviction rule, rather than more of the sleep log's `storage.ts`.
 * The two apps share one ~5 MB origin budget but must be able to fail independently: a full store
 * here must not surrender somebody's sleep history, and a full store there must not silence a
 * source he switched off.
 *
 * It sits in `browser/` rather than beside the matcher, and that directory boundary is the whole
 * point: everything in `src/utils/events/` itself is compiled into the Cloud Functions bundle, so
 * it may import nothing but its siblings (portable.test.ts enforces it, functions/tsconfig.json
 * relies on it). This module touches `localStorage` and the logger and could never compile there.
 * A subdirectory says so structurally, where an exemption list would drift.
 *
 * What is expendable and what is not:
 *
 *   - `events-source-prefs` and `events-push-settings` are the only local copies of a decision he
 *     made. Never evicted. Nothing in this app is *typed* any more — the interests were the one
 *     thing that was — but a silenced source is still a choice that exists nowhere else until the
 *     next sync lands.
 *   - `events-feed` is a cache of a server-owned corpus. First to go, and losing it costs one
 *     online refresh — it exists so an installed app shows something on a dead network.
 */

import { isQuotaError, storageBytes } from '../../../lib/localStorage';
import { describeError, log } from '../../../lib/logger';
import { PUSH_APPS } from '../pushApps';
import { normalizeSourcePrefs, type SourcePrefs } from '../sourcePrefs';
import type { EventRecord, PushApp, PushSettings } from '../types';
import { DEFAULT_PUSH_SETTINGS } from '../types';

/*
 * `events-interests` and `events-interests-unsynced` are gone (Sep 2026) and deliberately not
 * migrated: a browser that holds them simply holds two strings nobody reads, which is what happened
 * to `events-feed-city` and `events-feed-kinds` when the feed's filters went. Deleting somebody's
 * data to tidy a key list is a worse idea than a key nobody opens.
 */
export const EVENT_KEYS = {
  feed: 'events-feed',
  pushSubId: 'events-push-sub-id',
  pushApps: 'events-push-sub-apps',
  pushSeen: 'events-push-seen-at',
  settings: 'events-push-settings',
  sourcePrefs: 'events-source-prefs',
} as const;

/** How many events the offline cache keeps. Roughly 60 kB at ~300 bytes a row. */
const FEED_CACHE_LIMIT = 200;

/**
 * Keys holding data that belongs to one signed-in account.
 *
 * Cleared when the account changes, so signing in as somebody else on one browser does not leave
 * the previous person's switches in memory to be pushed into the new account on the first write.
 * The sleep log learnt this the hard way; see `adoptOwner` there.
 */
const CACHED_PER_OWNER = [
  EVENT_KEYS.feed,
  EVENT_KEYS.settings,
  /*
   * Not a view preference: switching a source off silences its notifications too, so this is a
   * setting of the account's rather than of the browser's — and one account's silence must not
   * follow the next person into a feed they have never narrowed.
   */
  EVENT_KEYS.sourcePrefs,
] as const;

const OWNER_KEY = 'events-owner';

const failingKeys = new Set<string>();

/**
 * Writes, reporting a failure once per key per page load.
 *
 * Never a bare `catch {}`. A silently failed write leaves the page working perfectly while the
 * stored copy stays frozen, and the next page load reads back something older than what was on
 * screen — which for the source switches means a feed that un-silences itself with no error
 * anywhere.
 *
 * Once per key because a full store fails again on the very next write, and an `error` entry makes
 * the log sink flush immediately — writing to the store that is already full.
 */
export function writeEventsKey(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Under pressure, surrender the feed cache — never a setting. The cache is a copy of something
    // the server owns; a switch flipped a second ago is not, until the sync lands.
    if (isQuotaError(e) && key !== EVENT_KEYS.feed) {
      const dropped = evictFeedCache();
      if (dropped > 0) {
        log.warn('events.storage.evicted', { key, dropped, total: storageBytes() });
        try {
          localStorage.setItem(key, value);
          reportRecovered(key);
          return true;
        } catch {
          /* fall through to the report below */
        }
      }
    }
    reportFailed(key, value, e);
    return false;
  }
  reportRecovered(key);
  return true;
}

function reportFailed(key: string, value: string, e: unknown): void {
  if (failingKeys.has(key)) return;
  failingKeys.add(key);
  log.error('events.storage.write.failed', {
    key,
    bytes: value.length,
    total: storageBytes(),
    ...describeError(e),
  });
}

function reportRecovered(key: string): void {
  if (!failingKeys.delete(key)) return;
  log.info('events.storage.write.recovered', { key, total: storageBytes() });
}

/** Halve the feed cache. Returns how many rows were dropped. */
function evictFeedCache(): number {
  const cached = loadFeedCache();
  if (cached.length === 0) return 0;
  const keep = cached.slice(0, Math.floor(cached.length / 2));
  try {
    localStorage.setItem(EVENT_KEYS.feed, JSON.stringify(keep));
  } catch {
    // Even the smaller write failed. Give the whole thing up rather than leave it half-written.
    try {
      localStorage.removeItem(EVENT_KEYS.feed);
      return cached.length;
    } catch {
      return 0;
    }
  }
  return cached.length - keep.length;
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // A malformed value is not worth an error: it is unreadable either way, and the caller has a
    // sane fallback. Reads are not what silently loses data — writes are.
    return fallback;
  }
}

// --- the feed cache -------------------------------------------------------------------------

/**
 * The last page of events, so an installed app opened on a dead network shows something.
 *
 * Firestore's client cache here is memory-only, so without this the offline feed is blank — which
 * is most of what the app's precache tier is for.
 */
export function loadFeedCache(): EventRecord[] {
  const raw = readJSON<unknown[]>(EVENT_KEYS.feed, []);
  return Array.isArray(raw) ? (raw.filter((r) => typeof r === 'object' && r) as EventRecord[]) : [];
}

export function saveFeedCache(events: EventRecord[]): boolean {
  return writeEventsKey(EVENT_KEYS.feed, JSON.stringify(events.slice(0, FEED_CACHE_LIMIT)));
}

// --- push bookkeeping -----------------------------------------------------------------------

export function loadPushSubId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(EVENT_KEYS.pushSubId);
  } catch {
    return null;
  }
}

export function savePushSubId(id: string | null): boolean {
  if (id === null) {
    try {
      localStorage.removeItem(EVENT_KEYS.pushSubId);
      // The claims describe that subscription and nothing else; left behind, they would be read
      // against whatever endpoint comes next and stop it ever being stamped.
      localStorage.removeItem(EVENT_KEYS.pushApps);
      return true;
    } catch {
      return false;
    }
  }
  return writeEventsKey(EVENT_KEYS.pushSubId, id);
}

/**
 * Which apps this browser has already recorded against the subscription it holds.
 *
 * Kept locally purely to answer "does the stored row already say this app pushes here?" without a
 * read: the heartbeat that would otherwise carry the claim is throttled to twelve hours, and the
 * whole point of the claim is that it lands on the first launch after the fix ships. Stored with
 * the id it belongs to, so a subscription iOS replaced silently cannot inherit the old one's
 * stamps.
 */
export function loadPushApps(subId: string | null): PushApp[] {
  if (!subId) return [];
  const raw = readJSON<{ id?: unknown; apps?: unknown }>(EVENT_KEYS.pushApps, {});
  if (!raw || raw.id !== subId || !Array.isArray(raw.apps)) return [];
  return raw.apps.filter((app): app is PushApp => PUSH_APPS.includes(app as PushApp));
}

export function savePushApps(subId: string, apps: PushApp[]): boolean {
  return writeEventsKey(EVENT_KEYS.pushApps, JSON.stringify({ id: subId, apps: [...new Set(apps)] }));
}

/** When the heartbeat was last written. Throttles it to once every twelve hours. */
export function loadPushSeenAt(): number {
  const raw = readJSON<unknown>(EVENT_KEYS.pushSeen, 0);
  return typeof raw === 'number' ? raw : 0;
}

export function savePushSeenAt(at: number): boolean {
  return writeEventsKey(EVENT_KEYS.pushSeen, JSON.stringify(at));
}

export function loadPushSettings(): PushSettings {
  const raw = readJSON<Partial<PushSettings>>(EVENT_KEYS.settings, {});
  return { ...DEFAULT_PUSH_SETTINGS, ...(typeof raw === 'object' && raw ? raw : {}) };
}

export function savePushSettings(settings: PushSettings): boolean {
  return writeEventsKey(EVENT_KEYS.settings, JSON.stringify(settings));
}

/**
 * The Sources tab's switches, as this browser last knew them.
 *
 * Stored locally as well as in the cloud because the tab has to draw the boxes on the first paint
 * rather than after a round trip, and `buildFeed` has to know what is off before it draws a feed —
 * which matters more than it did, these being the only filter left. `normalizeSourcePrefs` rather than a cast: this is parsed from a
 * store an older build wrote, and a half-written switch that read as `enabled: undefined` would
 * silence a source with nothing on the screen saying why.
 */
export function loadSourcePrefs(): SourcePrefs {
  return normalizeSourcePrefs(readJSON<unknown>(EVENT_KEYS.sourcePrefs, {}));
}

export function saveSourcePrefs(prefs: SourcePrefs): boolean {
  return writeEventsKey(EVENT_KEYS.sourcePrefs, JSON.stringify(prefs));
}

// --- account switching ----------------------------------------------------------------------

let adopted: string | null = null;
let adoptedSwitched = false;

/**
 * Records which account this browser's cache belongs to, clearing it on a change.
 *
 * Memoised for the page load because more than one caller asks — the source-prefs hook mounts on
 * the Feed and on the Sources tab — and the *clearing* must happen exactly once. But the
 * **answer** is memoised too, not just the guard, and that distinction is the whole of the sleep
 * log's `adoptOwner` bug: whoever asks second reads `previous === uid`, having watched the first
 * caller write it, so a plain re-read tells them nothing happened. They then keep the previous
 * account's rows in memory over a store that has just been emptied, and the next sync sees rows
 * the cloud lacks and pushes them into the new account.
 *
 * So every caller in a page load that switched accounts is told it switched, and every one of them
 * reloads from the (now empty) store. Returning `false` to all but the first is only safe while
 * there is exactly one caller, which stopped being true the moment the source switches became a
 * store of their own.
 *
 * An absent value adopts the current account rather than clearing, so an install predating this
 * migrates instead of losing its cache.
 */
export function adoptOwner(uid: string): boolean {
  if (typeof window === 'undefined') return false;
  if (adopted === uid) return adoptedSwitched;
  adopted = uid;
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(OWNER_KEY);
  } catch {
    return false;
  }
  if (previous === uid) {
    adoptedSwitched = false;
    return false;
  }
  const switched = previous !== null;
  adoptedSwitched = switched;
  if (switched) {
    for (const key of CACHED_PER_OWNER) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* nothing useful to do; the write that follows will report if it matters */
      }
    }
    savePushSubId(null);
  }
  writeEventsKey(OWNER_KEY, uid);
  return switched;
}
