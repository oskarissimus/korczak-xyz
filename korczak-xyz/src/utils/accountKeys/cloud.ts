/*
 * The account's keys, in the account: `users/{uid}/keys/config`.
 *
 * Under the `users/{uid}/{document=**}` catch-all in firestore.rules, so no rules change was needed
 * and none should be added — it is exactly as private as the three per-app documents it replaces.
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`, as everywhere else on the site.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { describeError, log } from '../../lib/logger';
import {
  anyKey,
  keysFrom,
  normalizeAccountKeys,
  stampOf,
  type AccountKeys,
  type KeySource,
  type StampedAccountKeys,
} from './keys';

function keysDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'keys', 'config');
}

/** The apps that kept their own copy before this store existed, by their document's name. */
const APP_DOCS = ['audioGuide', 'backseat', 'sloper'] as const;

/** The account's copy, or null when there is none yet (or Firebase is switched off). */
export async function pullAccountKeys(uid: string): Promise<StampedAccountKeys | null> {
  if (!getDb()) return null;

  const snap = await runCloud('accountKeys.pull', () => getDoc(keysDoc(uid)));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    value: normalizeAccountKeys(data),
    updatedAt: stampOf(data),
    settled: data.settled === true,
  };
}

export async function pushAccountKeys(
  uid: string,
  value: AccountKeys,
  updatedAt: number,
  settled: boolean,
): Promise<void> {
  if (!getDb()) return;
  await runCloud('accountKeys.push', () =>
    setDoc(keysDoc(uid), { ...value, updatedAt, settled }),
  );
}

/**
 * The apps' old copies in the account, for a store that starts empty and undecided — a phone
 * signing in for the first time has them there and nothing beside it in localStorage.
 *
 * It never fails the caller: a missing document or a refusal is simply not a source.
 */
export async function pullAppCopies(uid: string): Promise<{ app: string; source: KeySource }[]> {
  if (!getDb()) return [];

  const found: { app: string; source: KeySource }[] = [];
  for (const app of APP_DOCS) {
    try {
      const snap = await runCloud(`accountKeys.seed.${app}`, () =>
        getDoc(doc(getDb()!, 'users', uid, app, 'config')),
      );
      if (snap.exists()) {
        const data = snap.data();
        found.push({ app, source: { keys: keysFrom(data), updatedAt: stampOf(data) } });
      }
    } catch (e) {
      log.warn('accountKeys.seed.pull.failed', { app, ...describeError(e) });
    }
  }
  return found;
}

/**
 * Empties the keys out of the apps' old documents once the store holds them, so there is one copy
 * of each key in the account and revoking it here is revoking it everywhere.
 *
 * A merge of `apiKeys` alone: `updatedAt` is left as it was, so no app's own sync sees an edit,
 * and every other setting in those documents is untouched. Best effort — the apps no longer read
 * these fields, so one that fails to empty is a stale duplicate, not a live key.
 */
export async function scrubAppCopies(
  uid: string,
  copies: { app: string; source: KeySource }[],
): Promise<void> {
  if (!getDb()) return;
  for (const { app, source } of copies) {
    if (!anyKey(source.keys)) continue;
    const emptied = Object.fromEntries(Object.keys(source.keys).map((k) => [k, null]));
    try {
      await runCloud(`accountKeys.scrub.${app}`, () =>
        setDoc(doc(getDb()!, 'users', uid, app, 'config'), { apiKeys: emptied }, { merge: true }),
      );
    } catch (e) {
      log.warn('accountKeys.scrub.cloud.failed', { app, ...describeError(e) });
    }
  }
}
