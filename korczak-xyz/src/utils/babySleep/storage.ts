/*
 * LocalStorage for the baby sleep log.
 *
 * This origin has one ~5 MB budget shared with the typing trainer, the fretboard trainer, the
 * solitaire game and the songbook — and the typing trainer has already shown what a silently failed
 * write costs: the page carries on logging while the stored copy stays frozen, and the next load
 * reads back something stale and pushes it over good cloud data. So every write goes through
 * `writeKey`, which reports rather than swallows.
 *
 * This log is tiny by comparison — a few hundred bytes a day — so it will almost certainly never be
 * the thing that fills the store. It still has to survive being the one that *notices*, because
 * whichever writer trips the ceiling is the one that fails. Under pressure it gives up the oldest
 * finished entries and nothing else: never a tombstone inside the retention window (that is what
 * stops a delete being undone by the next pull), never an entry not yet pushed to the cloud, and
 * never the sleep currently running.
 */

import { isQuotaError, storageBytes } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import { pruneEntries, resolveOpen } from './merge';
import type { SleepEntry } from './types';
import { normalizeEntry } from './types';

const KEYS = {
  entries: 'baby-sleep-entries',
  unsynced: 'baby-sleep-unsynced',
  settings: 'baby-sleep-settings',
  owner: 'baby-sleep-owner',
} as const;

/**
 * The keys holding one particular log's data, as opposed to this browser's preferences. Every one
 * of them is discarded when a different account signs in — see `adoptOwner`.
 *
 * `climateStorage.ts`'s keys are named here rather than imported from it, because it imports
 * `writeKey` from this module and the cycle would be for two string constants.
 */
const CACHED_PER_OWNER = {
  entries: KEYS.entries,
  unsynced: KEYS.unsynced,
  climate: 'baby-sleep-climate',
  climateUnsynced: 'baby-sleep-climate-unsynced',
} as const;

/** Roughly a year and a bit of history kept on the device. The cloud keeps everything. */
export const ENTRY_RETENTION_DAYS = 400;

export { storageBytes };

// --- writing --------------------------------------------------------------------------------

const failingKeys = new Set<string>();

function reportFailed(key: string, value: string, e: unknown): void {
  // One report per key per page load. A full store fails again on the next write, and an `error`
  // entry makes the log sink flush immediately — writing to the store that is already full.
  if (failingKeys.has(key)) return;
  failingKeys.add(key);
  log.error('babySleep.storage.write.failed', {
    key,
    bytes: value.length,
    total: storageBytes(),
    ...describeError(e),
  });
}

function reportRecovered(key: string): void {
  if (!failingKeys.delete(key)) return;
  log.info('babySleep.storage.write.recovered', { key, total: storageBytes() });
}

/** Surrender the oldest finished entries. Returns how many were dropped. */
function evictEntries(): number {
  const entries = loadEntries();
  if (entries.length === 0) return 0;
  const protect = new Set(loadUnsynced());
  const open = resolveOpen(entries, Date.now()).open;
  if (open) protect.add(open.id);
  // Halve the retention rather than the array: the horizon is the rule, and a caller that keeps
  // failing walks it down until either the write fits or there is nothing left to give.
  for (const days of [ENTRY_RETENTION_DAYS / 2, ENTRY_RETENTION_DAYS / 8, 7]) {
    const keep = pruneEntries(entries, Date.now(), days, protect);
    if (keep.length === entries.length) continue;
    try {
      localStorage.setItem(KEYS.entries, JSON.stringify(keep));
    } catch {
      continue;
    }
    return entries.length - keep.length;
  }
  return 0;
}

/**
 * Exported so `climateStorage.ts` writes under the same discipline — a reported failure rather than
 * a swallowed one — without a second copy of the eviction rule.
 */
export function writeKey(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Evicting entries to make room for the entries would be circular.
    if (isQuotaError(e) && key !== KEYS.entries) {
      const dropped = evictEntries();
      if (dropped > 0) {
        log.warn('babySleep.storage.evicted', { key, droppedEntries: dropped });
        try {
          localStorage.setItem(key, value);
          reportRecovered(key);
          return true;
        } catch (retryError) {
          reportFailed(key, value, retryError);
          return false;
        }
      }
    }
    reportFailed(key, value, e);
    return false;
  }
  reportRecovered(key);
  return true;
}

export function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

