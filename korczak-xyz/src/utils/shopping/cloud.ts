/*
 * Firestore for the shopping list, used when someone is signed in.
 *
 * One document per line under `users/{uid}/shopping/{id}`, where the uid is the *data owner's* —
 * which is somebody else's when the list has been shared with you. `useDataOwner` is what resolves
 * that, and nothing here may run before it has.
 *
 * The shape of this module is `babySleep/cloud.ts`'s, and for its reasons: the whole collection is
 * pulled with no incremental cursor (an `updatedAt` cursor comes from a client clock, so a device
 * running slow writes *below* a bookmark the other device has already saved and that line is never
 * returned again), nothing is ever deleted (a removal is a tombstone, so it can propagate; a
 * `deleteDoc` would simply be re-created by whichever device had not heard about it), and `getDb()`
 * is read per call rather than held, because a Firestore client that has died mid-session leaves its
 * promises unsettled forever instead of rejecting them.
 */

import { collection, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { log } from '../../lib/logger';
import type { ShoppingItem } from './item';
import { normalizeItem } from './item';

/**
 * Tombstones are kept rather than deleted — they are what stops a cleared line coming back on the
 * next pull, and they are what the suggestion chips are counted from. A household clears a couple of
 * dozen lines a week, so this is a decade of shopping.
 */
const PULL_LIMIT = 5000;

function itemsCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'shopping');
}

export interface ItemPullResult {
  items: ShoppingItem[];
  /** False when the ceiling was reached, so the caller knows it is not looking at everything. */
  complete: boolean;
}

const EMPTY_PULL: ItemPullResult = { items: [], complete: false };

/**
 * Every line on the account, newest first.
 *
 * Ordered by `createdAt` rather than by an edit time so the ceiling, if it is ever reached, drops
 * the oldest history instead of an arbitrary slice. Note the trap that comes with any `orderBy`: a
 * document *lacking* the field is excluded from the result entirely. Every line this app has ever
 * written carries `createdAt`, so that is a rule about future shapes rather than a live hazard —
 * renaming or dropping the field would make the whole existing list invisible to the pull rather
 * than merely unsorted.
 */
export async function pullItems(uid: string): Promise<ItemPullResult> {
  if (!getDb()) return EMPTY_PULL;
  const snap = await runCloud('shopping.pull', () =>
    getDocs(query(itemsCollection(uid), orderBy('createdAt', 'desc'), limit(PULL_LIMIT)))
  );

  const items: ShoppingItem[] = [];
  let rejected = 0;
  for (const document of snap.docs) {
    const item = normalizeItem(document.data());
    if (item) items.push(item);
    else rejected += 1;
  }
  if (rejected > 0) log.warn('shopping.pull.rejected', { rejected, kept: items.length });

  const complete = snap.docs.length < PULL_LIMIT;
  if (!complete) log.warn('shopping.pull.truncated', { limit: PULL_LIMIT });

  return { items, complete };
}

export async function pushItem(uid: string, item: ShoppingItem): Promise<void> {
  if (!getDb()) return;
  await runCloud('shopping.push', () => setDoc(doc(itemsCollection(uid), item.id), item));
}
