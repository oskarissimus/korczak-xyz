/*
 * The watched legs of the journey, and their cloud sync.
 *
 * Structurally `useEventInterests`, down to the reasoning: refs beside a `publish` that writes the
 * ref and calls `setState` together, a `commit` that is synchronous before any await, and a
 * single-flight `runSync` that **pulls before it pushes** — because a leg is a mutable document and
 * a blind `setDoc` from the phone would land on top of an edit made on the laptop.
 *
 * The reconciler is the sleep log's, unchanged: `WatchedSegment` extends `Versioned` structurally,
 * so `mergeById` merges these without being told anything about them, and `applyLocal` is what
 * stops a re-added leg from meeting its own tombstone.
 *
 * One thing this hook has that the interests hook does not: `addSegment` and `updateSegment` can
 * **fail**, and return `false` when they do. A leg whose two stations are not both on one line is
 * not a journey, and `normalizeSegment` refuses it rather than storing a row that would match
 * nothing forever. The form needs to hear that, which is why these are not `void`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getClientId, uuid } from '../lib/clientId';
import { describeError, log } from '../lib/logger';
import {
  adoptOwner,
  clearUnsynced,
  loadSegments,
  loadUnsynced,
  markUnsynced,
  saveSegments,
  TRANSIT_KEYS,
} from '../utils/transit/browser/storage';
import { pullSegments, pushSegment } from '../utils/transit/browser/cloud';
import {
  newSegment,
  reviseSegment,
  tombstoneSegment,
  withMissingSeeds,
  type SegmentDraft,
} from '../utils/transit/segments';
import type { WatchedSegment } from '../utils/transit/types';
import { applyLocal, mergeById, sameRevision } from '../utils/babySleep/versioned';
import type { SyncState } from '../utils/flashcards/sync';
import type { AuthUser } from './useAuth';

export interface TransitSegmentsData {
  ready: boolean;
  /** Live legs, tombstones filtered out. */
  segments: WatchedSegment[];
  sync: SyncState;
  /** False when the draft's two stations are not both on that line. Nothing is written. */
  addSegment: (draft: SegmentDraft) => boolean;
  updateSegment: (id: string, draft: SegmentDraft) => boolean;
  setMuted: (id: string, muted: boolean) => void;
  removeSegment: (id: string) => void;
  retrySync: () => void;
}

const QUEUE = TRANSIT_KEYS.unsynced;

/** Oldest first, id as the deterministic tiebreak so two devices order identically. */
function byCreated(a: WatchedSegment, b: WatchedSegment): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/**
 * Whether two copies are the same version.
 *
 * The version fields alone would do for a well-behaved writer; comparing the endpoints too catches
 * two devices reaching the same `rev` independently, which `pickVersioned` then arbitrates rather
 * than mistaking for agreement.
 */
function isSameVersion(a: WatchedSegment, b: WatchedSegment): boolean {
  return sameRevision(a, b) && a.label === b.label && a.from === b.from && a.to === b.to;
}