// --- entries --------------------------------------------------------------------------------

/**
 * Every stored entry, tombstones included — callers filter with `visibleEntries`.
 *
 * Each record goes through `normalizeEntry`, so one malformed row written by an older build costs
 * that row and not the whole log.
 */
export function loadEntries(): SleepEntry[] {
  const raw = readJSON<unknown[]>(KEYS.entries, []);
  if (!Array.isArray(raw)) return [];
  const entries: SleepEntry[] = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function saveEntries(entries: SleepEntry[]): boolean {
  return writeKey(KEYS.entries, JSON.stringify(entries));
}

// --- the push queue -------------------------------------------------------------------------

/** Ids written locally that the cloud has not acknowledged. */
export function loadUnsynced(): string[] {
  const raw = readJSON<unknown>(KEYS.unsynced, []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

export function saveUnsynced(ids: string[]): boolean {
  return writeKey(KEYS.unsynced, JSON.stringify([...new Set(ids)]));
}

export function markUnsynced(ids: string[]): boolean {
  return saveUnsynced([...loadUnsynced(), ...ids]);
}

export function clearUnsynced(ids: string[]): boolean {
  const done = new Set(ids);
  return saveUnsynced(loadUnsynced().filter((id) => !done.has(id)));
}

// --- whose log is cached here -----------------------------------------------------------------

/*
 * `baby-sleep-entries` is one key for the whole origin, and until the log could be shared that was
 * fine: there was one account, so there was one log. With a second account signing in on the same
 * browser it is not. The cached entries are held with no record of which log they came from, so
 * signing out and back in as the other person leaves the previous log's rows in place — and the
 * first sync, seeing entries the cloud lacks, pushes them into the wrong subtree. They are not
 * wrong-looking data; they are one household's entries duplicated into two logs, and the merge is
 * designed to preserve exactly that.
 *
 * So the cache records which data owner it belongs to. A mismatch is not an error to report, it is
 * a different log: drop the entries and the push queue and start clean.
 */

/*
 * Two hooks call this — the sleep log's and the night climate's — and only the first of them can
 * observe the switch, because it is the one that rewrites the owner key. So the answer is memoised
 * for this page load: both callers learn that the cache was discarded, and both reload. Without it
 * the second hook keeps the previous household's rows in memory and pushes them into the new
 * account on its first write, which is the exact bug this key exists to prevent.
 */
let adopted: { uid: string; switched: boolean } | null = null;

/** Returns whether anything was discarded, so the caller can log the interesting case. */
export function adoptOwner(dataUid: string): boolean {
  if (typeof window === 'undefined') return false;
  if (adopted && adopted.uid === dataUid) return adopted.switched;

  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEYS.owner);
  } catch {
    return false;
  }

  if (stored === dataUid) {
    adopted = { uid: dataUid, switched: false };
    return false;
  }

  // Absent: a store written before this key existed, which by definition holds the only log this
  // browser has ever had. Adopt it rather than throwing away real history on the upgrade.
  const switched = stored !== null;
  if (switched) {
    // Every cache keyed to a log, not just the entries. A key left out here is the household's
    // data sitting in the next account's browser, waiting for the first sync to push it into the
    // wrong subtree — which is the whole reason this key exists.
    for (const key of Object.values(CACHED_PER_OWNER)) writeKey(key, JSON.stringify([]));
  }
  writeKey(KEYS.owner, dataUid);
  adopted = { uid: dataUid, switched };
  return switched;
}

// --- settings -------------------------------------------------------------------------------

/** What the stats page was last looking at. A preference, not data — it is never synced. */
export interface BabySleepSettings {
  window: string;
  customFrom: string;
  customTo: string;
}

const DEFAULT_SETTINGS: BabySleepSettings = { window: '7d', customFrom: '', customTo: '' };

export function loadSettings(): BabySleepSettings {
  const raw = readJSON<Partial<BabySleepSettings> | null>(KEYS.settings, null);
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  return {
    window: typeof raw.window === 'string' ? raw.window : DEFAULT_SETTINGS.window,
    customFrom: typeof raw.customFrom === 'string' ? raw.customFrom : '',
    customTo: typeof raw.customTo === 'string' ? raw.customTo : '',
  };
}

export function saveSettings(settings: BabySleepSettings): boolean {
  return writeKey(KEYS.settings, JSON.stringify(settings));
}
