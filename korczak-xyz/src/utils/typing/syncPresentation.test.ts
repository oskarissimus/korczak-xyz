import { describe, expect, it } from 'vitest';
import type { SyncState } from './syncEngine';
import { describeSync } from './syncPresentation';

const OK_AT = 1_700_000_000_000;
const FAIL_AT = OK_AT + 60_000;

function state(overrides: Partial<SyncState> = {}): SyncState {
  return {
    status: 'synced',
    lastSyncedAt: null,
    lastFailedAt: null,
    error: null,
    pendingWork: false,
    conflict: null,
    ...overrides,
  };
}

describe('describeSync', () => {
  describe('activity', () => {
    it('is busy while the initial reconcile runs', () => {
      expect(describeSync(state({ status: 'starting' })).activity).toBe('busy');
    });

    it('is busy while a write is in flight', () => {
      expect(describeSync(state({ status: 'syncing' })).activity).toBe('busy');
    });

    it('is queued when changes are waiting on the debounce', () => {
      expect(describeSync(state({ status: 'pending', pendingWork: true })).activity).toBe('queued');
    });

    it('is queued when offline', () => {
      expect(describeSync(state({ status: 'offline', pendingWork: true })).activity).toBe('queued');
    });

    it('is idle once everything has settled', () => {
      expect(describeSync(state({ status: 'synced', lastSyncedAt: OK_AT })).activity).toBe('idle');
    });

    it('is idle during a conflict - the engine is waiting on a person, not the network', () => {
      expect(describeSync(state({ status: 'conflict' })).activity).toBe('idle');
    });
  });

  describe('outcome', () => {
    it('reports nothing before the first attempt settles', () => {
      const display = describeSync(state({ status: 'starting' }));
      expect(display).toMatchObject({ activity: 'busy', outcome: 'none', at: null });
    });

    it('dates a success from lastSyncedAt', () => {
      const display = describeSync(state({ status: 'synced', lastSyncedAt: OK_AT }));
      expect(display).toMatchObject({ outcome: 'ok', at: OK_AT, reason: null, retryable: false });
    });

    it('dates a failure from lastFailedAt, not the last success', () => {
      const display = describeSync(
        state({ status: 'error', error: 'write-failed', lastSyncedAt: OK_AT, lastFailedAt: FAIL_AT })
      );
      expect(display).toMatchObject({ outcome: 'fail', at: FAIL_AT, reason: 'write-failed' });
    });
  });

  // The whole reason the two cells exist: `status` alone cannot express these.
  describe('the states the single label collapsed', () => {
    it('shows a retry in flight as busy *and* still failing', () => {
      const display = describeSync(
        state({
          status: 'syncing',
          error: 'write-failed',
          lastSyncedAt: OK_AT,
          lastFailedAt: FAIL_AT,
          pendingWork: false,
        })
      );
      expect(display).toMatchObject({ activity: 'busy', outcome: 'fail', at: FAIL_AT });
    });

    it('shows a scheduled retry as queued, which the status ladder reports as error', () => {
      const display = describeSync(
        state({ status: 'error', error: 'write-failed', lastFailedAt: FAIL_AT, pendingWork: true })
      );
      expect(display).toMatchObject({ activity: 'queued', outcome: 'fail', retryable: true });
    });

    it('shows unsaved keystrokes alongside the last good save', () => {
      const display = describeSync(
        state({ status: 'pending', pendingWork: true, lastSyncedAt: OK_AT })
      );
      expect(display).toMatchObject({ activity: 'queued', outcome: 'ok', at: OK_AT });
    });
  });

  describe('retryability', () => {
    it('offers a retry for a failed write', () => {
      expect(
        describeSync(state({ status: 'error', error: 'write-failed', lastFailedAt: FAIL_AT }))
          .retryable
      ).toBe(true);
    });

    it('offers a retry for a failed reconcile', () => {
      const display = describeSync(
        state({ status: 'error', error: 'reconcile-failed', lastFailedAt: FAIL_AT })
      );
      expect(display).toMatchObject({ reason: 'reconcile-failed', retryable: true });
    });

    it('does not offer one for a conflict - the modal resolves that', () => {
      const display = describeSync(state({ status: 'conflict', lastFailedAt: FAIL_AT }));
      expect(display).toMatchObject({ outcome: 'fail', reason: 'conflict', retryable: false });
    });
  });

  it('treats a raised conflict as a failure even before the status catches up', () => {
    const conflict = {
      local: {} as never,
      cloud: {} as never,
      suggested: 'local' as const,
    };
    expect(describeSync(state({ status: 'synced', conflict })).reason).toBe('conflict');
  });
});
