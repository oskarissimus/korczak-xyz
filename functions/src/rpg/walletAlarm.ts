/*
 * A request on our own keys refused because the provider's wallet is empty (owner, 20 Nov 2026: "jak
 * jakiś request failed z powodu pieniędzy to powinno iść do sentry od razu, że problem, incydent i że
 * trzeba doładować").
 *
 * Our own keys are the server's (diesel), the demo's and the proposal pool's — never a player's own
 * key, whose wallet is theirs (the gateway calls this only on diesel). The browser already sends one
 * `rpg.funds` per sitting, but it cannot tell our wallet from a player's, a headless page sends
 * nothing, and the demo and the pool have no browser at all; this is the one that knows.
 *
 * Each refusal that reads as an empty balance (`isProviderFundsError`, the same words the game reads):
 * - a Sentry `fatal`, one issue per provider (`rpg.wallet.empty`), saying which wallet and where to
 *   top it up — at most every `ALARM_EVERY_MS` per instance, since Sentry groups the rest anyway;
 * - `rpgWalletAlarms/{provider}` (no rule, Admin SDK only), which the admin panel's wallets read to
 *   put "refused for lack of money" beside that provider's balance.
 * Never throws: an alarm is never what fails the request it is about.
 */

import { FieldValue } from 'firebase-admin/firestore';

import {
  ALARM_EVERY_MS,
  TOP_UP,
  WALLET_ALARMS,
  fundsProviderOf,
  isProviderFundsError,
  type FundsProvider,
} from '../../../korczak-xyz/src/utils/rpg/fundsSigns';
import { db } from '../runtime';
import { reportError, reportIncident } from '../sentry';

const lastAlarm = new Map<FundsProvider, number>();

/** For tests. */
export function forgetAlarms(): void {
  lastAlarm.clear();
}

/**
 * A provider refused one of our own requests: an incident if it was for want of money. Answers whether
 * it was, so a caller may say so. `provider` is the gateway's name for it (`fal`, `google`…).
 */
export async function noteRefusal(provider: string, status: number | null, body: string, where: string): Promise<boolean> {
  const p = fundsProviderOf(provider);
  if (!p) return false;
  const text = `${status ?? ''} ${body}`.trim();
  if (!isProviderFundsError(p, text)) return false;
  const now = Date.now();
  const error = body.slice(0, 300);
  if (now - (lastAlarm.get(p) ?? 0) >= ALARM_EVERY_MS) {
    lastAlarm.set(p, now);
    const { name, url } = TOP_UP[p];
    reportIncident(
      ['rpg.wallet.empty', p],
      `${name}: portfel pusty — trzeba doładować (${url})`,
      { provider: p, where, wallet: 'empty', project: process.env.GCLOUD_PROJECT ?? 'unknown' },
      { status, error, topUp: url },
    );
  }
  try {
    await db
      .collection(WALLET_ALARMS)
      .doc(p)
      .set({ provider: p, at: now, status, error, where, count: FieldValue.increment(1) }, { merge: true });
  } catch (e) {
    reportError('rpgWalletAlarm', e, { provider: p });
  }
  return true;
}
