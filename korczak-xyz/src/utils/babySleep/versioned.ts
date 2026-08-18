/*
 * Reconciling two devices' copies of a set of small, independent rows.
 *
 * This is the merge the sleep log has always used, lifted out of `merge.ts` so the night-climate
 * records can have it without a copy. Nothing here knows what a row *is*: an id, a revision, a
 * writer and a tombstone flag is the whole of the contract, which is exactly the property that lets
 * two collections with unrelated payloads share one reconciler.
 *
 * Two rules make merging without a dialog safe, and they belong with the code rather than with
 * either caller:
 *
 *   1. `rev` before `updatedAt`. Comparing wall clocks alone hands every merge, forever, to
 *      whichever device runs fastest — however stale its copy. `rev` counts a device's own edits to
 *      one row, so it orders causally-related edits correctly and leaves the clock to break ties
 *      between genuinely concurrent ones.
 *   2. **A delete is absorbing.** If either side is a tombstone, the result is a tombstone,
 *      whatever the revisions say. Under plain last-write-wins a concurrent edit can beat a delete
 *      and the row comes back — a phantom that quietly poisons every mean, gets deleted again, and
 *      teaches the owner not to trust the app. Nothing ever undeletes (an undo is a new row with a
 *      new id), so making deletes absorbing costs nothing.
 */

export interface Versioned {
  id: string;
  /**
   * Local edit counter, from 0. The *primary* comparator, in preference to `updatedAt`: a device
   * whose clock runs fast would otherwise win every merge forever, silently, however stale its data.
   */
  rev: number;
  /** Epoch ms of the last local edit. A tiebreak when two devices are at the same `rev`. */
  updatedAt: number;
  /** Which browser profile last wrote it — the final, deterministic tiebreak. */
  writerId: string;
  /** Tombstone. Never removed by an edit: a delete is absorbing. */
  deleted?: boolean;
}

/** Which of two versions of the same row survives. */
export function pickVersioned<T extends Versioned>(a: T, b: T): T {
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

/** The version fields every row has. Callers add their own payload comparison on top. */
export function sameRevision(a: Versioned, b: Versioned): boolean {
  return (
    a.rev === b.rev &&
    a.updatedAt === b.updatedAt &&
    a.writerId === b.writerId &&
    Boolean(a.deleted) === Boolean(b.deleted)
  );
}

export interface MergeOutcome<T> {
  records: T[];
  changed: boolean;
  /** Ids whose local version won, or which the remote has never seen — exactly what to push. */
  localWins: string[];
}

/**
 * Union by id, resolved per row by `pickVersioned`.
 *
 * Idempotent and commutative, which is what lets the caller merge in any order and sync in any
 * sequence without tracking what it has already seen.
 *
 * `sameVersion` decides whether two copies are *identical*, not merely which one wins.
 * `pickVersioned` has to return something for two identical copies and it returns the left one;
 * without this check every row the cloud already holds an identical copy of counts as a local win
 * and is re-uploaded on every sync. `order` must be a total order — a tiebreak on the id, not on the
 * payload alone — or the same two logs merged in the other order produce a different array and the
 * merge stops being commutative.
 */
export function mergeById<T extends Versioned>(
  local: T[],
  remote: T[],
  sameVersion: (a: T, b: T) => boolean,
  order: (a: T, b: T) => number
): MergeOutcome<T> {
  const byId = new Map<string, T>();
  for (const record of local) byId.set(record.id, record);

  const remoteById = new Map<string, T>();
  let changed = false;
  for (const record of remote) {
    remoteById.set(record.id, record);
    const mine = byId.get(record.id);
    if (!mine) {
      byId.set(record.id, record);
      changed = true;
      continue;
    }
    const winner = pickVersioned(mine, record);
    if (winner !== mine) {
      byId.set(record.id, winner);
      changed = true;
    }
  }

  const localWins: string[] = [];
  for (const record of byId.values()) {
    const theirs = remoteById.get(record.id);
    if (!theirs) {
      localWins.push(record.id);
      continue;
    }
    if (sameVersion(record, theirs)) continue;
    if (pickVersioned(record, theirs) !== theirs) localWins.push(record.id);
  }

  return { records: [...byId.values()].sort(order), changed, localWins };
}
