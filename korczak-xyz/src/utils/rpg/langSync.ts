/*
 * The game's language on the account (`language.ts`): `users/{uid}/rpgState/lang` `{ lang, at }`,
 * under the `users/{uid}/{document=**}` rule like the rest of the game's state.
 *
 * Last chooser wins, by the choosing browser's clock, as every other unit of the game's sync does
 * (`cloud.ts`). A browser that never chose — whose language is only the guess — has nothing to
 * weigh, so the account's choice always wins there: signing in on a new phone opens the game in the
 * language picked on the computer. A choice made here while signed out, later than the account's,
 * is sent up at sign-in instead.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { describeError, log } from '../../lib/logger';
import { asLang, loadLangChoice, storeLangChoice, type Lang } from './language';

const langDoc = (uid: string) => doc(getDb()!, 'users', uid, 'rpgState', 'lang');

/** Sends this browser's choice to the account; a failure only means the next sign-in sends it. */
export async function pushLangChoice(uid: string, lang: Lang, at: number): Promise<void> {
  if (!getDb()) return;
  try {
    await setDoc(langDoc(uid), { lang, at });
  } catch (e) {
    log.warn('rpg.lang.push.failed', describeError(e));
  }
}

/**
 * Settles this browser and the account at sign-in: the account's language when it chose later (or
 * this browser never chose), and this browser's sent up when it chose later. Answers the language
 * the game should now be in, or null when it stays as it is.
 */
export async function syncLangChoice(uid: string): Promise<Lang | null> {
  if (!getDb()) return null;
  const local = loadLangChoice();
  try {
    const snap = await getDoc(langDoc(uid));
    const data = snap.exists() ? (snap.data() as { lang?: unknown; at?: unknown }) : null;
    const remote = asLang(data?.lang);
    const remoteAt = Number(data?.at) || 0;
    if (remote && (!local || remoteAt >= local.at)) {
      if (!local || local.lang !== remote || local.at !== remoteAt) storeLangChoice(remote, remoteAt);
      return remote;
    }
    if (local) await pushLangChoice(uid, local.lang, local.at);
    return null;
  } catch (e) {
    log.warn('rpg.lang.pull.failed', describeError(e));
    return null;
  }
}
