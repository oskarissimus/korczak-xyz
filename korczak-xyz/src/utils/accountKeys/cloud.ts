/*
 * The account's keys, in the account: `users/{uid}/keys/config` — written from here, never read.
 *
 * Since 31 Oct 2026 the page cannot read that document back (`firestore.rules` denies every read
 * under `users/{uid}/keys`; owner: "the key should never go from Firebase to the browser"). A key
 * typed here is written with a merge and from then on exists for this page only as `ACCOUNT_KEY`;
 * what the page may know about the account's keys comes from the gateway's `/account/keys`
 * (`fetchAccountKeyStatus`): which exist, the last four characters of each, and the two settings
 * beside them. The legacy per-app copies (`users/{uid}/{audioGuide,backseat,sloper}/config`) are
 * no longer read here at all; the gateway moves anything left in them into this store and empties
 * them (`retireLegacyCopies`).
 *
 * Every write reads `getDb()` afresh and goes through `runCloud`, as everywhere else on the site.
 */

import { doc, setDoc } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { fetchAccountKeyStatus } from '../rpg/gateway';
import {
  ACCOUNT_KEY,
  asKey,
  viewOf,
  type AccountKeys,
  type AccountKeyView,
  type ApiKeys,
} from './keys';

function keysDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'keys', 'config');
}

/** The account's keys as the gateway describes them, or null when Firebase is switched off. */
export async function pullAccountKeyView(signal?: AbortSignal): Promise<AccountKeyView | null> {
  if (!getDb()) return null;
  return viewOf(await fetchAccountKeyStatus(signal));
}

/** What a write may carry: some keys, and either setting. A handle is never written. */
export interface AccountKeysPatch {
  apiKeys?: Partial<ApiKeys>;
  openaiCredit?: AccountKeys['openaiCredit'];
  audioGuideWriter?: AccountKeys['audioGuideWriter'];
}

export async function pushAccountKeys(
  uid: string,
  patch: AccountKeysPatch,
  updatedAt: number,
): Promise<void> {
  if (!getDb()) return;
  const data: Record<string, unknown> = { updatedAt, settled: true };
  if (patch.apiKeys) {
    const apiKeys: Record<string, string | null> = {};
    for (const [name, key] of Object.entries(patch.apiKeys)) {
      // `asKey` reads a handle as no key; one must never overwrite the real key it stands for.
      if (key === ACCOUNT_KEY) continue;
      apiKeys[name] = asKey(key);
    }
    data.apiKeys = apiKeys;
  }
  if ('openaiCredit' in patch) data.openaiCredit = patch.openaiCredit ?? null;
  if (patch.audioGuideWriter) data.audioGuideWriter = patch.audioGuideWriter;
  await runCloud('accountKeys.push', () => setDoc(keysDoc(uid), data, { merge: true }));
}
