/*
 * The saved interests, and their cloud sync.
 *
 * Structurally this is `useNightClimate`: refs beside a `publish` that writes the ref and calls
 * `setState` together, a `commit` that is synchronous before any await, a single-flight `runSync`
 * that **pulls before it pushes**. Pulling first matters for the same reason it does there — an
 * interest is a mutable document, so a blind `setDoc` from the phone would land on top of an edit
 * made on the laptop.
 *
 * Simpler in one way: there is no sharing here, so the owner is `user.uid` and there is no
 * `useDataOwner` to wait on. The tri-state that hook exists for ("I could not tell" being different
 * from "you have no share") has no analogue when the only possible owner is the person signed in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getClientId, uuid } from '../lib/clientId';
import { describeError, log } from '../lib/logger';
import {
  adoptOwner,
  loadInterests,
  loadUnsynced,
  clearUnsynced,
  markUnsynced,
  saveInterests,
} from '../utils/events/browser/storage';
import { pullInterests, pushInterest } from '../utils/events/browser/cloud';
import type { InterestDraft } from '../utils/events/interests';
import { newInterest, reviseInterest, tombstoneInterest, withMissingSeeds } from '../utils/events/interests';
import type { Interest } from '../utils/events/types';
import { applyLocal, mergeById, sameRevision } from '../utils/babySleep/versioned';
import type { SyncState } from '../utils/flashcards/sync';
import type { AuthUser } from './useAuth';

export interface EventInterestsData {
  ready: boolean;
  /** Live interests, tombstones filtered out. */
  interests: Interest[];
  sync: SyncState;
  addInterest: (draft: InterestDraft) => void;
  updateInterest: (id: string, draft: InterestDraft) => void;
  setMuted: (id: string, muted: boolean) => void;
  removeInterest: (id: string) => void;
  retrySync: () => void;
}

const OFF: SyncState = { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };

/** Newest first, id as the deterministic tiebreak so two devices order identically. */
function byCreatedDesc(a: Interest, b: Interest): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}

/**
 * Whether two copies are the same version.
 *
 * The version fields alone would be enough for a well-behaved writer; comparing the label too
 * catches the case where two devices reached the same `rev` independently, which `pickVersioned`
 * then has to arbitrate rather than treat as agreement.
 */
function isSameVersion(a: Interest, b: Interest): boolean {
  return sameRevision(a, b) && a.label === b.label;
}

