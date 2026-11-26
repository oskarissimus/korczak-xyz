/*
 * A per-day count for routes that write without a payer (security audit, Nov 2026): the replay
 * beacon and its frames (anyone, keyed by a hashed address), a self-rig upload and SkinTokens
 * (signed in, keyed by the account). Each would otherwise fill storage or spend the project's own
 * money as fast as somebody could call it.
 *
 * `rpgDailyCaps/{day}-{kind}-{key}` holds `{n, expireAt}`, deleted by the same TTL as the replays
 * (`expireAt`). An address is never stored: `ipKey` hashes it with the day in the salt.
 */
import { FieldValue } from 'firebase-admin/firestore';

import { dayKey, ipKey } from '../demo/limits';
import { db } from '../runtime';

export const DAILY_CAPS = {
  /** New replay sessions per address and day; a session's own chunks and frames are capped on it. */
  replaySessions: 200,
  /** Frames per address and day (each session already holds at most `REPLAY_FRAMES.perSession`). */
  replayFrames: 2000,
  /** Rigs an account may upload in a day. */
  selfRig: 200,
  /** SkinTokens runs an account may ask for in a day (~half a cent each, on the project). */
  skin: 100,
} as const;

export type DailyKind = keyof typeof DAILY_CAPS;

/** Takes one of today's `kind` for `who`; false once the day's count is spent. */
export async function takeDaily(kind: DailyKind, who: { ip?: string; uid?: string }, max: number = DAILY_CAPS[kind]): Promise<boolean> {
  const day = dayKey();
  const key = who.uid ? `u-${who.uid}` : `ip-${ipKey(who.ip ?? 'unknown', day)}`;
  const ref = db.collection('rpgDailyCaps').doc(`${day}-${kind}-${key}`);
  return db.runTransaction(async (tx) => {
    const n = Number((await tx.get(ref)).data()?.n ?? 0);
    if (n >= max) return false;
    tx.set(ref, { n: FieldValue.increment(1), expireAt: new Date(Date.now() + 2 * 86_400_000) }, { merge: true });
    return true;
  });
}
