/*
 * The night-climate log's state, and its cloud sync.
 *
 * Structurally this is `useBabySleepData` — refs beside a `publish` that writes the ref and calls
 * `setState` together, a single-flight `runSync`, localStorage as the always-available store with
 * Firestore layered on when someone is signed in — and it **pulls before it pushes** for the same
 * reason: these documents are mutable, so a blind `setDoc` would land on top of a correction made on
 * the other parent's phone. Pulling first, merging, and pushing only what won the merge means the
 * two devices converge without a transaction.
 *
 * It is a separate hook rather than a mode of that one because the two collections are separate by
 * construction: different documents, different push queue, different Firestore path. What they
 * genuinely share is the reconciler, and that is `versioned.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import type {
  ClimateRecord,
  EveningDraft,
  NightVerdict,
} from '../utils/babySleep/climate';
import { setEvening, setVerdict, tombstoneClimate } from '../utils/babySleep/climate';
import { pullClimate, pushClimate } from '../utils/babySleep/climateCloud';
import {
  clearClimateUnsynced,
  loadClimate,
  loadClimateUnsynced,
  markClimateUnsynced,
  saveClimate,
} from '../utils/babySleep/climateStorage';
import type { NightObservation } from '../utils/babySleep/climateStats';
import {
  applyLocalClimate,
  groupByNight,
  mergeClimate,
  recordsFor,
} from '../utils/babySleep/climateStats';
import { adoptOwner } from '../utils/babySleep/storage';
import type { SyncState } from '../utils/babySleep/types';
import type { AuthUser } from './useAuth';
import type { DataOwner } from './useDataOwner';

export interface NightClimateData {
  ready: boolean;
  /** One row per night, both halves joined, newest first. */
  nights: NightObservation[];
  sync: SyncState;
  /** Write (or correct) the evening half of a night. */
  logEvening: (night: string, draft: EveningDraft) => void;
  /** Write (or clear, with null) the morning half. */
  logVerdict: (night: string, verdict: NightVerdict | null) => void;
  /** Tombstone both halves of a night. */
  clearNight: (night: string) => void;
  retrySync: () => void;
}

const IDLE_SYNC: SyncState = { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };

export function useNightClimate(user: AuthUser | null, owner: DataOwner): NightClimateData {
  const [records, setRecords] = useState<ClimateRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>(IDLE_SYNC);

  // All records, tombstones included — the merge needs them, the UI must not see them.
  const recordsRef = useRef<ClimateRecord[]>([]);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  /** Whether this page load has read the whole collection yet. */
  const pulledRef = useRef(false);

  const publish = useCallback((next: ClimateRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  // Who is logging, for `authorEmail`. Through a ref so the mutation callbacks do not take the user
  // as a dependency and get re-created on every auth tick.
  const authorRef = useRef<string | undefined>(undefined);
  authorRef.current = user?.email ?? undefined;

  // --- load -------------------------------------------------------------------------------------

  useEffect(() => {
    publish(loadClimate());
    readyRef.current = true;
    setReady(true);
    setSync((s) => ({ ...s, pending: loadClimateUnsynced().length }));
  }, [publish]);

  // --- writing ----------------------------------------------------------------------------------

  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  /**
   * Commit changed records locally, then try to send them. Synchronous before any await, so a tap
   * survives the tab being closed the instant after it.
   */
  const commit = useCallback(
    (changed: ClimateRecord[]) => {
      if (changed.length === 0) return;
      const next = applyLocalClimate(recordsRef.current, changed);
      publish(next);
      saveClimate(next);
      markClimateUnsynced(changed.map((r) => r.id));
      setSync((s) => ({ ...s, pending: loadClimateUnsynced().length }));
      void runSyncRef.current?.();
    },
    [publish]
  );

  const logEvening = useCallback(
    (night: string, draft: EveningDraft) => {
      const { eve } = recordsFor(recordsRef.current, night);
      commit([setEvening(night, draft, Date.now(), eve, authorRef.current)]);
    },
    [commit]
  );

  const logVerdict = useCallback(
    (night: string, verdict: NightVerdict | null) => {
      const { am } = recordsFor(recordsRef.current, night);
      commit([setVerdict(night, verdict, Date.now(), am, authorRef.current)]);
    },
    [commit]
  );

  /*
   * Both halves go through one `commit`, so they are merged, saved and queued in a single step —
   * and a tab dying between two calls cannot leave half a night deleted on one device and whole on
   * another. A half that was never written has nothing to tombstone and is skipped.
   */
  const clearNight = useCallback(
    (night: string) => {
      const now = Date.now();
      const { eve, am } = recordsFor(recordsRef.current, night);
      const gone = [eve, am]
        .filter((r): r is ClimateRecord => r != null && !r.deleted)
        .map((r) => tombstoneClimate(r, now));
      commit(gone);
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
        const toPush = new Set(loadClimateUnsynced());
        if (full || !pulledRef.current) {
          const pull = await pullClimate(uid);
          const merged = mergeClimate(recordsRef.current, pull.records);
          if (merged.changed) {
            publish(merged.records);
            saveClimate(merged.records);
            log.info('babySleep.climate.sync.merged', { records: merged.records.length });
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
          await pushClimate(uid, record);
          done.push(id);
        }
        if (done.length > 0) clearClimateUnsynced(done);

        setSync({
          status: 'idle',
          pending: loadClimateUnsynced().length,
          lastSyncedAt: Date.now(),
          lastError: null,
        });
      } catch (e) {
        log.warn('babySleep.climate.sync.failed', describeError(e));
        setSync((s) => ({
          ...s,
          status: 'error',
          pending: loadClimateUnsynced().length,
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
        pending: loadClimateUnsynced().length,
        lastSyncedAt: null,
        lastError: null,
      });
      return;
    }

    // `adoptOwner` clears every per-owner cache, this one included, so it may have emptied the store
    // out from under the state we are holding.
    if (adoptOwner(owner.dataUid)) {
      log.info('babySleep.climate.cache.reset', { dataUid: owner.dataUid });
      publish(loadClimate());
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

  const nights = useMemo(() => groupByNight(records), [records]);

  return { ready, nights, sync, logEvening, logVerdict, clearNight, retrySync };
}
