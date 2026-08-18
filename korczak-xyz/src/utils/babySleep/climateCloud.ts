/*
 * Firestore for the night climate records, used when someone is signed in.
 *
 * One document per record — two per night — under `users/{uid}/babySleepClimate/{id}`, where the id
 * is `${night}-${part}`. Deriving the document name from the night is what makes two devices logging
 * the same evening converge on one document instead of racing to create two.
 *
 * The shape of this module is `cloud.ts`'s, and for its reasons: the whole collection is pulled with
 * no incremental cursor (an `updatedAt` cursor comes from a client clock, so a device running slow
 * writes *below* a bookmark the other device has already saved and that record is never returned
 * again), nothing is ever deleted (a removal is a tombstone, so it can propagate; a `deleteDoc`
 * would simply be re-created by whichever device had not heard about it), and `getDb()` is read per
 * call rather than held, because a Firestore client that has died mid-session leaves its promises
 * unsettled forever instead of rejecting them.
 */

import { collection, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { log } from '../../lib/logger';
import type { ClimateRecord } from './climate';
import { normalizeClimate } from './climate';

/** Two documents a night, so this is a decade and more of nights. */
const PULL_LIMIT = 4000;

function climateCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'babySleepClimate');
}

export interface ClimatePullResult {
  records: ClimateRecord[];
  /** False when the ceiling was reached, so the caller knows it is not looking at everything. */
  complete: boolean;
}

const EMPTY_PULL: ClimatePullResult = { records: [], complete: false };

/**
 * Every climate record on the account, newest night first.
 *
 * Ordered by `night` rather than by an edit time so the ceiling, if it is ever reached, drops the
 * oldest history instead of an arbitrary slice.
 */
export async function pullClimate(uid: string): Promise<ClimatePullResult> {
  if (!getDb()) return EMPTY_PULL;
  const snap = await runCloud('babySleep.climate.pull', () =>
    getDocs(query(climateCollection(uid), orderBy('night', 'desc'), limit(PULL_LIMIT)))
  );

  const records: ClimateRecord[] = [];
  let rejected = 0;
  for (const document of snap.docs) {
    const record = normalizeClimate(document.data());
    if (record) records.push(record);
    else rejected += 1;
  }
  if (rejected > 0) {
    log.warn('babySleep.climate.pull.rejected', { rejected, kept: records.length });
  }

  const complete = snap.docs.length < PULL_LIMIT;
  if (!complete) log.warn('babySleep.climate.pull.truncated', { limit: PULL_LIMIT });

  return { records, complete };
}

export async function pushClimate(uid: string, record: ClimateRecord): Promise<void> {
  if (!getDb()) return;
  await runCloud('babySleep.climate.push', () =>
    setDoc(doc(climateCollection(uid), record.id), record)
  );
}
