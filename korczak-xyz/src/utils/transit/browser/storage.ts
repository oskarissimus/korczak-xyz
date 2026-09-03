/*
 * localStorage for the transport app.
 *
 * Slimmer than the events app's, and deliberately so: this app owns very little that is not the
 * server's. The segments are the reader's and are queued for sync; the corpus is a cache of a
 * collection the collector writes and can be thrown away at any moment.
 *
 * The one thing that cache buys is real, though, and it is the reason this app has an offline story
 * at all: **the place you most want to know whether the metro is broken is underground, where there
 * is no signal.** Firestore's web client keeps no disk cache here, so without this an installed app
 * opened on a platform shows an empty page.
 */

import { describeError, log } from '../../../lib/logger';
import { canonicalStation } from '../lines';
import { DEFAULT_TRANSIT_SETTINGS, METRO_LINES, type MetroLine, type TransitItem, type TransitSettings, type WatchedSegment } from '../types';

export const TRANSIT_KEYS = {
  segments: 'transit-segments',
  unsynced: 'transit-segments-unsynced',
  feed: 'transit-feed',
  settings: 'transit-settings',
  view: 'transit-feed-view',
} as const;

/**
 * How many communiqués the offline cache keeps.
 *
 * Smaller than the events app's 200: a communiqué carries prose, so a row is nearer 1.5 kB than
 * 300 bytes, and two weeks of metro items is a few dozen rows rather than a few hundred.
 */
const FEED_CACHE_LIMIT = 120;

/**
 * Keys holding one signed-in account's data, cleared when the account changes.
 *
 * The corpus is shared and would be harmless to keep — but the *view* of it is not, since a cached
 * feed drawn against the previous account's segments would show the wrong sections until the first
 * pull lands. Cheap to drop; expensive to explain.
 */
const CACHED_PER_OWNER = [
  TRANSIT_KEYS.segments,
  TRANSIT_KEYS.unsynced,
  TRANSIT_KEYS.feed,
  TRANSIT_KEYS.settings,
] as const;

const OWNER_KEY = 'transit-owner';

const failingKeys = new Set<string>();

/**
 * Writes, reporting a failure once per key per page load.
 *
 * Never a bare `catch {}`, for the reason `writeEventsKey` gives: a silently failed write leaves the
 * page looking right while the stored copy freezes, and the next load reads back something older
 * than what was on screen. For a list of watched segments that is an edit that vanished.
 */
export function writeTransitKey(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Under pressure, surrender the corpus cache — never the segments. The cache is a copy of
    // something the collector owns; the segments are not.
    if (isQuotaError(e) && key !== TRANSIT_KEYS.feed) {
      try {
        localStorage.removeItem(TRANSIT_KEYS.feed);
        localStorage.setItem(key, value);
        log.warn('transit.storage.evicted', { key });
        reportRecovered(key);
        return true;
      } catch {
        /* fall through to the report below */
      }
    }
    reportFailed(key, value, e);
    return false;
  }
  reportRecovered(key);
  return true;
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

function reportFailed(key: string, value: string, e: unknown): void {
  if (failingKeys.has(key)) return;
  failingKeys.add(key);
  log.error('transit.storage.write.failed', { key, bytes: value.length, ...describeError(e) });
}