export function useTransitSegments(user: AuthUser | null): TransitSegmentsData {
  const [records, setRecords] = useState<WatchedSegment[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>({
    status: 'off',
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
  });

  // Everything, tombstones included — the merge needs them, the UI must not see them.
  const recordsRef = useRef<WatchedSegment[]>([]);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  const pulledRef = useRef(false);
  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  const publish = useCallback((next: WatchedSegment[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  // --- load -------------------------------------------------------------------------------------

  useEffect(() => {
    /*
     * Seeding happens here, on the local copy, before any sync — so the two legs of the way home
     * are on screen immediately rather than after a round trip, and a device that never reaches the
     * network still has something to edit.
     */
    const stored = loadSegments();
    const seeded = withMissingSeeds(stored, getClientId(), Date.now());
    if (seeded !== stored) {
      saveSegments(seeded);
      markUnsynced(
        QUEUE,
        seeded.filter((s) => !stored.some((p) => p.id === s.id)).map((s) => s.id),
      );
    }
    publish(seeded);
    readyRef.current = true;
    setReady(true);
  }, [publish]);

  // --- writes -----------------------------------------------------------------------------------

  const commit = useCallback(
    (changed: WatchedSegment[]) => {
      if (changed.length === 0) return;
      const next = applyLocal(recordsRef.current, changed, byCreated);
      publish(next);
      saveSegments(next);
      markUnsynced(QUEUE, changed.map((s) => s.id));
      setSync((s) => ({ ...s, pending: loadUnsynced(QUEUE).length }));
      void runSyncRef.current?.();
    },
    [publish],
  );

  const addSegment = useCallback(
    (draft: SegmentDraft): boolean => {
      const record = newSegment(draft, uuid(), getClientId(), Date.now());
      if (!record) return false;
      commit([record]);
      return true;
    },
    [commit],
  );

  const updateSegment = useCallback(
    (id: string, draft: SegmentDraft): boolean => {
      const existing = recordsRef.current.find((s) => s.id === id);
      if (!existing) return false;
      const record = reviseSegment(existing, draft, getClientId(), Date.now());
      if (!record) return false;
      commit([record]);
      return true;
    },
    [commit],
  );

  const setMuted = useCallback(
    (id: string, muted: boolean) => {
      const existing = recordsRef.current.find((s) => s.id === id);
      if (!existing) return;
      const record = reviseSegment(existing, { ...existing, muted }, getClientId(), Date.now());
      if (record) commit([record]);
    },
    [commit],
  );

  const removeSegment = useCallback(
    (id: string) => {
      const existing = recordsRef.current.find((s) => s.id === id);
      if (!existing || existing.deleted) return;
      commit([tombstoneSegment(existing, getClientId(), Date.now())]);
    },
    [commit],
  );

  // --- sync -------------------------------------------------------------------------------------

  const runSync = useCallback(
    async (full = false) => {
      const uid = uidRef.current;
      if (!uid || syncingRef.current || !readyRef.current) return;
      syncingRef.current = true;
      setSync((s) => ({ ...s, status: 'syncing' }));

      try {
        const toPush = new Set(loadUnsynced(QUEUE));
        if (full || !pulledRef.current) {
          const remote = await pullSegments(uid);
          const merged = mergeById(recordsRef.current, remote, isSameVersion, byCreated);
          if (merged.changed) {
            publish(merged.records);
            saveSegments(merged.records);
            log.info('transit.segments.sync.merged', { records: merged.records.length });
          }
          // Anything the cloud lacks, or holds an older version of, needs sending — whether or not
          // this device remembered to queue it.
          for (const id of merged.localWins) toPush.add(id);
          pulledRef.current = true;
        }

        const done: string[] = [];
        for (const id of toPush) {
          const record = recordsRef.current.find((s) => s.id === id);
          if (!record) {
            done.push(id);
            continue;
          }
          await pushSegment(uid, record);
          done.push(id);
        }
        if (done.length > 0) clearUnsynced(QUEUE, done);

        setSync({
          status: 'idle',
          pending: loadUnsynced(QUEUE).length,
          lastSyncedAt: Date.now(),
          lastError: null,
        });
      } catch (e) {
        log.warn('transit.segments.sync.failed', describeError(e));
        setSync((s) => ({
          ...s,
          status: 'error',
          pending: loadUnsynced(QUEUE).length,
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
      setSync({ status: 'off', pending: loadUnsynced(QUEUE).length, lastSyncedAt: null, lastError: null });
      return;
    }

    // Clears every per-account cache on a switch, so it may have emptied the store out from under
    // the state we are holding.
    if (adoptOwner(user.uid)) {
      log.info('transit.cache.reset', { uid: user.uid });
      publish(withMissingSeeds(loadSegments(), getClientId(), Date.now()));
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

  const segments = useMemo(() => records.filter((s) => !s.deleted).sort(byCreated), [records]);

  return { ready, segments, sync, addSegment, updateSegment, setMuted, removeSegment, retrySync };
}
