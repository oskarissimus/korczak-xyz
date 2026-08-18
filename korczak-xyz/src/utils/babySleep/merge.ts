/*
 * Reconciling two devices' sleep logs.
 *
 * This is deliberately *not* the typing trainer's `reconcile.ts`. That machinery — `(rev, writerId)`
 * against a shared bookmark, and a modal asking the human which side to keep — exists because
 * typing progress is one mutable document two devices can branch, where the branches are both real
 * work and only a person can choose. This data is a different shape: a set of small, independent
 * rows. Two devices touching different naps is not a conflict at all, and two devices editing the
 * *same* nap means someone corrected it twice, where the later correction is simply the one they
 * meant. Nothing here can require a dialog.
 *
 * The reconciler itself lives in `versioned.ts`, which is where the two rules that make it safe —
 * `rev` before the wall clock, and an absorbing delete — are written down. It is generic over the
 * payload because the night-climate records merge by exactly the same rules; what stays here is
 * what is about *sleep*: which fields make two copies identical, what order a log reads in, which
 * entry is the one still running, and what may be dropped under storage pressure.
 */

import type { SleepEntry } from './types';
import { isStale } from './types';
import { mergeById, pickVersioned, sameRevision } from './versioned';

/** Which of two versions of the same entry survives. */
export function pickEntry(a: SleepEntry, b: SleepEntry): SleepEntry {
  return pickVersioned(a, b);
}

/**
 * Whether two copies of an entry are the same version — not merely which one wins.
 *
 * Without this check, every entry the cloud already holds an identical copy of counts as a local
 * win and is re-uploaded on every sync. Every persisted field belongs here.
 */
function isSameVersion(a: SleepEntry, b: SleepEntry): boolean {
  return (
    sameRevision(a, b) && a.kind === b.kind && a.start === b.start && a.end === b.end
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

/** Union by id, resolved per entry by `pickEntry`. Idempotent and commutative. */
export function mergeEntries(local: SleepEntry[], remote: SleepEntry[]): MergeResult {
  const merged = mergeById(local, remote, isSameVersion, byStartDesc);
  return { entries: merged.records, changed: merged.changed, localWins: merged.localWins };
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
