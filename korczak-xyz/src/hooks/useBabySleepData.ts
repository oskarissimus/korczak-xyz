/*
 * The baby sleep log's state, and its cloud sync.
 *
 * Structurally this follows `useFretboardData`: non-React state in refs beside a `publish` that
 * writes the ref and calls `setState` together, a single-flight `runSync` guarded by refs, and
 * localStorage as the always-available store with Firestore layered on when someone is signed in.
 *
 * It differs from the fretboard trainer's hook in one deliberate way, and the reason belongs here so
 * a later reader does not "fix" it back. **This pulls before it pushes.** The fretboard trainer
 * pushes first, and it may: its documents are immutable sittings, so a blind write cannot destroy
 * anything. These documents are mutable — an entry can be corrected or deleted — so pushing first
 * would `setDoc` over a newer edit made on another device that this one has not seen yet. Pulling
 * first, merging, and pushing only what won the merge means the two devices converge on the same
 * answer without a transaction.
 *
 * A full pull happens once per page load and on every reconnect. Syncs triggered by a mutation are
 * push-only, because reading the whole collection after every tap would be absurd — see `cloud.ts`
 * for why there is no cheaper incremental read.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullEntries, pushEntry } from '../utils/babySleep/cloud';
import { mergeEntries, resolveOpen, visibleEntries } from '../utils/babySleep/merge';
import {
  adoptOwner,
  clearUnsynced,
  loadEntries,
  loadUnsynced,
  markUnsynced,
  saveEntries,
} from '../utils/babySleep/storage';
import type { EntryDraft, SleepEntry, SleepKind, SyncState } from '../utils/babySleep/types';
import { editEntry, newEntry, tombstone } from '../utils/babySleep/types';
import type { AuthUser } from './useAuth';
import type { DataOwner } from './useDataOwner';

export interface BabySleepData {
  ready: boolean;
  /** Live entries, newest first. Tombstones never leave this hook. */
  entries: SleepEntry[];
  /** The sleep currently running, if any. Derived — never separate state. */
  open: SleepEntry | null;
  /** Other still-running entries, from a device that never closed one. */
  orphans: SleepEntry[];
  sync: SyncState;
  startSleep: (kind: SleepKind, at?: number) => void;
  endSleep: (at?: number) => void;
  addEntry: (draft: EntryDraft) => void;
  updateEntry: (id: string, patch: Partial<EntryDraft>) => void;
  removeEntry: (id: string) => void;
  retrySync: () => void;
}

const IDLE_SYNC: SyncState = { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };

/**
 * `owner` decides which subtree is read and written — see `useDataOwner`. It is a parameter rather
 * than something resolved in here because the Share tab needs the same answer without wanting a log,
 * and because the two are separately testable that way.
 */
