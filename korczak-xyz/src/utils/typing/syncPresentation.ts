/*
 * What the sync indicator should show, as a pure function of engine state.
 *
 * The indicator answers one question: how did the last sync attempt end. `SyncStatus` cannot
 * answer it on its own - it is a precedence ladder, so a retry in flight reports 'syncing' and
 * hides the failure being retried, and a settled engine reports 'synced' without saying whether
 * that was a moment or an hour ago. Reading `error`/`conflict` alongside `lastSyncedAt` and
 * `lastFailedAt` is what keeps a failure visible while the engine is busy retrying it.
 *
 * Work in flight is deliberately *not* reported. It used to be, in a cell of its own, and it
 * bought a spinner that no one acts on in exchange for something moving in the corner of the eye
 * of someone trying to type. What matters is the outcome, and the outcome survives the retry.
 *
 * Kept separate from the component because that is the half worth testing: the repo's vitest
 * setup has no DOM, and this mirrors how reconcile.ts sits outside syncEngine.ts.
 */

import type { SyncState } from './syncEngine';

/** How the most recent completed attempt ended. 'none' until one has. */
export type SyncOutcome = 'ok' | 'fail' | 'none';

export type SyncFailReason = 'conflict' | 'write-failed' | 'reconcile-failed';

export interface SyncDisplay {
  outcome: SyncOutcome;
  /** The timestamp behind `outcome`, for the "2 min ago" label. Null until either has happened. */
  at: number | null;
  /** Why the last attempt failed. Null when it did not. */
  reason: SyncFailReason | null;
  /** Whether clicking the indicator should retry. False for a conflict: the modal owns it. */
  retryable: boolean;
}

export function describeSync(sync: SyncState): SyncDisplay {
  const { status, error, lastSyncedAt, lastFailedAt, conflict } = sync;

  const failed = error != null || status === 'conflict' || conflict != null;
  const outcome: SyncOutcome = failed ? 'fail' : lastSyncedAt != null ? 'ok' : 'none';
  const at = outcome === 'fail' ? lastFailedAt : outcome === 'ok' ? lastSyncedAt : null;

  const reason: SyncFailReason | null = !failed
    ? null
    : status === 'conflict' || conflict != null
      ? 'conflict'
      : error === 'reconcile-failed'
        ? 'reconcile-failed'
        : 'write-failed';

  return {
    outcome,
    at,
    reason,
    retryable: outcome === 'fail' && reason !== 'conflict',
  };
}
