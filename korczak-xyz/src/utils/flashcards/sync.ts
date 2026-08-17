/*
 * One sync badge over two independent syncs.
 *
 * Each trainer syncs itself — its own upload queue, its own pull, its own Firestore collection —
 * and that separation is load-bearing (see `src/utils/srs/replay.ts`). But the player has one
 * account and did one sitting, so the start screen shows one verdict, and combining two states into
 * one has exactly one rule that matters: **a half that failed is never reported as synced.** The
 * badge is the thing someone clicks to retry, so a green tick covering a failed upload is the one
 * output this function must not produce.
 *
 * Hence the precedence, and hence `lastSyncedAt` taking the *older* of the two: "synced 2 min ago"
 * has to be true of everything it covers.
 */

/*
 * Declared here rather than imported from a hook, so nothing under `src/utils/` depends on
 * `src/hooks/`. Both `useFretboardData` and `useTransposeData` export a structurally identical
 * copy — TypeScript is structural, so `mergeSync(fb.sync, tp.sync)` type-checks against this one.
 */
export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** Sittings not yet on the account. Summed, because they are all one player's. */
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

/** Worst first. `off` outranks `idle` because a signed-out half is not synced either. */
const PRECEDENCE: SyncStatus[] = ['error', 'syncing', 'off', 'idle'];

function worst(a: SyncStatus, b: SyncStatus): SyncStatus {
  return PRECEDENCE.indexOf(a) <= PRECEDENCE.indexOf(b) ? a : b;
}

export function mergeSync(a: SyncState, b: SyncState): SyncState {
  const lastSyncedAt =
    a.lastSyncedAt == null || b.lastSyncedAt == null
      ? null
      : Math.min(a.lastSyncedAt, b.lastSyncedAt);
  return {
    status: worst(a.status, b.status),
    pending: a.pending + b.pending,
    lastSyncedAt,
    lastError: a.lastError ?? b.lastError,
  };
}

/** Fold several states into one. An empty list is nothing to sync, which is `off`. */
export function mergeAllSync(states: SyncState[]): SyncState {
  if (states.length === 0) {
    return { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };
  }
  return states.reduce(mergeSync);
}
