/*
 * The shopping list's state, and its cloud sync.
 *
 * Structurally this is `useNightClimate` — refs beside a `publish` that writes the ref and calls
 * `setState` together, a single-flight `runSync`, localStorage as the always-available store with
 * Firestore layered on when someone is signed in — and it **pulls before it pushes** for the same
 * reason: these documents are mutable, so a blind `setDoc` would land on top of a tick made on the
 * other phone, in the shop, thirty seconds ago. Pulling first, merging, and pushing only what won
 * the merge means the two devices converge without a transaction.
 *
 * Local storage is the primary store and the cloud is a layer on it, which is the arrangement that
 * makes this usable at all: supermarket basements have no signal, and a list that needs a network to
 * tick something off is a list you stop using. Every write lands locally and synchronously before
 * anything is attempted over the wire.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import type { SyncState } from '../utils/flashcards/sync';
import type { ItemDraft, ShoppingItem } from '../utils/shopping/item';
import { editItem, newItem, readd, setDone, tombstoneItem } from '../utils/shopping/item';
import { pullItems, pushItem } from '../utils/shopping/cloud';
import type { ListView } from '../utils/shopping/list';
import { applyLocalItems, findByName, mergeItems, splitList, suggest } from '../utils/shopping/list';
import {
  adoptOwner,
  clearUnsynced,
  loadItems,
  loadUnsynced,
  markUnsynced,
  saveItems,
} from '../utils/shopping/storage';
import type { AuthUser } from './useAuth';
import type { DataOwner } from './useDataOwner';

/**
 * What adding a name did, so the screen can say so.
 *
 * `already` is the one worth distinguishing: nothing was written, and without a word the tap reads
 * as a lost keystroke — you typed "milk", the box emptied, and no new row appeared, because the row
 * was there all along four lines up.
 */
export type AddOutcome = 'added' | 'readded' | 'already' | 'empty';

export interface ShoppingListData {
  ready: boolean;
  list: ListView;
  /** Names bought before and not on the list now, most-bought first. */
  suggestions: string[];
  sync: SyncState;
  /** Put a line on the list, or revive the one that is already there. */
  add: (draft: ItemDraft) => AddOutcome;
  toggle: (id: string) => void;
  rename: (id: string, draft: ItemDraft) => void;
  remove: (id: string) => void;
  /** Tombstone everything in the basket, in one write. */
  clearDone: () => void;
  retrySync: () => void;
}

const IDLE_SYNC: SyncState = { status: 'off', pending: 0, lastSyncedAt: null, lastError: null };

