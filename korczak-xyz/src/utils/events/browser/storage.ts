/*
 * LocalStorage for the events app.
 *
 * Its own module, and its own eviction rule, rather than more of the sleep log's `storage.ts`.
 * The two apps share one ~5 MB origin budget but must be able to fail independently: a full store
 * here must not surrender somebody's sleep history, and a full store there must not drop an
 * interest he typed.
 *
 * It sits in `browser/` rather than beside the matcher, and that directory boundary is the whole
 * point: everything in `src/utils/events/` itself is compiled into the Cloud Functions bundle, so
 * it may import nothing but its siblings (portable.test.ts enforces it, functions/tsconfig.json
 * relies on it). This module touches `localStorage` and the logger and could never compile there.
 * A subdirectory says so structurally, where an exemption list would drift.
 *
 * What is expendable and what is not:
 *
 *   - `events-interests` is the ONLY local copy of something he typed. Never evicted.
 *   - `events-ignores` is the same: an event dismissed by hand is a decision, and dropping it
 *     brings the card back with nothing to say why. Never evicted either.
 *   - `events-feed` is a cache of a server-owned corpus. First to go, and losing it costs one
 *     online refresh — it exists so an installed app shows something on a dead network.
 */

import { isQuotaError, storageBytes } from '../../../lib/localStorage';
import { describeError, log } from '../../../lib/logger';
import { KIND_KEYS, type KindKey } from '../feed';
import type { EventRecord, Ignore, Interest, PushSettings } from '../types';
import { DEFAULT_PUSH_SETTINGS } from '../types';

export const EVENT_KEYS = {
  interests: 'events-interests',
  unsynced: 'events-interests-unsynced',
  ignores: 'events-ignores',
  ignoresUnsynced: 'events-ignores-unsynced',
  feed: 'events-feed',
  pushSubId: 'events-push-sub-id',
  pushSeen: 'events-push-seen-at',
  settings: 'events-push-settings',
  feedCity: 'events-feed-city',
  feedKinds: 'events-feed-kinds',
} as const;

/** How many events the offline cache keeps. Roughly 60 kB at ~300 bytes a row. */
const FEED_CACHE_LIMIT = 200;

/**
 * Keys holding data that belongs to one signed-in account.
 *
 * Cleared when the account changes, so signing in as somebody else on one browser does not leave
 * the previous person's interests in memory to be pushed into the new account on the first write.
 * The sleep log learnt this the hard way; see `adoptOwner` there.
 */
const CACHED_PER_OWNER = [
  EVENT_KEYS.interests,
  EVENT_KEYS.unsynced,
  EVENT_KEYS.ignores,
  EVENT_KEYS.ignoresUnsynced,
  EVENT_KEYS.feed,
  EVENT_KEYS.settings,
  /*
   * A view preference rather than data, but it is one that hides rows — and a filter to Warszawa
   * inherited by the next account would empty a feed nobody in that account had ever narrowed.
   * Cheap to clear, since the whole cost of losing it is one tap on the picker.
   */
  EVENT_KEYS.feedCity,
  // Same argument, same cost: a feed narrowed to announcements is one the next account never
  // narrowed, and it hides rows with nothing on the screen saying who asked for it.
  EVENT_KEYS.feedKinds,
] as const;

const OWNER_KEY = 'events-owner';

const failingKeys = new Set<string>();

/**
 * Writes, reporting a failure once per key per page load.
 *
 * Never a bare `catch {}`. A silently failed write leaves the page working perfectly while the
 * stored copy stays frozen, and the next page load reads back something older than what was on
 * screen — which for a list of interests means edits that vanish with no error anywhere.
 *
 * Once per key because a full store fails again on the very next write, and an `error` entry makes
 * the log sink flush immediately — writing to the store that is already full.
 */
