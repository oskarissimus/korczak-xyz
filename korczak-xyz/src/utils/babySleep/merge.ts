/*
 * Reconciling two devices' logs.
 *
 * This is deliberately *not* the typing trainer's `reconcile.ts`. That machinery — `(rev, writerId)`
 * against a shared bookmark, and a modal asking the human which side to keep — exists because
 * typing progress is one mutable document two devices can branch, where the branches are both real
 * work and only a person can choose. This data is a different shape: a set of small, independent
 * rows. Two devices touching different naps is not a conflict at all, and two devices editing the
 * *same* nap means someone corrected it twice, where the later correction is simply the one they
 * meant. Nothing here can require a dialog.
 *
 * Two rules make that safe:
 *
 *   1. `rev` before `updatedAt`. Comparing wall clocks alone hands every merge, forever, to
 *      whichever device runs fastest — however stale its copy. `rev` counts a device's own edits to
 *      one entry, so it orders causally-related edits correctly and leaves the clock to break ties
 *      between genuinely concurrent ones.
 *   2. **A delete is absorbing.** If either side is a tombstone, the result is a tombstone,
 *      whatever the revisions say. Under plain last-write-wins a concurrent edit can beat a delete
 *      and the row comes back — a phantom nap that quietly poisons every mean, gets deleted again,
 *      and teaches the owner not to trust the app. Nothing ever undeletes (an undo is a new entry
 *      with a new id), so making deletes absorbing costs nothing.
 */

import type { SleepEntry } from './types';
import { isStale } from './types';

/** Which of two versions of the same entry survives. */
export function pickEntry(a: SleepEntry, b: SleepEntry): SleepEntry {
  // Absorbing delete. Keep the higher rev among tombstones so the survivor still moves forward.
  if (a.deleted || b.deleted) {
    if (a.deleted && b.deleted) return a.rev >= b.rev ? a : b;
    const gone = a.deleted ? a : b;
    const live = a.deleted ? b : a;
    return { ...gone, rev: Math.max(gone.rev, live.rev) };
  }
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // Same rev, same millisecond: pick deterministically so both devices land on the same answer.
  return a.writerId >= b.writerId ? a : b;
}

/**
 * Whether two copies of an entry are the same version — not merely which one wins.
 *
 * `pickEntry` has to return *something* for two identical copies, and it returns the left one. That
 * is fine for merging and useless for deciding what to push: without this check, every entry the
 * cloud already holds an identical copy of counts as a local win and is re-uploaded on every sync.
 */
function isSameVersion(a: SleepEntry, b: SleepEntry): boolean {
  return (
    a.rev === b.rev &&
    a.updatedAt === b.updatedAt &&
    a.writerId === b.writerId &&
    Boolean(a.deleted) === Boolean(b.deleted) &&
    a.kind === b.kind &&
    a.start === b.start &&
    a.end === b.end
  );
}

/**
 * Newest first, and deterministically so.
 *
 * The id tiebreak is not cosmetic: two entries can share a `start` (one edited to match another, or
 * a nap logged twice), and without it the order depends on which side of the merge each arrived
 * from — so the same two logs merged in the other order produce a different array, and the merge
 * stops being commutative.
 */
function byStartDesc(a: SleepEntry, b: SleepEntry): number {
  return b.start - a.start || a.id.localeCompare(b.id);
}

export interface MergeResult {
  entries: SleepEntry[];
  changed: boolean;
  /** Ids whose local version won, or which the remote has never seen — exactly what to push. */
  localWins: string[];
}

/**
 * Union by id, resolved per entry by `pickEntry`.
 *
 * Idempotent and commutative, which is what lets the caller merge in any order and sync in any
 * sequence without tracking what it has already seen.
 */
export function mergeEntries(local: SleepEntry[], remote: SleepEntry[]): MergeResult {
  const byId = new Map<string, SleepEntry>();
  for (const entry of local) byId.set(entry.id, entry);

  const remoteById = new Map<string, SleepEntry>();
  let changed = false;
  for (const entry of remote) {
    remoteById.set(entry.id, entry);
    const mine = byId.get(entry.id);
    if (!mine) {
      byId.set(entry.id, entry);
      changed = true;
      continue;
    }
    const winner = pickEntry(mine, entry);
    if (winner !== mine) {
      byId.set(entry.id, winner);
      changed = true;
    }
  }

  const localWins: string[] = [];
  for (const entry of byId.values()) {
    const theirs = remoteById.get(entry.id);
    if (!theirs) {
      localWins.push(entry.id);
      continue;
    }
    if (isSameVersion(entry, theirs)) continue;
    if (pickEntry(entry, theirs) !== theirs) localWins.push(entry.id);
  }

  return {
    entries: [...byId.values()].sort(byStartDesc),
    changed,
    localWins,
  };
}

/** Live entries, newest first. Tombstones are storage's business and no caller's. */
export function visibleEntries(entries: SleepEntry[]): SleepEntry[] {
  return entries.filter((e) => !e.deleted).sort(byStartDesc);
}

export interface OpenResolution {
  /** The sleep currently running, if any. */
  open: SleepEntry | null;
  /** Other still-running entries — a second device's forgotten timer, needing the human. */
  orphans: SleepEntry[];
  /** Whether `open` has run long enough to be disbelieved. */
  stale: boolean;
}

/**
 * Which entry the timer on screen belongs to.
 *
 * The open entry is *derived*, never held as separate state: it syncs like any other row, so one
 * parent tapping "fell asleep" on a phone must be what the other parent's "woke up" closes. An
 * island keeping its own idea of what is open would produce two rows for one sleep.
 *
 * Two open entries is reachable — both devices tap "fell asleep" while offline, producing two ids
 * that no per-entry merge can join. The one with the latest `start` is *the* open one, since it
 * reflects the most recent human action; the rest are surfaced as orphans rather than deleted,
 * because silently discarding somebody's record is worse than asking.
 */
export function resolveOpen(entries: SleepEntry[], now: number): OpenResolution {
  const running = visibleEntries(entries)
    .filter((e) => e.end == null)
    .sort((a, b) => b.start - a.start);
  const [open = null, ...orphans] = running;
  return { open, orphans, stale: open ? isStale(open, now) : false };
}

/**
 * Entries worth keeping locally, under storage pressure only.
 *
 * Tombstones are kept as long as ordinary entries: they are ~100 bytes and they are what stops a
 * delete being undone by the next pull. `protect` holds ids that must survive regardless — anything
 * not yet pushed, and whatever is currently running.
 */
export function pruneEntries(
  entries: SleepEntry[],
  now: number,
  retentionDays: number,
  protect: Set<string>
): SleepEntry[] {
  const cutoff = now - retentionDays * 86_400_000;
  return entries.filter((e) => protect.has(e.id) || e.end == null || e.start >= cutoff);
}
