/*
 * Time in the game, on the gateway (`utils/rpg/playtime.ts` has the why and the arithmetic):
 * `POST /playtime` adds a signed-in page's seconds to `rpgPlaytime/{uid}`, and the admin panel's
 * `GET /admin/accounts` lists every account with its e-mail, its tank and its time per window.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAuth, type UserRecord } from 'firebase-admin/auth';

import { warsawDay } from '../../../korczak-xyz/src/utils/rpg/requestLog';
import {
  PLAYTIME_COLLECTION,
  creditSeconds,
  playtimeOf,
  sortAccounts,
  summarize,
  windowsOf,
  type AccountsPage,
  type AdminAccount,
} from '../../../korczak-xyz/src/utils/rpg/playtime';
import { WALLET_COLLECTION, balanceOf } from '../../../korczak-xyz/src/utils/rpg/wallet';
import { db } from '../runtime';

/** Adds one report to the account's time; answers what was credited. */
export async function addPlaytime(uid: string, asked: unknown, now = Date.now()): Promise<number> {
  const doc = db.collection(PLAYTIME_COLLECTION).doc(uid);
  const s = creditSeconds(asked, playtimeOf((await doc.get()).data()).lastAt, now);
  if (s <= 0) return 0;
  await doc.set({ total: FieldValue.increment(s), days: { [warsawDay(now)]: FieldValue.increment(s) }, lastAt: now }, { merge: true });
  return s;
}

/** Enough for this game for a long while; past it the answer says it is cut. */
const MAX_ACCOUNTS = 5000;

async function allUsers(): Promise<{ users: UserRecord[]; truncated: boolean }> {
  const users: UserRecord[] = [];
  let token: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, token);
    users.push(...page.users);
    token = page.pageToken;
  } while (token && users.length < MAX_ACCOUNTS);
  return { users: users.slice(0, MAX_ACCOUNTS), truncated: Boolean(token) || users.length > MAX_ACCOUNTS };
}

async function byId(collection: string): Promise<Map<string, Record<string, unknown>>> {
  const snap = await db.collection(collection).get();
  return new Map(snap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
}

const time = (s: string | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
};

export async function listAccounts(now = Date.now()): Promise<AccountsPage> {
  const [{ users, truncated }, play, ledger, admins] = await Promise.all([
    allUsers(),
    byId(PLAYTIME_COLLECTION),
    byId(WALLET_COLLECTION),
    byId('admins'),
  ]);
  const accounts: AdminAccount[] = users.map((u) => {
    const p = playtimeOf(play.get(u.uid));
    return {
      uid: u.uid,
      email: u.email ?? null,
      createdAt: time(u.metadata.creationTime),
      lastSignInAt: time(u.metadata.lastRefreshTime ?? u.metadata.lastSignInTime),
      admin: admins.has(u.uid),
      disabled: u.disabled,
      balanceUsd: balanceOf(ledger.get(u.uid)),
      play: windowsOf(p, now),
      lastPlayedAt: p.lastAt,
    };
  });
  return { at: now, accounts: sortAccounts(accounts), totals: summarize(accounts, now), truncated };
}
