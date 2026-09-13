/*
 * LocalStorage for the shopping list.
 *
 * This origin has one ~5 MB budget shared with the typing trainer, the flashcards, the solitaire
 * game, the songbook and the sleep log, and the typing trainer has already shown what a silently
 * failed write costs: the page carries on writing while the stored copy stays frozen, and the next
 * load reads back something stale and pushes it over good cloud data. So every write goes through
 * `writeKey`, which reports rather than swallows.
 *
 * **It evicts nothing, and that is the difference from `babySleep/storage.ts`.** That module gives
 * up its own oldest finished entries when the store is full, which is a fair trade there — a year of
 * naps is a lot of rows and the cloud keeps them all. Here the whole history is a few hundred lines
 * of a dozen characters, so there is nothing to reclaim worth having; and the thing it would be
 * reclaiming is what the suggestion chips are built from. A shopping list that noticed a full store
 * and started deleting its own past to make room for a bottle of milk would be taking a real loss to
 * buy nothing. It reports and moves on, and the caller keeps working against the copy in memory.
 */

import { isQuotaError, storageBytes } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import type { ShoppingItem } from './item';
import { normalizeItem } from './item';

const KEYS = {
  items: 'shopping-items',
  unsynced: 'shopping-unsynced',
  owner: 'shopping-owner',
} as const;

/**
 * The keys holding one particular list, as opposed to this browser's preferences. Every one of them
 * is discarded when a different account signs in — see `adoptOwner`.
 */
const CACHED_PER_OWNER = [KEYS.items, KEYS.unsynced] as const;

// --- writing ------------------------------------------------------------------------------------

const failingKeys = new Set<string>();

export function writeKey(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // One report per key per page load. A full store fails again on the very next write, and an
    // `error` entry makes the log sink flush immediately — writing to the store that is already full.
    if (!failingKeys.has(key)) {
      failingKeys.add(key);
      log.error('shopping.storage.write.failed', {
        key,
        bytes: value.length,
        total: storageBytes(),
        quota: isQuotaError(e),
        ...describeError(e),
      });
    }
    return false;
  }
  if (failingKeys.delete(key)) {
    log.info('shopping.storage.write.recovered', { key, total: storageBytes() });
  }
  return true;
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

// --- items --------------------------------------------------------------------------------------

/**
 * Every stored record, tombstones included — callers filter with `splitList`, and `suggest` wants
 * them. Each row goes through `normalizeItem`, so one malformed record written by an older build
 * costs that row and not the whole list.
 */
export function loadItems(): ShoppingItem[] {
  const raw = readJSON<unknown[]>(KEYS.items, []);
  if (!Array.isArray(raw)) return [];
  const items: ShoppingItem[] = [];
  for (const entry of raw) {
    const item = normalizeItem(entry);
    if (item) items.push(item);
  }
  return items;
}

export function saveItems(items: ShoppingItem[]): boolean {
  return writeKey(KEYS.items, JSON.stringify(items));
}

// --- the push queue -----------------------------------------------------------------------------

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

// --- whose list is cached here --------------------------------------------------------------

/*
 * `shopping-items` is one key for the whole origin, and with one account that is fine. With a second
 * account signing in on the same browser it is not: the cached lines are held with no record of
 * which list they came from, so signing out and back in as the other person leaves the previous
 * list's rows in place — and the first sync, seeing lines the cloud lacks, pushes them into the wrong
 * subtree. They are not wrong-looking data; they are one household's list duplicated into two, and
 * the merge is designed to preserve exactly that.
 *
 * Its own key and its own copy of the rule rather than a call into the sleep log's `adoptOwner`,
 * which is memoised per page load against `baby-sleep-owner` and clears the *sleep log's* caches.
 * Sharing it would mean this app's switch quietly clearing another app's data and not its own.
 */
let adopted: { uid: string; switched: boolean } | null = null;

/** Returns whether anything was discarded, so the caller can reload and log the interesting case. */
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

  // Absent: a store written before this key existed, which by definition holds the only list this
  // browser has ever had. Adopt it rather than throwing away a real list on the upgrade.
  const switched = stored !== null;
  if (switched) {
    for (const key of CACHED_PER_OWNER) writeKey(key, JSON.stringify([]));
  }
  writeKey(KEYS.owner, dataUid);
  adopted = { uid: dataUid, switched };
  return switched;
}