export function writeEventsKey(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Under pressure, surrender the feed cache — never the interests. The cache is a copy of
    // something the server owns; the interests are not.
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

// --- interests ------------------------------------------------------------------------------

/**
 * Every stored interest, tombstones included — callers filter.
 *
 * Each row is validated, so one bad record written by an older build costs that row rather than
 * the whole list.
 */
export function loadInterests(): Interest[] {
  const raw = readJSON<unknown[]>(EVENT_KEYS.interests, []);
  if (!Array.isArray(raw)) return [];
  const out: Interest[] = [];
  for (const item of raw) {
    const interest = normalizeInterest(item);
    if (interest) out.push(interest);
  }
  return out;
}

export function saveInterests(interests: Interest[]): boolean {
  return writeEventsKey(EVENT_KEYS.interests, JSON.stringify(interests));
}

/**
 * Rebuilds an interest from an untrusted value, allow-list style.
 *
 * A field added to the interface and not added here is silently stripped on every read — which is
 * the trade the sleep log's `normalizeClimate` makes too, and the reason to grep for this function
 * when the shape changes.
 */
export function normalizeInterest(raw: unknown): Interest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.rev !== 'number' || typeof r.updatedAt !== 'number') return null;
  if (typeof r.writerId !== 'string') return null;

  const strings = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const list = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return list.length > 0 ? list : undefined;
  };

  return {
    id: r.id,
    rev: r.rev,
    updatedAt: r.updatedAt,
    writerId: r.writerId,
    ...(r.deleted === true ? { deleted: true as const } : {}),
    label: typeof r.label === 'string' ? r.label : '',
    keywords: strings(r.keywords) ?? [],
    excludeKeywords: strings(r.excludeKeywords),
    tags: strings(r.tags),
    cities: strings(r.cities),
    fromDay: typeof r.fromDay === 'string' ? r.fromDay : undefined,
    toDay: typeof r.toDay === 'string' ? r.toDay : undefined,
    leadDays: typeof r.leadDays === 'number' ? r.leadDays : 14,
    ...(r.muted === true ? { muted: true as const } : {}),
    // An interest stored before createdAt existed is treated as ancient rather than as new, so a
    // migration never re-announces its backlog.
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  };
}

// --- the ignores ------------------------------------------------------------------------------

/**
 * Every stored ignore, tombstones included — callers filter, through `ignoredFingerprints`.
 *
 * The tombstones have to survive the round trip: a lifted ignore is a *deleted* row, and dropping
 * it here would let the other device's live copy win the next merge and hide the card again.
 */
export function loadIgnores(): Ignore[] {
  const raw = readJSON<unknown[]>(EVENT_KEYS.ignores, []);
  if (!Array.isArray(raw)) return [];
  const out: Ignore[] = [];
  for (const item of raw) {
    const ignore = normalizeIgnore(item);
    if (ignore) out.push(ignore);
  }
  return out;
}

export function saveIgnores(ignores: Ignore[]): boolean {
  return writeEventsKey(EVENT_KEYS.ignores, JSON.stringify(ignores));
}

/**
 * Rebuilds an ignore from an untrusted value, allow-list style — `normalizeInterest`'s contract.
 *
 * A row with no `fingerprint` is dropped rather than kept: the fingerprint is the whole payload,
 * and a row without one is an ignore of nothing that would sit in the list forever, unmatched by
 * any event and so unreachable from the Ignored view.
 */
export function normalizeIgnore(raw: unknown): Ignore | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.rev !== 'number' || typeof r.updatedAt !== 'number') return null;
  if (typeof r.writerId !== 'string') return null;
  if (typeof r.fingerprint !== 'string' || !r.fingerprint) return null;

  return {
    id: r.id,
    rev: r.rev,
    updatedAt: r.updatedAt,
    writerId: r.writerId,
    ...(r.deleted === true ? { deleted: true as const } : {}),
    fingerprint: r.fingerprint,
    title: typeof r.title === 'string' ? r.title : '',
  };
}

// --- the push queues ------------------------------------------------------------------------

/*
 * Two queues over one pair of functions, keyed by the store they drain — `EVENT_KEYS.unsynced` for
 * the interests, `EVENT_KEYS.ignoresUnsynced` for the ignores.
 *
 * The key is a required argument rather than a default, because the two collections hold ids from
 * different id spaces: an interest is a `uuid()` and an ignore is `slugKey(fingerprint)`. Sharing
 * one queue would have each hook's sync loop look up the other's ids, find nothing, and quietly
 * drop them as already-done — a write that never leaves the device, with a drained queue and a
 * Synced badge saying it did.
 */

