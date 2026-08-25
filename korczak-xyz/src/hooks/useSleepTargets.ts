/*
 * The target record's state, and its cloud sync.
 *
 * `useNightRoutine`'s shape, reduced to one document: refs beside a `publish` that writes the ref
 * and calls `setState` together, a single-flight `runSync`, localStorage as the always-available
 * store with Firestore layered on when someone is signed in. It **pulls before it pushes** for the
 * same reason that hook does — the record is mutable, so a blind `setDoc` would land on top of a
 * target the other parent set on their phone.
 *
 * What a singleton removes is the push queue's bookkeeping: there is one id, so "what needs sending"
 * is a flag, and the merge is `pickVersioned` rather than a union.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { adoptOwner } from '../utils/babySleep/storage';
import type { SleepTargets } from '../utils/babySleep/targets';
import { mergeTargets, sameTargets, setCribTarget } from '../utils/babySleep/targets';
import { pullTargets, pushTargets } from '../utils/babySleep/targetsCloud';
import {
  clearTargetsUnsynced,
  isTargetsUnsynced,
  loadTargets,
  markTargetsUnsynced,
  saveTargets,
} from '../utils/babySleep/targetsStorage';
import type { SyncState } from '../utils/babySleep/types';
import type { AuthUser } from './useAuth';
import type { DataOwner } from './useDataOwner';

export interface SleepTargetsData {
  ready: boolean;
  /** The record, or null when no target has ever been set on this log. */
  targets: SleepTargets | null;
  /** Minutes after midnight he should be in the crib by, or null. What the charts draw. */
  cribMinutes: number | null;
  sync: SyncState;
  /** Set the crib target, or clear it with null. */
  setCribMinutes: (minutes: number | null) => void;
  retrySync: () => void;
}

const IDLE_SYNC: SyncState = { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };

const pendingCount = () => (isTargetsUnsynced() ? 1 : 0);

export function useSleepTargets(user: AuthUser | null, owner: DataOwner): SleepTargetsData {
  const [targets, setTargets] = useState<SleepTargets | null>(null);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>(IDLE_SYNC);

  const targetsRef = useRef<SleepTargets | null>(null);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  /** Whether this page load has read the document yet. */
  const pulledRef = useRef(false);

  const publish = useCallback((next: SleepTargets | null) => {
    targetsRef.current = next;
    setTargets(next);
  }, []);

  // --- load -------------------------------------------------------------------------------------

  useEffect(() => {
    publish(loadTargets());
    readyRef.current = true;
    setReady(true);
    setSync((s) => ({ ...s, pending: pendingCount() }));
  }, [publish]);

  // --- writing ----------------------------------------------------------------------------------

  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  const setCribMinutes = useCallback(
    (minutes: number | null) => {
      /*
       * Applied by id, unconditionally, and deliberately not through `mergeTargets` — the human is
       * looking at the field and replacing what is in it, and there is nobody to arbitrate with.
       * `applyLocal`'s argument, with one row.
       */
      const next = setCribTarget(minutes, Date.now(), targetsRef.current);
      publish(next);
      saveTargets(next);
      markTargetsUnsynced();
      setSync((s) => ({ ...s, pending: pendingCount() }));
      void runSyncRef.current?.();
    },
    [publish]
  );

  // --- sync -------------------------------------------------------------------------------------

  const runSync = useCallback(
    async (full = false) => {
      const uid = uidRef.current;
      if (!uid || syncingRef.current || !readyRef.current) return;
      syncingRef.current = true;
      setSync((s) => ({ ...s, status: 'syncing' }));

      try {
        let push = isTargetsUnsynced();
        if (full || !pulledRef.current) {
          const remote = await pullTargets(uid);
          const merged = mergeTargets(targetsRef.current, remote);
          if (merged && merged !== targetsRef.current) {
            publish(merged);
            saveTargets(merged);
            log.info('babySleep.targets.sync.merged', { rev: merged.rev });
          }
          // Whatever the cloud lacks or holds an older version of needs sending, whether or not this
          // device remembered to flag it.
          if (merged && (!remote || !sameTargets(merged, remote))) push = true;
          pulledRef.current = true;
        }

        const record = targetsRef.current;
        if (push) {
          // A flag with no record behind it is a queue that can never drain — nothing to send, and
          // `pending` stuck at one forever. Clearing it is the whole of what it is asking for.
          if (record) await pushTargets(uid, record);
          clearTargetsUnsynced();
        }

        setSync({
          status: 'idle',
          pending: pendingCount(),
          lastSyncedAt: Date.now(),
          lastError: null,
        });
      } catch (e) {
        log.warn('babySleep.targets.sync.failed', describeError(e));
        setSync((s) => ({
          ...s,
          status: 'error',
          pending: pendingCount(),
          lastError: String(describeError(e).message ?? 'sync failed'),
        }));
      } finally {
        syncingRef.current = false;
      }
    },
    [publish]
  );

  runSyncRef.current = runSync;

  useEffect(() => {
    /*
     * `owner.resolved` is as much of a precondition as being signed in: a failed share lookup looks
     * exactly like having no share, and guessing wrong writes this household's target into a subtree
     * nobody reads. Staying off is the safe answer, and the charts keep their target locally either
     * way.
     */
    if (!user || !owner.resolved || !owner.dataUid) {
      uidRef.current = null;
      pulledRef.current = false;
      setSync({ status: 'off', pending: pendingCount(), lastSyncedAt: null, lastError: null });
      return;
    }

    // `adoptOwner` clears every per-owner cache, this one included, so it may have emptied the store
    // out from under the state we are holding.
    if (adoptOwner(owner.dataUid)) {
      log.info('babySleep.targets.cache.reset', { dataUid: owner.dataUid });
      publish(loadTargets());
    }

    uidRef.current = owner.dataUid;
    pulledRef.current = false;
    void runSync(true);
  }, [user, ready, runSync, publish, owner.resolved, owner.dataUid]);

  useEffect(() => {
    const onOnline = () => void runSync(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSync]);

  const retrySync = useCallback(() => void runSync(true), [runSync]);

  return {
    ready,
    targets,
    cribMinutes: targets?.cribMinutes ?? null,
    sync,
    setCribMinutes,
    retrySync,
  };
}
