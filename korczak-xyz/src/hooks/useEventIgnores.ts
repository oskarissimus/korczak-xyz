/*
 * The events dismissed by hand, and their cloud sync.
 *
 * `useEventInterests` without the seeding. Same shape for the same reasons — refs beside a
 * `publish` that writes the ref and calls `setState` together, a `commit` that is synchronous
 * before any await, a single-flight `runSync` that **pulls before it pushes** — and the pull-first
 * rule matters more here than there: an ignore is a two-state row whose id is derived from the
 * event, so the phone and the laptop write the *same document* when they dismiss the same card,
 * and a blind `setDoc` would put a stale `rev` on top of the other device's un-ignore.
 *
 * Tombstones never leave `records`. `ignoredFingerprints` is what the app asks, and it is the only
 * place the deleted flag is read — see its header.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getClientId } from '../lib/clientId';
import { describeError, log } from '../lib/logger';
import {
  adoptOwner,
  EVENT_KEYS,
  clearUnsynced,
  loadIgnores,
  loadUnsynced,
  markUnsynced,
  saveIgnores,
} from '../utils/events/browser/storage';
import { pullIgnores, pushIgnore } from '../utils/events/browser/cloud';
import { ignoreEvent, ignoreIdFor, ignoredFingerprints, liftIgnore } from '../utils/events/ignores';
import type { EventRecord, Ignore } from '../utils/events/types';
import { applyLocal, mergeById, sameRevision } from '../utils/babySleep/versioned';
import type { SyncState } from '../utils/flashcards/sync';
import type { AuthUser } from './useAuth';

export interface EventIgnoresData {
  ready: boolean;
  /** Every stored row, tombstones included. The UI wants `fingerprints`, not this. */
  ignores: Ignore[];
  /** What is currently hidden. Live rows only. */
  fingerprints: ReadonlySet<string>;
  sync: SyncState;
  ignore: (event: Pick<EventRecord, 'fingerprint' | 'title'>) => void;
  unignore: (fingerprint: string) => void;
  retrySync: () => void;
}

const OFF: SyncState = { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };

/** Which push queue is this hook's. Not the interests'; see the note in `storage.ts`. */
const QUEUE = EVENT_KEYS.ignoresUnsynced;

/** By id. Arbitrary but *total*, which is all `mergeById` asks — an order that ties is not commutative. */
function byId(a: Ignore, b: Ignore): number {
  return a.id.localeCompare(b.id);
}

/**
 * Whether two copies are the same version.
 *
 * The version fields are the whole of it here, unlike the interests' extra label check: an ignore
 * has no payload two devices could reach independently — the fingerprint is fixed by the id, and
 * the title is denormalised rather than edited.
 */
function isSameVersion(a: Ignore, b: Ignore): boolean {
  return sameRevision(a, b);
}

export function useEventIgnores(user: AuthUser | null): EventIgnoresData {
  const [records, setRecords] = useState<Ignore[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>(OFF);

  const recordsRef = useRef<Ignore[]>([]);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  const pulledRef = useRef(false);

  const publish = useCallback((next: Ignore[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  // --- load ------------------------------------------------------------------------------------

  useEffect(() => {
    publish(loadIgnores());
    readyRef.current = true;
    setReady(true);
    setSync((s) => ({ ...s, pending: loadUnsynced(QUEUE).length }));
  }, [publish]);

  // --- writing ---------------------------------------------------------------------------------

  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  /**
   * Apply locally, then try to send. Synchronous before any await, so a dismissal survives the tab
   * being closed the instant after it.
   *
   * `applyLocal`, not `mergeById`: this is the human at the card, and there is nobody to arbitrate
   * with. Routing it through the reconciler would let the row's own tombstone absorb it — and with
   * a *derived* id that is not the theoretical case it is for the `uuid()`-keyed collections. It is
   * the ordinary one: ignore, un-ignore, ignore again is three writes to one document.
   */
  const commit = useCallback(
    (changed: Ignore[]) => {
      if (changed.length === 0) return;
      const next = applyLocal(recordsRef.current, changed, byId);
      publish(next);
      saveIgnores(next);
      markUnsynced(QUEUE, changed.map((i) => i.id));
      setSync((s) => ({ ...s, pending: loadUnsynced(QUEUE).length }));
      void runSyncRef.current?.();
    },
    [publish],
  );

  const ignore = useCallback(
    (event: Pick<EventRecord, 'fingerprint' | 'title'>) => {
      // The existing row, tombstone included — `ignoreEvent` needs it to move `rev` past its own
      // delete, which is what makes re-ignoring after an un-ignore stick.
      const existing = recordsRef.current.find((i) => i.id === ignoreIdFor(event.fingerprint));
      commit([ignoreEvent(event, existing, { writerId: getClientId(), now: Date.now() })]);
    },
    [commit],
  );

  const unignore = useCallback(
    (fingerprint: string) => {
      const existing = recordsRef.current.find((i) => i.id === ignoreIdFor(fingerprint));
      if (!existing || existing.deleted) return;
      commit([liftIgnore(existing, { writerId: getClientId(), now: Date.now() })]);
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
        const toPush = new Set(loadUnsynced(QUEUE));
        if (full || !pulledRef.current) {
          const remote = await pullIgnores(uid);
          const merged = mergeById(recordsRef.current, remote, isSameVersion, byId);
          if (merged.changed) {
            publish(merged.records);
            saveIgnores(merged.records);
            log.info('events.ignores.sync.merged', { records: merged.records.length });
          }
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
          await pushIgnore(uid, record);
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
        log.warn('events.ignores.sync.failed', describeError(e));
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
      setSync({
        status: 'off',
        pending: loadUnsynced(QUEUE).length,
        lastSyncedAt: null,
        lastError: null,
      });
      return;
    }

    // Memoised for the page load, so only the first island to call it observes a switch — but it
    // may have emptied this store out from under the state we are holding.
    if (adoptOwner(user.uid)) publish(loadIgnores());

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

  const fingerprints = useMemo(() => ignoredFingerprints(records), [records]);

  return { ready, ignores: records, fingerprints, sync, ignore, unignore, retrySync };
}