export function loadUnsynced(key: string): string[] {
  const raw = readJSON<unknown>(key, []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

export function saveUnsynced(key: string, ids: string[]): boolean {
  return writeEventsKey(key, JSON.stringify([...new Set(ids)]));
}

export function markUnsynced(key: string, ids: string[]): boolean {
  return saveUnsynced(key, [...loadUnsynced(key), ...ids]);
}

export function clearUnsynced(key: string, ids: string[]): boolean {
  const done = new Set(ids);
  return saveUnsynced(key, loadUnsynced(key).filter((id) => !done.has(id)));
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
      return true;
    } catch {
      return false;
    }
  }
  return writeEventsKey(EVENT_KEYS.pushSubId, id);
}

/** When the heartbeat was last written. Throttles it to once every twelve hours. */
export function loadPushSeenAt(): number {
  const raw = readJSON<unknown>(EVENT_KEYS.pushSeen, 0);
  return typeof raw === 'number' ? raw : 0;
}

export function savePushSeenAt(at: number): boolean {
  return writeEventsKey(EVENT_KEYS.pushSeen, JSON.stringify(at));
}

/**
 * Which city the feed is narrowed to, as the spelling to show — `''` for anywhere.
 *
 * The *label* is stored rather than the folded key, and one derives the other: the picker has to
 * name the city it is filtering on even when the corpus currently holds nothing from there (a
 * scrape between runs, a season just ended), and a key alone would leave it saying `warszawa`. The
 * comparison key is `foldText` of this, so the two can never drift into disagreeing.
 */
export function loadFeedCity(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(EVENT_KEYS.feedCity) ?? '';
  } catch {
    return '';
  }
}

export function saveFeedCity(city: string): boolean {
  if (city === '') {
    try {
      localStorage.removeItem(EVENT_KEYS.feedCity);
      return true;
    } catch {
      return false;
    }
  }
  return writeEventsKey(EVENT_KEYS.feedCity, city);
}

/**
 * Which kinds the feed is narrowed to — an empty list for all of them.
 *
 * Validated against the keys this build knows rather than read as written, so a value stored by a
 * future build that has a fourth kind cannot narrow this one to nothing: an unknown key would
 * match no row and silently empty the feed, where dropping it leaves the filter honest about what
 * it can do. An empty result is stored as a removal, so "everything" is the absence of a key.
 */
export function loadFeedKinds(): KindKey[] {
  const raw = readJSON<unknown>(EVENT_KEYS.feedKinds, []);
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(KIND_KEYS);
  return [...new Set(raw.filter((k): k is KindKey => typeof k === 'string' && known.has(k)))];
}

export function saveFeedKinds(kinds: KindKey[]): boolean {
  if (kinds.length === 0) {
    try {
      localStorage.removeItem(EVENT_KEYS.feedKinds);
      return true;
    } catch {
      return false;
    }
  }
  return writeEventsKey(EVENT_KEYS.feedKinds, JSON.stringify(kinds));
}

export function loadPushSettings(): PushSettings {
  const raw = readJSON<Partial<PushSettings>>(EVENT_KEYS.settings, {});
  return { ...DEFAULT_PUSH_SETTINGS, ...(typeof raw === 'object' && raw ? raw : {}) };
}

export function savePushSettings(settings: PushSettings): boolean {
  return writeEventsKey(EVENT_KEYS.settings, JSON.stringify(settings));
}

// --- account switching ----------------------------------------------------------------------

let adopted: string | null = null;
let adoptedSwitched = false;

/**
 * Records which account this browser's cache belongs to, clearing it on a change.
 *
 * Memoised for the page load because more than one caller asks — the interests hook and the
 * ignores hook both mount on the Feed — and the *clearing* must happen exactly once. But the
 * **answer** is memoised too, not just the guard, and that distinction is the whole of the sleep
 * log's `adoptOwner` bug: whoever asks second reads `previous === uid`, having watched the first
 * caller write it, so a plain re-read tells them nothing happened. They then keep the previous
 * account's rows in memory over a store that has just been emptied, and the next sync sees rows
 * the cloud lacks and pushes them into the new account.
 *
 * So every caller in a page load that switched accounts is told it switched, and every one of them
 * reloads from the (now empty) store. Returning `false` to all but the first is only safe while
 * there is exactly one caller, which stopped being true the moment ignoring an event became its
 * own collection.
 *
 * An absent value adopts the current account rather than clearing, so an install predating this
 * migrates instead of losing its interests.
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
