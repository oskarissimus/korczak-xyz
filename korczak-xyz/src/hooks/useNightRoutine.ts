/*
 * The routine records' state, and their cloud sync.
 *
 * Structurally this is `useNightClimate` — refs beside a `publish` that writes the ref and calls
 * `setState` together, a single-flight `runSync`, localStorage as the always-available store with
 * Firestore layered on when someone is signed in — and it **pulls before it pushes** for the same
 * reason: these documents are mutable, so a blind `setDoc` would land on top of a correction made on
 * the other parent's phone. Pulling first, merging, and pushing only what won the merge means the
 * two devices converge without a transaction.
 *
 * A separate hook rather than a mode of `useBabySleepData` because the two collections are separate
 * by construction: different documents, different push queue, different Firestore path. What they
 * genuinely share is the reconciler, and that is `versioned.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import type { RoutineDraft, RoutineKey, RoutineRecord } from '../utils/babySleep/routine';
import { routineKey, setRoutine, tombstoneRoutine } from '../utils/babySleep/routine';
import { pullRoutines, pushRoutine } from '../utils/babySleep/routineCloud';
import {
  clearRoutineUnsynced,
  loadRoutines,
  loadRoutinesUnsynced,
  markRoutineUnsynced,
  saveRoutines,
} from '../utils/babySleep/routineStorage';
import {
  applyLocalRoutines,
  mergeRoutines,
  napRoutinesByDay,
  nightRoutinesByDay,
  routinesByDay,
} from '../utils/babySleep/routineStats';
import { adoptOwner } from '../utils/babySleep/storage';
import type { SleepKind, SyncState } from '../utils/babySleep/types';
import type { AuthUser } from './useAuth';
import type { DataOwner } from './useDataOwner';

export interface NightRoutineData {
  ready: boolean;
  /** Every stored record, tombstones included — the stats fold them, the UI must not see them. */
  records: RoutineRecord[];
  /** The live night routines by night key. At most one a night, by construction. */
  nightByDay: Map<string, RoutineRecord>;
  /** The live nap routines by day, earliest first. One per nap. */
  napsByDay: Map<string, RoutineRecord[]>;
  /** Every live routine by day, night first — what the history rows draw. */
  byDay: Map<string, RoutineRecord[]>;
  sync: SyncState;
  /**
   * Write a routine, or correct one.
   *
   * With a `key` it edits that record, so an id never moves under an edit; without one it mints the
   * id from the draft's own `start`, which is the single path the live tap and the form both take.
   */
  logRoutine: (draft: RoutineDraft, kind: SleepKind, key?: RoutineKey) => void;
  /** Tombstone it. An occasion with no routine record is simply one nobody logged a routine for. */
  clearRoutine: (id: string) => void;
  retrySync: () => void;
}

const IDLE_SYNC: SyncState = { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };

