/*
 * The config, in the account.
 *
 * One document — `users/{uid}/backseat/config` — under the `users/{uid}/{document=**}` catch-all
 * in firestore.rules, so nothing had to be added there and nobody but the owner can read it. This
 * is the same arrangement sloper has, deliberately: two apps that each hold somebody's API keys
 * should not differ in where they put them or in who can read them.
 *
 * LAST WRITE WINS, WHOLESALE, ON ONE TIMESTAMP, and the reasoning is worth repeating here rather
 * than cross-referencing, because the tempting change is the same one. Merging field by field
 * looks safer and is worse: a key CLEARED on the laptop would be resurrected by the phone's copy
 * on its next load, for ever. That is the one outcome that must not happen to a key somebody
 * deliberately revoked, so the newer `updatedAt` wins entirely and clearing a key is an ordinary
 * edit that propagates.
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`, per CLAUDE.md: holding the handle
 * leaves the app talking to a client that died mid-session, and skipping `runCloud` leaves a
 * promise unsettled for ever rather than rejected.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { describeError, log } from '../../lib/logger';
import { runCloud } from '../../lib/firestoreHealth';
import { normalizeConfig } from './defaults';
import { keysFromSloper } from './importKeys';
import type { StampedConfig } from './storage';
import type { ApiKeys, BackseatConfig } from './types';

function configDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'backseat', 'config');
}

/**
 * The video generation wizard's config, in the same account.
 *
 * The path is written out here rather than imported from `utils/sloper/cloud.ts`, which exports no
 * such thing and should not start: that module is sloper's, and a function in it that exists only
 * for this app is a dependency pointing the wrong way. What is shared is the path — one line,
 * stated in both files, and `sloper.md` is emphatic that it never moves because somebody's saved
 * keys are on the end of it.
 */
function sloperConfigDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'sloper', 'config');
}

/** The account's config, or null when there is none yet (or Firebase is switched off). */
export async function pullConfig(uid: string): Promise<StampedConfig | null> {
  if (!getDb()) return null;

  const snap = await runCloud('backseat.config.pull', () => getDoc(configDoc(uid)));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    config: normalizeConfig(data),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    // Never borrowed: a borrow is something this browser did, not something the account records.
    borrowed: false,
    /*
     * Absent on every document written before the flag existed — which includes the empty ones the
     * sync itself created on somebody's first signed-in visit. Those read as unsettled and are
     * therefore borrowed into once, which is precisely the repair they need.
     */
    settled: data.settled === true,
  };
}

export async function pushConfig(
  uid: string,
  config: BackseatConfig,
  updatedAt: number,
  settled: boolean,
): Promise<void> {
  if (!getDb()) return;
  await runCloud('backseat.config.push', () =>
    setDoc(configDoc(uid), { ...config, updatedAt, settled }),
  );
}

/**
 * The three keys this app can use out of the account's sloper config, for an account that has no
 * Backseat config of its own yet.
 *
 * This is the half of the borrow that `storage.ts` cannot do: a phone signing in for the first
 * time has sloper's keys in the account and nothing at all in its own localStorage, so there is
 * nothing beside it to copy from.
 *
 * **It never fails the caller.** A missing document, a rules refusal or a dead client all come
 * back as three nulls: the settings screen works perfectly well with no keys in it, and an app
 * that refused to open because it could not read a *different* app's document would be a poor
 * trade for a convenience.
 */
export async function pullSloperKeys(uid: string): Promise<ApiKeys> {
  const empty: ApiKeys = { openai: null, google: null, elevenLabs: null };
  if (!getDb()) return empty;

  try {
    const snap = await runCloud('backseat.config.pull.sloper', () => getDoc(sloperConfigDoc(uid)));
    return snap.exists() ? keysFromSloper(snap.data()) : empty;
  } catch (e) {
    log.warn('backseat.import.sloper.pull.failed', describeError(e));
    return empty;
  }
}