export function useEventInterests(user: AuthUser | null): EventInterestsData {
  const [records, setRecords] = useState<Interest[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>(OFF);

  // Everything, tombstones included — the merge needs them, the UI must not see them.
  const recordsRef = useRef<Interest[]>([]);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  const pulledRef = useRef(false);

  const publish = useCallback((next: Interest[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  // --- load ------------------------------------------------------------------------------------

  useEffect(() => {
    /*
     * Seeding happens here, on the local copy, before any sync — so the five starter interests are
     * there to look at on the first paint rather than after a round trip. `withMissingSeeds` is
     * idempotent and respects tombstones, so a seed deleted on another device stays deleted once
     * the pull arrives, and a seed introduced by a later build turns up without disturbing the rest.
     */
    const stored = loadInterests();
    const seeded = withMissingSeeds(stored, { writerId: getClientId(), now: Date.now() });
    if (seeded.length !== stored.length) {
      saveInterests(seeded);
      markUnsynced(seeded.slice(stored.length).map((i) => i.id));
    }
    publish(seeded);
    readyRef.current = true;
    setReady(true);
    setSync((s) => ({ ...s, pending: loadUnsynced().length }));
  }, [publish]);

  // --- writing ---------------------------------------------------------------------------------

  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  /**
   * Apply locally, then try to send. Synchronous before any await, so an edit survives the tab
   * being closed the instant after it.
   *
   * `applyLocal`, not `mergeById`: a local edit is the human at the form replacing what they are
   * looking at, and there is nobody to arbitrate with. Routing it through the reconciler would let
   * its own tombstone absorb it.
   */
  const commit = useCallback(
    (changed: Interest[]) => {
      if (changed.length === 0) return;
      const next = applyLocal(recordsRef.current, changed, byCreatedDesc);
      publish(next);
      saveInterests(next);
      markUnsynced(changed.map((i) => i.id));
      setSync((s) => ({ ...s, pending: loadUnsynced().length }));
      void runSyncRef.current?.();
    },
    [publish],
  );

  const addInterest = useCallback(
    (draft: InterestDraft) => {
      commit([newInterest(draft, { id: uuid(), writerId: getClientId(), now: Date.now() })]);
    },
    [commit],
  );

  const updateInterest = useCallback(
    (id: string, draft: InterestDraft) => {
      const existing = recordsRef.current.find((i) => i.id === id);
      if (!existing) return;
      commit([reviseInterest(existing, draft, { writerId: getClientId(), now: Date.now() })]);
    },
    [commit],
  );

  const setMuted = useCallback(
    (id: string, muted: boolean) => {
      const existing = recordsRef.current.find((i) => i.id === id);
      if (!existing) return;
      commit([
        {
          ...existing,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          writerId: getClientId(),
          ...(muted ? { muted: true as const } : { muted: undefined }),
        },
      ]);
    },
    [commit],
  );

  const removeInterest = useCallback(
    (id: string) => {
      const existing = recordsRef.current.find((i) => i.id === id);
      if (!existing || existing.deleted) return;
      commit([tombstoneInterest(existing, { writerId: getClientId(), now: Date.now() })]);
    },
    [commit],
  );

  // --- sync ------------------------------------------------------------------------------------

  const runSync = useCallback(
    async (full = false) => {
      const uid = uidRef.current;
      if (!uid || syncingRef.current || !readyRef.current) return;
      syncingRef.current = true;
      setSync((s) => ({ ...s, status: 'syncing' }));

      try {
        const toPush = new Set(loadUnsynced());
        if (full || !pulledRef.current) {
          const remote = await pullInterests(uid);
          const merged = mergeById(recordsRef.current, remote, isSameVersion, byCreatedDesc);
          if (merged.changed) {
            publish(merged.records);
            saveInterests(merged.records);
            log.info('events.interests.sync.merged', { records: merged.records.length });
          }
          // Anything the cloud lacks, or holds an older version of, needs sending — whether or not
          // this device remembered to queue it.
          for (const id of merged.localWins) toPush.add(id);
          pulledRef.current = true;
        }

        const done: string[] = [];
        for (const id of toPush) {
          const record = recordsRef.current.find((i) => i.id === id);
          if (!record) {
            done.push(id);
            continue;
          }
          await pushInterest(uid, record);
          done.push(id);
        }
        if (done.length > 0) clearUnsynced(done);

        setSync({
          status: 'idle',
          pending: loadUnsynced().length,
          lastSyncedAt: Date.now(),
          lastError: null,
        });
      } catch (e) {
        log.warn('events.interests.sync.failed', describeError(e));
        setSync((s) => ({
          ...s,
          status: 'error',
          pending: loadUnsynced().length,
          lastError: String(describeError(e).message ?? 'sync failed'),
        }));
      } finally {
        syncingRef.current = false;
      }
    },
    [publish],
  );

  runSyncRef.current = runSync;

  useEffect(() => {
    if (!user) {
      uidRef.current = null;
      pulledRef.current = false;
      setSync({ status: 'off', pending: loadUnsynced().length, lastSyncedAt: null, lastError: null });
      return;
    }

    // Clears every per-account cache on a switch, so it may have emptied the store out from under
    // the state we are holding.
    if (adoptOwner(user.uid)) {
      log.info('events.cache.reset', { uid: user.uid });
      const stored = loadInterests();
      publish(withMissingSeeds(stored, { writerId: getClientId(), now: Date.now() }));
    }

    uidRef.current = user.uid;
    pulledRef.current = false;
    void runSync(true);
  }, [user, ready, runSync, publish]);

  useEffect(() => {
    const onOnline = () => void runSync(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSync]);

  const retrySync = useCallback(() => void runSync(true), [runSync]);

  const interests = useMemo(() => records.filter((i) => !i.deleted).sort(byCreatedDesc), [records]);

  return { ready, interests, sync, addInterest, updateInterest, setMuted, removeInterest, retrySync };
}
