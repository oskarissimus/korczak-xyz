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
  describe('outcome', () => {
    it('reports nothing before the first attempt settles', () => {
      expect(describeSync(state({ status: 'starting' }))).toMatchObject({
        outcome: 'none',
        at: null,
      });
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

  // The whole reason this is not just `status`: the ladder collapses these onto one rung.
  describe('the states the status ladder hides', () => {
    it('keeps the failure visible while the retry that follows it is in flight', () => {
      const display = describeSync(
        state({
          status: 'syncing',
          error: 'write-failed',
          lastSyncedAt: OK_AT,
          lastFailedAt: FAIL_AT,
        })
      );
      expect(display).toMatchObject({ outcome: 'fail', at: FAIL_AT });
    });

    it('keeps it visible while a retry waits out its backoff', () => {
      const display = describeSync(
        state({ status: 'error', error: 'write-failed', lastFailedAt: FAIL_AT, pendingWork: true })
      );
      expect(display).toMatchObject({ outcome: 'fail', retryable: true });
    });

    it('still reports the last good save while keystrokes wait on the debounce', () => {
      const display = describeSync(
        state({ status: 'pending', pendingWork: true, lastSyncedAt: OK_AT })
      );
      expect(display).toMatchObject({ outcome: 'ok', at: OK_AT });
    });

    it('reports a working sync as ok while offline, since nothing has failed yet', () => {
      const display = describeSync(
        state({ status: 'offline', pendingWork: true, lastSyncedAt: OK_AT })
      );
      expect(display).toMatchObject({ outcome: 'ok', at: OK_AT, reason: null });
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