export function useShoppingList(user: AuthUser | null, owner: DataOwner): ShoppingListData {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>(IDLE_SYNC);

  // All records, tombstones included — the merge needs them and `suggest` reads them; the list
  // itself must not see them.
  const itemsRef = useRef<ShoppingItem[]>([]);
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  /** Whether this page load has read the whole collection yet. */
  const pulledRef = useRef(false);

  const publish = useCallback((next: ShoppingItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  // Who is adding, for `authorEmail`. Through a ref so the mutation callbacks do not take the user
  // as a dependency and get re-created on every auth tick.
  const authorRef = useRef<string | undefined>(undefined);
  authorRef.current = user?.email ?? undefined;

  // --- load ---------------------------------------------------------------------------------

  useEffect(() => {
    publish(loadItems());
    readyRef.current = true;
    setReady(true);
    setSync((s) => ({ ...s, pending: loadUnsynced().length }));
  }, [publish]);

  // --- writing ------------------------------------------------------------------------------

  const runSyncRef = useRef<((full?: boolean) => Promise<void>) | null>(null);

  /**
   * Commit changed lines locally, then try to send them. Synchronous before any await, so a tap
   * survives the phone being pocketed the instant after it.
   */
  const commit = useCallback(
    (changed: ShoppingItem[]) => {
      if (changed.length === 0) return;
      const next = applyLocalItems(itemsRef.current, changed);
      publish(next);
      saveItems(next);
      markUnsynced(changed.map((i) => i.id));
      setSync((s) => ({ ...s, pending: loadUnsynced().length }));
      void runSyncRef.current?.();
    },
    [publish]
  );

  /*
   * Adding is where the one rule that is not the sleep log's lives: a name the list already carries
   * revives that line instead of writing a second one. See `item.ts` — the ids are minted rather
   * than derived, so nothing else makes two phones agree that "milk" is one thing, and a list that
   * grows a second "milk" every time somebody is reminded of it is a list nobody trusts.
   */
  const add = useCallback(
    (draft: ItemDraft): AddOutcome => {
      const now = Date.now();
      const item = newItem(draft, now, authorRef.current);
      if (item.name === '') return 'empty';

      const existing = findByName(itemsRef.current, draft.name);
      if (existing && !existing.deleted && !existing.done) {
        // Already waiting to be bought. Nothing to write — except that the note may be new.
        if (item.note && item.note !== existing.note) {
          commit([editItem(existing, { note: item.note }, now)]);
        }
        return 'already';
      }
      if (existing) {
        commit([readd(existing, draft, now)]);
        return 'readded';
      }
      commit([item]);
      return 'added';
    },
    [commit]
  );

  const toggle = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item || item.deleted) return;
      commit([setDone(item, !item.done, Date.now())]);
    },
    [commit]
  );

  const rename = useCallback(
    (id: string, draft: ItemDraft) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item || item.deleted) return;
      commit([editItem(item, draft, Date.now())]);
    },
    [commit]
  );

  const remove = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item || item.deleted) return;
      commit([tombstoneItem(item, Date.now())]);
    },
    [commit]
  );

  /*
   * One `commit` for the whole basket rather than a loop of them, so the tab dying halfway cannot
   * leave the list half cleared on this phone and whole on the other.
   */
  const clearDone = useCallback(() => {
    const now = Date.now();
    const gone = itemsRef.current
      .filter((i) => !i.deleted && i.done)
      .map((i) => tombstoneItem(i, now));
    commit(gone);
  }, [commit]);

  // --- sync ---------------------------------------------------------------------------------

  const runSync = useCallback(
    async (full = false) => {
      const uid = uidRef.current;
      if (!uid || syncingRef.current || !readyRef.current) return;
      syncingRef.current = true;
      setSync((s) => ({ ...s, status: 'syncing' }));

      try {
        const toPush = new Set(loadUnsynced());
        if (full || !pulledRef.current) {
          const pull = await pullItems(uid);
          const merged = mergeItems(itemsRef.current, pull.items);
          if (merged.changed) {
            publish(merged.items);
            saveItems(merged.items);
            log.info('shopping.sync.merged', { items: merged.items.length });
          }
          // Anything the cloud lacks, or holds an older version of, needs sending — whether or not
          // this device remembered to queue it.
          for (const id of merged.localWins) toPush.add(id);
          pulledRef.current = true;
        }

        const done: string[] = [];
        for (const id of toPush) {
          const item = itemsRef.current.find((i) => i.id === id);
          if (!item) {
            done.push(id);
            continue;
          }
          await pushItem(uid, item);
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
        log.warn('shopping.sync.failed', describeError(e));
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
     * `owner.resolved` is as much of a precondition as being signed in. A failed share lookup looks
     * exactly like having no share, and guessing wrong sends the household's list into a subtree
     * nobody reads. Staying off is the safe answer; the list keeps working locally either way.
     */
    if (!user || !owner.resolved || !owner.dataUid) {
      uidRef.current = null;
      pulledRef.current = false;
      setSync({
        status: 'off',
        pending: loadUnsynced().length,
        lastSyncedAt: null,
        lastError: null,
      });
      return;
    }

    // A different account on this browser is a different list: the cache was discarded, so the
    // state held here is stale and has to be re-read rather than merged into the new account.
    if (adoptOwner(owner.dataUid)) {
      log.info('shopping.cache.reset', { dataUid: owner.dataUid });
      publish(loadItems());
    }

    uidRef.current = owner.dataUid;
    pulledRef.current = false;
    void runSync(true);
  }, [user, ready, runSync, publish, owner.resolved, owner.dataUid]);

  useEffect(() => {
    /*
     * A reconnect is the moment this app exists for: the whole shop happened offline in a basement,
     * and everything ticked down there has to reach the other phone the moment there is a bar of
     * signal — without anyone remembering to open the tab again.
     */
    const onOnline = () => void runSync(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSync]);

  useEffect(() => {
    /*
     * And so is coming back to the tab. Two people in one shop diverge in seconds, so the list is
     * re-read whenever the phone is unlocked on it rather than only when something is tapped.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runSync(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [runSync]);

  const retrySync = useCallback(() => void runSync(true), [runSync]);

  const list = useMemo(() => splitList(items), [items]);
  const suggestions = useMemo(() => suggest(items), [items]);

  return { ready, list, suggestions, sync, add, toggle, rename, remove, clearDone, retrySync };
}
