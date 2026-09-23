/*
 * The keys, in the account.
 *
 * `users/{uid}/audioGuide/config`, under the `users/{uid}/{document=**}` catch-all, so no rules
 * change was needed and none should be added — the same arrangement as `users/{uid}/sloper/config`
 * and `users/{uid}/backseat/config`, which this file also reads to borrow from.
 *
 * LAST WRITE WINS, WHOLESALE, ON ONE `updatedAt`. Merging by field would resurrect a key cleared on
 * one device from another device's copy, for ever; see `.claude/rules/sloper.md`.
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`, as everywhere else on the site.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { describeError, log } from '../../lib/logger';
import { borrowKeys, keysFrom, NO_KEYS, type ApiKeys, type StampedKeys } from './keys';

function keysDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'audioGuide', 'config');
}

/** The account's copy, or null when there is none yet (or Firebase is switched off). */
export async function pullKeys(uid: string): Promise<StampedKeys | null> {
  if (!getDb()) return null;

  const snap = await runCloud('audioGuide.keys.pull', () => getDoc(keysDoc(uid)));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    keys: keysFrom(data),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    borrowed: false,
    settled: data.settled === true,
  };
}

export async function pushKeys(
  uid: string,
  keys: ApiKeys,
  updatedAt: number,
  settled: boolean,
): Promise<void> {
  if (!getDb()) return;
  await runCloud('audioGuide.keys.push', () =>
    setDoc(keysDoc(uid), { apiKeys: keys, updatedAt, settled }),
  );
}

/**
 * The two keys out of the account's sloper and backseat configs, sloper first.
 *
 * The half of the borrow a browser cannot do: a phone signing in for the first time has the other
 * apps' keys in the account and nothing beside it in localStorage. It never fails the caller — a
 * missing document or a refusal is two nulls, because an app that would not open for want of a
 * different app's document is a poor trade for a convenience.
 */
export async function pullBorrowableKeys(uid: string): Promise<ApiKeys> {
  if (!getDb()) return NO_KEYS;

  const sources: ApiKeys[] = [];
  for (const app of ['sloper', 'backseat']) {
    try {
      const snap = await runCloud(`audioGuide.keys.borrow.${app}`, () =>
        getDoc(doc(getDb()!, 'users', uid, app, 'config')),
      );
      if (snap.exists()) sources.push(keysFrom(snap.data()));
    } catch (e) {
      log.warn('audioGuide.keys.borrow.pull.failed', { app, ...describeError(e) });
    }
  }
  return borrowKeys(sources);
}
