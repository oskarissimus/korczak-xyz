/*
 * Firestore for the bedtime routine records, used when someone is signed in.
 *
 * One document per night under `users/{uid}/babySleepRoutines/{night}`, the id being the night key
 * itself. Deriving the document name from the night is what makes two devices logging the same
 * evening converge on one document instead of racing to create two.
 *
 * The shape of this module is `climateCloud.ts`'s, and for `cloud.ts`'s reasons: the whole
 * collection is pulled with no incremental cursor (an `updatedAt` cursor comes from a client clock,
 * so a device running slow writes *below* a bookmark the other device has already saved and that
 * record is never returned again), nothing is ever deleted (a removal is a tombstone, so it can
 * propagate; a `deleteDoc` would simply be re-created by whichever device had not heard about it),
 * and `getDb()` is read per call rather than held, because a Firestore client that has died
 * mid-session leaves its promises unsettled forever instead of rejecting them.
 */

import { collection, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { log } from '../../lib/logger';
import type { RoutineRecord } from './routine';
import { normalizeRoutine } from './routine';

/** One document a night, so this is a decade and more of nights. */
const PULL_LIMIT = 4000;

function routineCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'babySleepRoutines');
}

export interface RoutinePullResult {
  records: RoutineRecord[];
  /** False when the ceiling was reached, so the caller knows it is not looking at everything. */
  complete: boolean;
}

const EMPTY_PULL: RoutinePullResult = { records: [], complete: false };

/**
 * Every routine record on the account, newest night first.
 *
 * Ordered by `night` rather than by an edit time so the ceiling, if it is ever reached, drops the
 * oldest history instead of an arbitrary slice.
 */
export async function pullRoutines(uid: string): Promise<RoutinePullResult> {
  if (!getDb()) return EMPTY_PULL;
  const snap = await runCloud('babySleep.routine.pull', () =>
    getDocs(query(routineCollection(uid), orderBy('night', 'desc'), limit(PULL_LIMIT)))
  );

  const records: RoutineRecord[] = [];
  let rejected = 0;
  for (const document of snap.docs) {
    const record = normalizeRoutine(document.data());
    if (record) records.push(record);
    else rejected += 1;
  }
  if (rejected > 0) {
    log.warn('babySleep.routine.pull.rejected', { rejected, kept: records.length });
  }

  const complete = snap.docs.length < PULL_LIMIT;
  if (!complete) log.warn('babySleep.routine.pull.truncated', { limit: PULL_LIMIT });

  return { records, complete };
}

export async function pushRoutine(uid: string, record: RoutineRecord): Promise<void> {
  if (!getDb()) return;
  await runCloud('babySleep.routine.push', () =>
    setDoc(doc(routineCollection(uid), record.id), record)
  );
}
