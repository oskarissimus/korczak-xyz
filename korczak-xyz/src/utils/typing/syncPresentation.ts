/*
 * What the sync indicator should show, as a pure function of engine state.
 *
 * `SyncStatus` is a precedence ladder: one label for a machine that is doing two independent
 * things. A retry in flight reports 'syncing', so the failure being retried is invisible; a
 * settled engine reports 'synced', so nothing says whether that was a moment or an hour ago.
 * The indicator asks two questions instead - is something happening now, and how did the last
 * attempt end - and this is where a state answers both.
 *
 * Kept separate from the component because that is the half worth testing: the repo's vitest
 * setup has no DOM, and this mirrors how reconcile.ts sits outside syncEngine.ts.
 */

import type { SyncState } from './syncEngine';

/** Cell one: whether a sync is happening right now. */
export type SyncActivity =
  | 'idle' // nothing outstanding
  | 'busy' // a reconcile or write is actually in flight
  | 'queued'; // changes waiting on a debounce, a retry backoff, or a connection

/** Cell two: how the most recent completed attempt ended. */
export type SyncOutcome = 'ok' | 'fail' | 'none';

export type SyncFailReason = 'conflict' | 'write-failed' | 'reconcile-failed' | 'offline';

export interface SyncDisplay {
  activity: SyncActivity;
  outcome: SyncOutcome;
  /** The timestamp behind `outcome`, for the "2 min ago" label. Null until either has happened. */
  at: number | null;
  /** Why the last attempt failed, or - when it did not - why work is still outstanding. */
  reason: SyncFailReason | null;
  /** Whether clicking the last-sync cell should retry. False for a conflict: the modal owns it. */
  retryable: boolean;
}

export function describeSync(sync: SyncState): SyncDisplay {
  const { status, error, lastSyncedAt, lastFailedAt, pendingWork, conflict } = sync;

  const activity: SyncActivity =
    status === 'starting' || status === 'syncing'
      ? 'busy'
      : pendingWork || status === 'offline'
        ? 'queued'
        : 'idle';

  const failed = error != null || status === 'conflict' || conflict != null;
  const outcome: SyncOutcome = failed ? 'fail' : lastSyncedAt != null ? 'ok' : 'none';
  const at = outcome === 'fail' ? lastFailedAt : outcome === 'ok' ? lastSyncedAt : null;

  const reason: SyncFailReason | null = failed
    ? status === 'conflict' || conflict != null
      ? 'conflict'
      : error === 'reconcile-failed'
        ? 'reconcile-failed'
        : 'write-failed'
    : status === 'offline'
      ? 'offline'
      : null;

  return {
    activity,
    outcome,
    at,
    reason,
    retryable: outcome === 'fail' && reason !== 'conflict',
  };
}
