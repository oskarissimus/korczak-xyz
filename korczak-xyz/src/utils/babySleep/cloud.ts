/*
 * Firestore for the baby sleep log, used when someone is signed in.
 *
 * One document per entry, under `users/{uid}/babySleep/{id}`. Unlike the fretboard trainer's
 * sittings these documents are *mutable* — a nap can be corrected or deleted — and that difference
 * drives two decisions here.
 *
 * **The whole collection is pulled, with no incremental cursor.** The obvious cursor would be
 * `updatedAt`, and it is unsafe: it comes from a client clock, so a second device running a few
 * minutes slow writes an entry *below* the bookmark the first device has already saved, and that
 * entry is then never returned by a `>=` query again. It is gone, silently, forever. The correct
 * incremental fix is a server-written timestamp to order on; the cheaper one, on a single-account
 * database logging a handful of entries a day, is to read the lot. A few thousand small documents is
 * several years of history, and the caller only does a full pull once per page load and on reconnect
 * — every other sync is push-only.
 *
 * **Nothing is ever deleted.** A removal is a tombstone written like any other edit, so it can
 * propagate to the other device; a `deleteDoc` would simply be re-created by whichever device had
 * not heard about it.
 *
 * Every call goes through `runCloud`, and `getDb()` is read per call rather than held: a Firestore
 * client that has died mid-session leaves its promises unsettled forever instead of rejecting them,
 * and recovery replaces the instance. See `src/lib/firestoreHealth.ts` and the client-health note in
 * CLAUDE.md.
 */

import { collection, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { log } from '../../lib/logger';
import type { SleepEntry } from './types';
import { normalizeEntry } from './types';

/**
 * Ceiling on one pull. An entry is ~150 bytes, so this is a few years of logging and a guard
 * against dragging an unbounded history over a phone connection.
 */
const PULL_LIMIT = 2000;

function entriesCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'babySleep');
}

export interface PullResult {
  entries: SleepEntry[];
  /** False when the ceiling was reached, so the caller knows it is not looking at everything. */
  complete: boolean;
}

const EMPTY_PULL: PullResult = { entries: [], complete: false };

/**
 * Every entry on the account, newest first.
 *
 * Ordered by `start` rather than by an edit time so the ceiling, if it is ever reached, drops the
 * oldest history instead of an arbitrary slice.
 */
export async function pullEntries(uid: string): Promise<PullResult> {
  if (!getDb()) return EMPTY_PULL;
  const snap = await runCloud('babySleep.pull', () =>
    getDocs(query(entriesCollection(uid), orderBy('start', 'desc'), limit(PULL_LIMIT)))
  );

  const entries: SleepEntry[] = [];
  let rejected = 0;
  for (const document of snap.docs) {
    const entry = normalizeEntry(document.data());
    if (entry) entries.push(entry);
    else rejected += 1;
  }
  if (rejected > 0) log.warn('babySleep.pull.rejected', { rejected, kept: entries.length });

  const complete = snap.docs.length < PULL_LIMIT;
  if (!complete) log.warn('babySleep.pull.truncated', { limit: PULL_LIMIT });

  return { entries, complete };
}

export async function pushEntry(uid: string, entry: SleepEntry): Promise<void> {
  if (!getDb()) return;
  await runCloud('babySleep.push', () => setDoc(doc(entriesCollection(uid), entry.id), entry));
}
