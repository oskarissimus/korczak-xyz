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
 * The keys themselves are no longer in this document — see `utils/accountKeys/`. What is pushed has
 * its `apiKeys` emptied.
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`, per CLAUDE.md: holding the handle
 * leaves the app talking to a client that died mid-session, and skipping `runCloud` leaves a
 * promise unsettled for ever rather than rejected.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { normalizeConfig } from './defaults';
import { BACKSEAT, type Flavour } from './flavour';
import { withoutKeys, type StampedConfig } from './storage';
import type { BackseatConfig } from './types';

/** `users/{uid}/backseat/config`, or the roaster's `users/{uid}/roaster/config`. */
function configDoc(uid: string, flavour: Flavour) {
  return doc(getDb()!, 'users', uid, flavour.folder, 'config');
}

/** The account's config, or null when there is none yet (or Firebase is switched off). */
export async function pullConfig(
  uid: string,
  flavour: Flavour = BACKSEAT,
): Promise<StampedConfig | null> {
  if (!getDb()) return null;

  const snap = await runCloud(`${flavour.id}.config.pull`, () => getDoc(configDoc(uid, flavour)));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    config: normalizeConfig(data, flavour),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    settled: data.settled === true,
  };
}

export async function pushConfig(
  uid: string,
  config: BackseatConfig,
  updatedAt: number,
  settled: boolean,
  flavour: Flavour = BACKSEAT,
): Promise<void> {
  if (!getDb()) return;
  await runCloud(`${flavour.id}.config.push`, () =>
    setDoc(configDoc(uid, flavour), { ...withoutKeys(config), updatedAt, settled }),
  );
}