export function useBabySleepData(user: AuthUser | null, owner: DataOwner): BabySleepData {
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>(IDLE_SYNC);

  // All entries, tombstones included — the merge needs them, the UI must not see them.
  const entriesRef = useRef<SleepEntry[]>([]);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  /** Whether this page load has read the whole collection yet. */
  const pulledRef = useRef(false);

  const publish = useCallback((next: SleepEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  /*
   * Who is logging, for `authorEmail`. Read through a ref so the mutation callbacks do not have to
   * take the user as a dependency — they are handed to `onClick` and re-creating them on every auth
   * tick would remount nothing useful.
   */
  const authorRef = useRef<string | undefined>(undefined);
  authorRef.current = user?.email ?? undefined;

  // --- load -------------------------------------------------------------------------------------

  useEffect(() => {
    publish(loadEntries());
    readyRef.current = true;
    setReady(true);
    setSync((s) => ({ ...s, pending: loadUnsynced().length }));
  }, [publish]);

  // --- writing ----------------------------------------------------------------------------------

  /**
   * Commit changed entries locally, then try to send them.
   *
   * The write is synchronous and happens before any await, so an entry survives the tab being closed
   * the instant after the button was tapped — there is no "current sleep" scratch key to recover
   * from, because the entry itself is already the durable record.
   */
  const commit = useCallback(
    (changed: SleepEntry[]) => {
      if (changed.length === 0) return;
      const merged = mergeEntries(entriesRef.current, changed);
      publish(merged.entries);
      saveEntries(merged.entries);
      markUnsynced(changed.map((e) => e.id));
      setSync((s) => ({ ...s, pending: loadUnsynced().length }));
      void runSyncRef.current?.();
    },
    [publish]
  );

  /*
   * `startSleep` and `endSleep` are the natural things to hand straight to an `onClick`, and React
   * would then pass a click event as the optional instant. Storing that is not a type error at
   * runtime — it is a DOM node in the entry, a circular structure that breaks the `JSON.stringify`
   * on the way to localStorage and leaves the sleep un-closable until a reload throws the record
   * away. So the instant is checked rather than trusted, and callers still wrap.
   */
  const instantOr = (at: number | undefined, now: number) =>
    typeof at === 'number' && Number.isFinite(at) ? at : now;

  const startSleep = useCallback(
    (kind: SleepKind, at?: number) => {
      const now = Date.now();
      // Starting a sleep while one is running closes nothing implicitly — the UI does not offer it,
      // and inventing a wake time for the previous entry would fabricate data.
      commit([newEntry({ kind, start: instantOr(at, now), end: null }, now, authorRef.current)]);
    },
    [commit]
  );

  const endSleep = useCallback(
    (at?: number) => {
      const now = Date.now();
      const { open } = resolveOpen(entriesRef.current, now);
      if (!open) return;
      commit([editEntry(open, { end: instantOr(at, now) }, now)]);
    },
    [commit]
  );

  const addEntry = useCallback(
    (draft: EntryDraft) => {
      commit([newEntry(draft, Date.now(), authorRef.current)]);
    },
    [commit]
  );

  const updateEntry = useCallback(
    (id: string, patch: Partial<EntryDraft>) => {
      const prev = entriesRef.current.find((e) => e.id === id);
      if (!prev || prev.deleted) return;
      commit([editEntry(prev, patch, Date.now())]);
    },
    [commit]
  );

  const removeEntry = useCallback(
    (id: string) => {
      const prev = entriesRef.current.find((e) => e.id === id);
      if (!prev || prev.deleted) return;
      commit([tombstone(prev, Date.now())]);
    },
    [commit]
  );

  // --- sync -------------------------------------------------------------------------------------

  /**
   * `commit` needs to kick off a sync and `runSync` needs to be defined in terms of `commit`'s
   * effects, so the two are tied together through a ref rather than a dependency cycle.
   */
  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  const runSync = useCallback(
    async (full = false) => {
      const uid = uidRef.current;
      if (!uid || syncingRef.current || !readyRef.current) return;
      syncingRef.current = true;
      setSync((s) => ({ ...s, status: 'syncing' }));

      try {
        // Pull and merge before pushing, so a blind write cannot land on top of an edit made
        // elsewhere. See the module comment.
        const toPush = new Set(loadUnsynced());
        if (full || !pulledRef.current) {
          const pull = await pullEntries(uid);
          const merged = mergeEntries(entriesRef.current, pull.entries);
          if (merged.changed) {
            publish(merged.entries);
            saveEntries(merged.entries);
            log.info('babySleep.sync.merged', { entries: merged.entries.length });
          }
          // Anything the cloud lacks, or holds an older version of, needs sending — whether or not
          // this device remembered to queue it.
          for (const id of merged.localWins) toPush.add(id);
          pulledRef.current = true;
        }

        const done: string[] = [];
        for (const id of toPush) {
          const entry = entriesRef.current.find((e) => e.id === id);
          if (!entry) {
            done.push(id); // pruned out of the local store; nothing left to send
            continue;
          }
          await pushEntry(uid, entry);
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
        log.warn('babySleep.sync.failed', describeError(e));
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
    [publish]
  );

  runSyncRef.current = runSync;

  useEffect(() => {
    /*
     * `owner.resolved` is as much of a precondition as being signed in. An unresolved owner is not
     * "probably me" — a failed share lookup looks exactly like having no share, and guessing wrong
     * sends the household's entries into a subtree nobody reads. Staying off is the safe answer;
     * the log keeps working locally either way.
     */
    if (!user || !owner.resolved || !owner.dataUid) {
      uidRef.current = null;
      pulledRef.current = false;
      setSync({ status: 'off', pending: loadUnsynced().length, lastSyncedAt: null, lastError: null });
      return;
    }

    // The cache is one key for the whole origin, so it may be holding the log of whoever was signed
    // in last. Discarding it is not a loss: everything in it is either already in the cloud or, if
    // it never got there, belongs to an account this browser can still sign back into.
    if (adoptOwner(owner.dataUid)) {
      log.info('babySleep.cache.reset', { dataUid: owner.dataUid });
      publish(loadEntries());
    }

    uidRef.current = owner.dataUid;
    pulledRef.current = false;
    void runSync(true);
  }, [user, ready, runSync, publish, owner.resolved, owner.dataUid]);

  useEffect(() => {
    // A reconnect is the other moment worth reading the whole collection: whatever the other device
    // did while this one was offline arrives now.
    const onOnline = () => void runSync(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSync]);

  const retrySync = useCallback(() => void runSync(true), [runSync]);

  // --- derived ----------------------------------------------------------------------------------

  const visible = useMemo(() => visibleEntries(entries), [entries]);
  /*
   * Which entry is open depends only on the entries, so it is memoised on them. Whether that entry
   * has run *too long* depends on the clock, and is therefore deliberately not returned from here:
   * a value computed once per entry change would never flip while the page sat open, which is
   * exactly the case it exists to catch. `LiveControls` asks `isStale` against its own ticking now.
   */
  const resolution = useMemo(() => resolveOpen(entries, Date.now()), [entries]);

  return {
    ready,
    entries: visible,
    open: resolution.open,
    orphans: resolution.orphans,
    sync,
    startSleep,
    endSleep,
    addEntry,
    updateEntry,
    removeEntry,
    retrySync,
  };
}
