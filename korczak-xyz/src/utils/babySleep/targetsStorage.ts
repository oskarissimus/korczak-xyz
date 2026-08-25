/*
 * LocalStorage for the target record.
 *
 * Its own keys rather than more of `storage.ts`'s settings blob for the reason `targets.ts` sets
 * out: `BabySleepSettings` is this browser's preference and is never synced, while this is a
 * household fact that has to survive a reinstall and reach the other parent's phone. Two facts of
 * different kinds in one key is one of them written by a merge that has no business touching the
 * other.
 *
 * Writes go through `writeKey` in `storage.ts`, so a failure is reported rather than swallowed. A
 * target is about eighty bytes and there is one of them, so it is never what evicts.
 */

import type { SleepTargets } from './targets';
import { TARGETS_ID, normalizeTargets } from './targets';
import { readJSON, writeKey } from './storage';

export const TARGETS_KEYS = {
  record: 'baby-sleep-targets',
  unsynced: 'baby-sleep-targets-unsynced',
} as const;

/** The stored target, or null when this browser has never held one. */
export function loadTargets(): SleepTargets | null {
  return normalizeTargets(readJSON<unknown>(TARGETS_KEYS.record, null));
}

export function saveTargets(record: SleepTargets): boolean {
  return writeKey(TARGETS_KEYS.record, JSON.stringify(record));
}

// --- the push queue -------------------------------------------------------------------------

/*
 * One document, so the queue is a flag — but it is stored as the same id list the other two
 * collections use rather than as a boolean. That is not decoration: `adoptOwner` clears every
 * per-owner key by writing `[]` into it, and an empty list already means "nothing to push". A
 * boolean key would have to be special-cased there, which is precisely the kind of exception that
 * gets forgotten when the next collection is added.
 */

export function isTargetsUnsynced(): boolean {
  const raw = readJSON<unknown>(TARGETS_KEYS.unsynced, []);
  return Array.isArray(raw) && raw.includes(TARGETS_ID);
}

export function markTargetsUnsynced(): boolean {
  return writeKey(TARGETS_KEYS.unsynced, JSON.stringify([TARGETS_ID]));
}

export function clearTargetsUnsynced(): boolean {
  return writeKey(TARGETS_KEYS.unsynced, JSON.stringify([]));
}