function reportRecovered(key: string): void {
  if (!failingKeys.delete(key)) return;
  log.info('transit.storage.write.recovered', { key });
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// --- the watched segments ---------------------------------------------------------------------

/** Every stored segment, tombstones included — callers filter. */
export function loadSegments(): WatchedSegment[] {
  const raw = readJSON<unknown[]>(TRANSIT_KEYS.segments, []);
  if (!Array.isArray(raw)) return [];
  const out: WatchedSegment[] = [];
  for (const row of raw) {
    const segment = normalizeSegmentRecord(row);
    if (segment) out.push(segment);
  }
  return out;
}

export function saveSegments(segments: WatchedSegment[]): boolean {
  return writeTransitKey(TRANSIT_KEYS.segments, JSON.stringify(segments));
}

/**
 * One stored or downloaded row, validated.
 *
 * The endpoints are re-canonicalised on the way in rather than trusted, which is the same choke
 * point `normalizeSegment` is on the way out — a row written by an older build, or by hand in the
 * console, must not be able to put a spelling into the matcher that `stationsBetween` cannot place.
 * A row that fails is dropped rather than repaired: a segment whose endpoints are unknown is not a
 * journey, and guessing at what was meant is how a filter starts lying.
 */
export function normalizeSegmentRecord(raw: unknown): WatchedSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : null;
  const line = typeof row.line === 'string' ? (row.line as MetroLine) : null;
  if (!id || !line || !METRO_LINES.includes(line)) return null;

  const from = typeof row.from === 'string' ? canonicalStation(line, row.from) : null;
  const to = typeof row.to === 'string' ? canonicalStation(line, row.to) : null;
  if (!from || !to) return null;

  return {
    id,
    rev: typeof row.rev === 'number' ? row.rev : 1,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
    writerId: typeof row.writerId === 'string' ? row.writerId : '',
    ...(row.deleted === true ? { deleted: true } : {}),
    label: typeof row.label === 'string' ? row.label : `${line} · ${from} → ${to}`,
    line,
    from,
    to,
    ...(row.muted === true ? { muted: true } : {}),
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
  };
}

// --- the push queue ---------------------------------------------------------------------------

export function loadUnsynced(key: string): string[] {
  const raw = readJSON<unknown>(key, []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

export function saveUnsynced(key: string, ids: string[]): boolean {
  return writeTransitKey(key, JSON.stringify([...new Set(ids)]));
}

export function markUnsynced(key: string, ids: string[]): boolean {
  return saveUnsynced(key, [...loadUnsynced(key), ...ids]);
}

export function clearUnsynced(key: string, ids: string[]): boolean {
  const done = new Set(ids);
  return saveUnsynced(key, loadUnsynced(key).filter((id) => !done.has(id)));
}

// --- the corpus cache -------------------------------------------------------------------------

export function loadFeedCache(): TransitItem[] {
  const raw = readJSON<unknown[]>(TRANSIT_KEYS.feed, []);
  return Array.isArray(raw) ? (raw.filter((r) => typeof r === 'object' && r) as TransitItem[]) : [];
}

export function saveFeedCache(items: TransitItem[]): boolean {
  return writeTransitKey(TRANSIT_KEYS.feed, JSON.stringify(items.slice(0, FEED_CACHE_LIMIT)));
}

// --- settings and view preference ---------------------------------------------------------------

export function loadSettings(): TransitSettings {
  const stored = readJSON<Partial<TransitSettings>>(TRANSIT_KEYS.settings, {});
  return { ...DEFAULT_TRANSIT_SETTINGS, ...stored };
}

export function saveSettings(settings: TransitSettings): boolean {
  return writeTransitKey(TRANSIT_KEYS.settings, JSON.stringify(settings));
}

/** Whether the feed shows the items it decided were somebody else's problem. Per device. */
export function loadShowOther(): boolean {
  return readJSON<boolean>(TRANSIT_KEYS.view, false) === true;
}

export function saveShowOther(value: boolean): boolean {
  return writeTransitKey(TRANSIT_KEYS.view, JSON.stringify(value));
}

// --- account changes -----------------------------------------------------------------------

let adopted: string | null = null;
let adoptedSwitched = false;

/**
 * Claim the store for one account, clearing it if it belonged to another.
 *
 * Memoises the **answer**, not just the guard, for the reason `adoptOwner` does in the events app:
 * a second caller in the same page load has to be told the switch happened too, or it keeps the
 * previous account's rows in memory over a store that has just been emptied and pushes them into
 * the new account on the first write.
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
  }
  writeTransitKey(OWNER_KEY, uid);
  return switched;
}
