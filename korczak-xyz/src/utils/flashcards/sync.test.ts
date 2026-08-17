import { describe, expect, it } from 'vitest';
import { mergeAllSync, mergeSync } from './sync';
import type { SyncState, SyncStatus } from './sync';

function state(status: SyncStatus, overrides: Partial<SyncState> = {}): SyncState {
  return { status, pending: 0, lastSyncedAt: null, lastError: null, ...overrides };
}

describe('mergeSync', () => {
  it('is synced only when both halves are', () => {
    const at = 1_700_000_000_000;
    const merged = mergeSync(
      state('idle', { lastSyncedAt: at }),
      state('idle', { lastSyncedAt: at })
    );
    expect(merged.status).toBe('idle');
    expect(merged.lastSyncedAt).toBe(at);
  });

  /*
   * The one rule that matters. The badge is what someone clicks to retry, so a green tick covering
   * a failed upload is the output this function exists to make impossible.
   */
  it('reports a failure whichever half failed', () => {
    expect(mergeSync(state('idle'), state('error')).status).toBe('error');
    expect(mergeSync(state('error'), state('idle')).status).toBe('error');
    expect(mergeSync(state('syncing'), state('error')).status).toBe('error');
    expect(mergeSync(state('off'), state('error')).status).toBe('error');
  });

  it('prefers a failure over work still in flight', () => {
    expect(mergeSync(state('error'), state('syncing')).status).toBe('error');
  });

  it('is not idle while either half is still working', () => {
    expect(mergeSync(state('idle'), state('syncing')).status).toBe('syncing');
  });

  it('carries the first error it has, so there is something to show', () => {
    expect(mergeSync(state('idle'), state('error', { lastError: 'offline' })).lastError).toBe(
      'offline'
    );
    expect(
      mergeSync(state('error', { lastError: 'first' }), state('error', { lastError: 'second' }))
        .lastError
    ).toBe('first');
  });

  it('sums what is waiting to upload — it is all one player’s practice', () => {
    expect(mergeSync(state('idle', { pending: 2 }), state('idle', { pending: 3 })).pending).toBe(5);
  });

  /*
   * "Synced 2 min ago" has to be true of everything the badge covers, so the older reading wins —
   * and a half that has never synced makes the whole thing never-synced rather than as recent as
   * the other half.
   */
  it('takes the older reading of when the account last caught up', () => {
    const older = 1_700_000_000_000;
    const newer = older + 60_000;
    expect(
      mergeSync(state('idle', { lastSyncedAt: newer }), state('idle', { lastSyncedAt: older }))
        .lastSyncedAt
    ).toBe(older);
    expect(
      mergeSync(state('idle', { lastSyncedAt: newer }), state('idle', { lastSyncedAt: null }))
        .lastSyncedAt
    ).toBeNull();
  });

  it('is off only when neither half is syncing at all', () => {
    expect(mergeSync(state('off'), state('off')).status).toBe('off');
    expect(mergeSync(state('off'), state('idle')).status).toBe('off');
  });
});

describe('mergeAllSync', () => {
  it('folds a list', () => {
    expect(
      mergeAllSync([state('idle', { pending: 1 }), state('error'), state('idle', { pending: 2 })])
    ).toMatchObject({ status: 'error', pending: 3 });
  });

  it('calls nothing to sync off', () => {
    expect(mergeAllSync([])).toEqual(state('off'));
  });

  it('passes a single state through', () => {
    expect(mergeAllSync([state('syncing', { pending: 4 })])).toEqual(
      state('syncing', { pending: 4 })
    );
  });
});
