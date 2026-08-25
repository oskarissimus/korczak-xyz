/*
 * Firestore for the target record, used when someone is signed in.
 *
 * One document, at `users/{uid}/babySleepTargets/targets`. A collection holding a single fixed id
 * rather than a field on some existing document, because Firestore has no other shape for "one
 * thing": every path alternates collection and document, and hanging it off one of the other
 * collections would put a row that is not a night into a collection every reader of it iterates.
 *
 * `getDoc` rather than `getDocs`, which is the one place this module differs from `routineCloud.ts`;
 * everything else is that module's shape and for its reasons. Nothing is ever deleted — clearing a
 * target is a null field, not a tombstone (see `targets.ts`) — and `getDb()` is read per call rather
 * than held, because a Firestore client that has died mid-session leaves its promises unsettled
 * forever instead of rejecting them.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { log } from '../../lib/logger';
import type { SleepTargets } from './targets';
import { TARGETS_ID, normalizeTargets } from './targets';

function targetsDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'babySleepTargets', TARGETS_ID);
}

/** The account's target, or null when it holds none — or holds one this build cannot read. */
export async function pullTargets(uid: string): Promise<SleepTargets | null> {
  if (!getDb()) return null;
  const snap = await runCloud('babySleep.targets.pull', () => getDoc(targetsDoc(uid)));
  if (!snap.exists()) return null;
  const record = normalizeTargets(snap.data());
  if (!record) log.warn('babySleep.targets.pull.rejected', {});
  return record;
}

export async function pushTargets(uid: string, record: SleepTargets): Promise<void> {
  if (!getDb()) return;
  await runCloud('babySleep.targets.push', () => setDoc(targetsDoc(uid), record));
}
