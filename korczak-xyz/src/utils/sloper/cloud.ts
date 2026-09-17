/*
 * The config, in the account.
 *
 * One document — `users/{uid}/sloper/config` — under the `users/{uid}/{document=**}` catch-all in
 * firestore.rules, so nothing had to be added there and nobody but the owner can read it.
 *
 * WHY THE KEYS GO IN AT ALL. The ask this app was migrated for is "keep the integrations
 * integrated": sloper on GitHub Pages kept its keys in one browser's localStorage, so the phone
 * and the laptop were two separate setups and clearing site data meant re-pasting four keys. Here
 * the account carries them. The trade is stated plainly in `.claude/rules/sloper.md`: these are
 * metered, revocable, per-provider keys; they are already in the clear in this page's memory every
 * time it calls OpenAI; and the only design that keeps them out of the browser entirely is one
 * where a server of ours holds them and makes the calls, which is a strictly larger thing to own
 * and puts this site on the hook for somebody else's OpenAI bill.
 *
 * LAST WRITE WINS, WHOLESALE, ON ONE TIMESTAMP. There is no reconciler here and no per-field
 * revision like the sleep log's, because a config is a handful of fields one person edits on one
 * device at a time and the only merge that would matter — two phones typing two different OpenAI
 * keys at once — has no answer a machine could pick. Merging field by field looks safer and is
 * worse: a key cleared on the laptop would be resurrected by the phone's copy on its next load,
 * for ever, which is the one outcome that must not happen to a key somebody deliberately revoked.
 * So the newer `updatedAt` wins entirely, and clearing a key is a real edit that propagates.
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`, per CLAUDE.md: holding the handle
 * leaves the app talking to a client that died mid-session, and skipping `runCloud` leaves a
 * promise unsettled for ever rather than rejected.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { normalizeConfig } from './defaults';
import type { StampedConfig } from './storage';
import type { SloperConfig } from './types';

function configDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'sloper', 'config');
}

/** The account's config, or null when there is none yet (or Firebase is switched off). */
export async function pullConfig(uid: string): Promise<StampedConfig | null> {
  if (!getDb()) return null;

  const snap = await runCloud('sloper.config.pull', () => getDoc(configDoc(uid)));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    config: normalizeConfig(data),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

export async function pushConfig(
  uid: string,
  config: SloperConfig,
  updatedAt: number,
): Promise<void> {
  if (!getDb()) return;
  await runCloud('sloper.config.push', () => setDoc(configDoc(uid), { ...config, updatedAt }));
}