export function useNightRoutine(user: AuthUser | null, owner: DataOwner): NightRoutineData {
  const [records, setRecords] = useState<RoutineRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>(IDLE_SYNC);

  const recordsRef = useRef<RoutineRecord[]>([]);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  /** Whether this page load has read the whole collection yet. */
  const pulledRef = useRef(false);

  const publish = useCallback((next: RoutineRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  // Who is logging, for `authorEmail`. Through a ref so the mutation callbacks do not take the user
  // as a dependency and get re-created on every auth tick.
  const authorRef = useRef<string | undefined>(undefined);
  authorRef.current = user?.email ?? undefined;

  // --- load -------------------------------------------------------------------------------------

  useEffect(() => {
    publish(loadRoutines());
    readyRef.current = true;
    setReady(true);
    setSync((s) => ({ ...s, pending: loadRoutinesUnsynced().length }));
  }, [publish]);

  // --- writing ----------------------------------------------------------------------------------

  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  /**
   * Commit changed records locally, then try to send them. Synchronous before any await, so a tap
   * survives the tab being closed the instant after it — there is no scratch key to recover from,
   * because the record itself is already the durable one.
   */
  const commit = useCallback(
    (changed: RoutineRecord[]) => {
      if (changed.length === 0) return;
      const next = applyLocalRoutines(recordsRef.current, changed);
      publish(next);
      saveRoutines(next);
      markRoutineUnsynced(changed.map((r) => r.id));
      setSync((s) => ({ ...s, pending: loadRoutinesUnsynced().length }));
      void runSyncRef.current?.();
    },
    [publish]
  );

  const logRoutine = useCallback(
    (draft: RoutineDraft, kind: SleepKind, key?: RoutineKey) => {
      const target = key ?? routineKey(kind, draft.start);
      const prev = recordsRef.current.find((r) => r.id === target.id);
      commit([setRoutine(target, draft, Date.now(), prev, authorRef.current)]);
    },
    [commit]
  );

  const clearRoutine = useCallback(
    (id: string) => {
      const prev = recordsRef.current.find((r) => r.id === id);
      if (!prev || prev.deleted) return;
      commit([tombstoneRoutine(prev, Date.now())]);
    },
    [commit]
  );

  // --- sync -------------------------------------------------------------------------------------

  const runSync = useCallback(
    async (full = false) => {
      const uid = uidRef.current;
      if (!uid || syncingRef.current || !readyRef.current) return;
      syncingRef.current = true;
      setSync((s) => ({ ...s, status: 'syncing' }));

      try {
        const toPush = new Set(loadRoutinesUnsynced());
        if (full || !pulledRef.current) {
          const pull = await pullRoutines(uid);
          const merged = mergeRoutines(recordsRef.current, pull.records);
          if (merged.changed) {
            publish(merged.records);
            saveRoutines(merged.records);
            log.info('babySleep.routine.sync.merged', { records: merged.records.length });
          }
          // Anything the cloud lacks, or holds an older version of, needs sending — whether or not
          // this device remembered to queue it.
          for (const id of merged.localWins) toPush.add(id);
          pulledRef.current = true;
        }

        const done: string[] = [];
        for (const id of toPush) {
          const record = recordsRef.current.find((r) => r.id === id);
          if (!record) {
            done.push(id);
            continue;
          }
          await pushRoutine(uid, record);
          done.push(id);
        }
        if (done.length > 0) clearRoutineUnsynced(done);

        setSync({
          status: 'idle',
          pending: loadRoutinesUnsynced().length,
          lastSyncedAt: Date.now(),
          lastError: null,
        });
      } catch (e) {
        log.warn('babySleep.routine.sync.failed', describeError(e));
        setSync((s) => ({
          ...s,
          status: 'error',
          pending: loadRoutinesUnsynced().length,
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
     * `owner.resolved` is as much of a precondition as being signed in. A failed share lookup looks
     * exactly like having no share, and guessing wrong sends the household's nights into a subtree
     * nobody reads. Staying off is the safe answer; the log keeps working locally either way.
     */
    if (!user || !owner.resolved || !owner.dataUid) {
      uidRef.current = null;
      pulledRef.current = false;
      setSync({
        status: 'off',
        pending: loadRoutinesUnsynced().length,
        lastSyncedAt: null,
        lastError: null,
      });
      return;
    }

    // `adoptOwner` clears every per-owner cache, this one included, so it may have emptied the store
    // out from under the state we are holding.
    if (adoptOwner(owner.dataUid)) {
      log.info('babySleep.routine.cache.reset', { dataUid: owner.dataUid });
      publish(loadRoutines());
    }

    uidRef.current = owner.dataUid;
    pulledRef.current = false;
    void runSync(true);
  }, [user, ready, runSync, publish, owner.resolved, owner.dataUid]);

  useEffect(() => {
    // A reconnect is the other moment worth reading the whole collection.
    const onOnline = () => void runSync(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSync]);

  const retrySync = useCallback(() => void runSync(true), [runSync]);

  const nightByDay = useMemo(() => nightRoutinesByDay(records), [records]);
  const napsByDay = useMemo(() => napRoutinesByDay(records), [records]);
  const byDay = useMemo(() => routinesByDay(records), [records]);

  return {
    ready,
    records,
    nightByDay,
    napsByDay,
    byDay,
    sync,
    logRoutine,
    clearRoutine,
    retrySync,
  };
}
