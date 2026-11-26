/*
 * The diesel tank on the server: a signed-in reader with no key of their own is paid for out of
 * `rpgLedger/{uid}.dieselUsd`, on the server's keys from the admin panel. The rules, the names and
 * the reservation are in `utils/rpg/wallet.ts`; this file is the Firestore half.
 *
 * - **The first tank is granted once**, the first time the account asks (`/wallet`, or its first
 *   request on diesel): `grantUsd` from `rpgDiesel/config` (the panel), 400 L by default: the sign-up bonus.
 *   `dieselGrantedAt` marks it, so emptying the tank never refills it.
 * - **Every request reserves its worst case** in a transaction and is settled afterwards at what it
 *   cost — the demo's scheme (`handler.ts`), against one account instead of an address and the day.
 */

import { FieldValue } from 'firebase-admin/firestore';

import {
  BALANCE_FIELD,
  DIESEL_CONFIG_DOC,
  DISCOUNTS_FIELD,
  DIESEL_KEYS,
  GRANTED_FIELD,
  WALLET_COLLECTION,
  balanceOf,
  grantOf,
  type WalletStatus,
} from '../../../korczak-xyz/src/utils/rpg/wallet';
import { LITRES_PER_USD } from '../../../korczak-xyz/src/utils/rpg/diesel';
import {
  PURCHASES_COLLECTION,
  SUBSCRIPTIONS_COLLECTION,
  SUB_BALANCE_FIELD,
  SUB_FIELD,
  subLeftOf,
  type SubscriptionView,
} from '../../../korczak-xyz/src/utils/rpg/paddle';
import { readServerKeys } from './admin';
import { dayKey, ipKey } from '../demo/limits';
import { db } from '../runtime';

function walletDoc(uid: string) {
  return db.collection(WALLET_COLLECTION).doc(uid);
}

function configDoc() {
  return db.collection(DIESEL_CONFIG_DOC[0]).doc(DIESEL_CONFIG_DOC[1]);
}

/** The panel's diesel settings, kept a minute per instance: they are read on every request on diesel. */
let configCache: { at: number; data: Record<string, unknown> | undefined } | null = null;
async function dieselConfig(): Promise<Record<string, unknown> | undefined> {
  if (configCache && Date.now() - configCache.at < 60_000) return configCache.data;
  const data = (await configDoc().get()).data();
  configCache = { at: Date.now(), data };
  return data;
}

/** The first tank. */
export async function grantUsd(): Promise<number> {
  return grantOf(await dieselConfig());
}

/**
 * How many first tanks one address may pour in a Warsaw day (security audit, 26 Nov 2026). Signing up
 * is one request with nothing to stop a script, and every new account came with $4 of the server's
 * keys; past this many, a new account from that address starts empty (and is granted on a later day or
 * from another address). `grantsPerIp` on `rpgDiesel/config` overrides it.
 */
export const GRANTS_PER_IP = 3;

/**
 * What diesel may spend on the server's keys in a Warsaw day, all accounts together, unless
 * `dailyUsd` on `rpgDiesel/config` says otherwise: the backstop the demo has always had (`dailyUsd`
 * there), so a hole nobody has found yet costs a day's cap and not a wallet.
 */
export const DEFAULT_DAILY_USD = 50;
const DAY_SHARDS = 10;
const DAYS_COLLECTION = 'rpgDieselDays';
const GRANTS_COLLECTION = 'rpgDieselGrants';

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Today's diesel spend across every account, read from its shards and kept 30 s per instance. */
let dayCache: { at: number; day: string; usd: number } | null = null;
async function spentToday(day: string): Promise<number> {
  if (dayCache && dayCache.day === day && Date.now() - dayCache.at < 30_000) return dayCache.usd;
  const shards = await Promise.all(
    Array.from({ length: DAY_SHARDS }, (_, i) => db.collection(DAYS_COLLECTION).doc(`${day}-${i}`).get()),
  );
  const usd = shards.reduce((n, s) => n + numberOr(s.data()?.usd, 0), 0);
  dayCache = { at: Date.now(), day, usd };
  return usd;
}

/** For tests. */
export function forgetDieselCaches(): void {
  configCache = null;
  dayCache = null;
}

export type Reservation =
  | { ok: true; balanceUsd: number }
  | { ok: false; balanceUsd: number; reason?: 'daily-cap' };

/** Who is asking, where the first tank is concerned: the caller's address, when the gateway knows it. */
export interface Asker {
  ip?: string;
}

/**
 * Takes a request's worst case out of the tank, or says it does not fit. An account never granted is
 * granted on the way — unless its address has poured `GRANTS_PER_IP` today, when it starts at zero and
 * nothing is written, so the grant is still to come. A follow-up (`free`) only needs the account to
 * exist. Refused outright while today's spend across all accounts is at the day's cap.
 */
export async function reserveDiesel(uid: string, usd: number, free = false, asker: Asker = {}): Promise<Reservation> {
  const config = await dieselConfig();
  const grant = grantOf(config);
  const day = dayKey();
  if (!free && usd > 0 && (await spentToday(day)) >= numberOr(config?.dailyUsd, DEFAULT_DAILY_USD)) {
    return { ok: false, balanceUsd: balanceOf((await walletDoc(uid).get()).data()) ?? 0, reason: 'daily-cap' };
  }
  const ref = walletDoc(uid);
  const grants = asker.ip ? db.collection(GRANTS_COLLECTION).doc(ipKey(asker.ip, day)) : null;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const known = balanceOf(snap.data());
    let fresh: Record<string, unknown> = {};
    let balance = known ?? 0;
    if (known === null) {
      const poured = grants ? numberOr((await tx.get(grants)).data()?.count, 0) : 0;
      if (poured >= numberOr(config?.grantsPerIp, GRANTS_PER_IP)) {
        // Starts empty, writes nothing: granted later, on another day or from another address.
        return free ? { ok: true as const, balanceUsd: 0 } : { ok: false as const, balanceUsd: 0 };
      }
      balance = grant;
      fresh = { [GRANTED_FIELD]: Date.now(), dieselGrantUsd: grant };
      if (grants) tx.set(grants, { count: poured + 1, day, expireAt: new Date(Date.now() + 2 * 86_400_000) }, { merge: true });
    }
    if (free) {
      if (known === null) tx.set(ref, { [BALANCE_FIELD]: balance, ...fresh }, { merge: true });
      return { ok: true as const, balanceUsd: balance };
    }
    if (!(balance > 0) || usd > balance) {
      if (known === null) tx.set(ref, { [BALANCE_FIELD]: balance, ...fresh }, { merge: true });
      return { ok: false as const, balanceUsd: balance };
    }
    tx.set(ref, { [BALANCE_FIELD]: balance - usd, dieselUpdatedAt: Date.now(), ...fresh }, { merge: true });
    return { ok: true as const, balanceUsd: balance - usd };
  });
}

/**
 * Settles a reservation at what the request cost: the rest goes back, and a cost over the reservation
 * is taken too, so the tank may end below zero (read as empty, `balanceOf`) until it is filled. It
 * used to stop at the reservation, which made the owner pay every overrun (security audit, 26 Nov
 * 2026). An unknown cost keeps the whole reservation. What was spent is added to the day's total.
 */
export async function settleDiesel(uid: string, reserved: number, actual: number | null): Promise<void> {
  const spent = actual === null ? reserved : Math.max(0, actual);
  const back = reserved - spent;
  const write: Record<string, unknown> = {
    dieselSpentUsd: FieldValue.increment(spent),
    [SUB_BALANCE_FIELD]: FieldValue.increment(-spent),
    dieselUpdatedAt: Date.now(),
  };
  if (back !== 0) write[BALANCE_FIELD] = FieldValue.increment(back);
  await walletDoc(uid).set(write, { merge: true });
  if (spent > 0) {
    const day = dayKey();
    const shard = Math.floor(Math.random() * DAY_SHARDS);
    await db
      .collection(DAYS_COLLECTION)
      .doc(`${day}-${shard}`)
      .set({ usd: FieldValue.increment(spent), day, expireAt: new Date(Date.now() + 30 * 86_400_000) }, { merge: true });
    if (dayCache && dayCache.day === day) dayCache.usd += spent;
  }
}

/** Adds to an account's tank (the panel's top-up, an admin's free canister; a purchase is `creditPurchase`). Grants the first tank too. */
export async function topUpDiesel(uid: string, usd: number): Promise<number> {
  const grant = await grantUsd();
  const ref = walletDoc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const known = balanceOf(snap.data());
    const next = (known ?? grant) + usd;
    tx.set(
      ref,
      { [BALANCE_FIELD]: next, dieselToppedUpUsd: FieldValue.increment(usd), dieselUpdatedAt: Date.now(), ...(known === null ? { [GRANTED_FIELD]: Date.now(), dieselGrantUsd: grant } : {}) },
      { merge: true },
    );
    return next;
  });
}

/** `/wallet`: what is left (the first tank granted on the way), and which keys diesel can stand in for. */
export async function walletStatus(uid: string, asker: Asker = {}): Promise<WalletStatus> {
  const [reservation, keys, grant] = await Promise.all([reserveDiesel(uid, 0, true, asker), readServerKeys(), grantUsd()]);
  return {
    balanceUsd: reservation.balanceUsd,
    grantUsd: grant,
    server: Object.fromEntries(DIESEL_KEYS.map((n) => [n, Boolean(keys[n])])) as WalletStatus['server'],
  };
}

/** What a paid transaction left behind, `rpgPurchases/{txnId}` (`utils/rpg/paddle.ts`). */
export interface Purchase {
  txnId: string;
  uid: string;
  litres: number;
  /** Paddle's grand total, in the currency's minor units (grosze), as a string; refunds are a share of it. */
  totalMinor: string | null;
  currency: string | null;
  eventId: string | null;
  priceIds: string[];
  /** A subscription's delivery: it replaces what is left of the last one instead of adding to it. */
  subscriptionId?: string | null;
  /** The Paddle discount the buyer applied, which pours once per account (`DISCOUNTS_FIELD`); not set on renewals. */
  discountId?: string | null;
}

/**
 * Pours a purchase into the tank, once: the purchase document and the litres are one transaction, so
 * a webhook Paddle delivers twice (it retries until a 200) pours once. Grants the first tank too.
 */
export async function creditPurchase(p: Purchase): Promise<'credited' | 'duplicate' | 'repeat-discount'> {
  const grant = await grantUsd();
  const ref = walletDoc(p.uid);
  const purchase = db.collection(PURCHASES_COLLECTION).doc(p.txnId);
  const usd = p.litres / LITRES_PER_USD;
  return db.runTransaction(async (tx) => {
    const [done, snap] = await Promise.all([tx.get(purchase), tx.get(ref)]);
    if (done.exists) return 'duplicate' as const;
    const used = (snap.data()?.[DISCOUNTS_FIELD] ?? {}) as Record<string, unknown>;
    if (p.discountId && used[p.discountId] !== undefined) {
      // The account's second go with one code: kept for the record, nothing poured.
      tx.set(purchase, { ...p, subscriptionId: p.subscriptionId ?? null, usd: 0, expiredUsd: 0, status: 'repeat-discount', firstTxnId: used[p.discountId], at: Date.now(), adjustments: {} });
      return 'repeat-discount' as const;
    }
    const known = balanceOf(snap.data());
    const balance = known ?? grant;
    // A delivery: last period's litres that were not spent expire as this one comes in.
    const expired = p.subscriptionId ? subLeftOf(snap.data(), balance) : 0;
    tx.set(purchase, { ...p, subscriptionId: p.subscriptionId ?? null, usd, expiredUsd: expired, status: 'credited', at: Date.now(), adjustments: {} });
    tx.set(
      ref,
      {
        [BALANCE_FIELD]: balance - expired + usd,
        ...(p.subscriptionId
          ? { [SUB_BALANCE_FIELD]: usd, dieselSubExpiredUsd: FieldValue.increment(expired) }
          : {}),
        dieselBoughtUsd: FieldValue.increment(usd),
        ...(p.discountId ? { [DISCOUNTS_FIELD]: { [p.discountId]: p.txnId } } : {}),
        dieselUpdatedAt: Date.now(),
        ...(known === null ? { [GRANTED_FIELD]: Date.now(), dieselGrantUsd: grant } : {}),
      },
      { merge: true },
    );
    return 'credited' as const;
  });
}

/**
 * Takes a refund or a chargeback back out of the tank: `share` (0–1) of the purchase's litres, never
 * below an empty tank — litres already burnt are not clawed back from nothing. Once per adjustment.
 */
export async function debitAdjustment(
  txnId: string,
  adjustmentId: string,
  share: number,
  action: string,
): Promise<'debited' | 'duplicate' | 'unknown'> {
  const purchase = db.collection(PURCHASES_COLLECTION).doc(txnId);
  return db.runTransaction(async (tx) => {
    const done = await tx.get(purchase);
    const data = done.data() as (Purchase & { adjustments?: Record<string, unknown> }) | undefined;
    if (!done.exists || !data) return 'unknown' as const;
    if (data.adjustments?.[adjustmentId]) return 'duplicate' as const;
    const ref = walletDoc(data.uid);
    const balance = balanceOf((await tx.get(ref)).data()) ?? 0;
    const usd = (Math.max(0, Math.min(1, share)) * data.litres) / LITRES_PER_USD;
    const taken = Math.min(balance, usd);
    tx.set(purchase, { adjustments: { ...(data.adjustments ?? {}), [adjustmentId]: { action, share, usd, taken, at: Date.now() } }, status: share >= 1 ? action : `partial-${action}` }, { merge: true });
    tx.set(ref, { [BALANCE_FIELD]: balance - taken, dieselRefundedUsd: FieldValue.increment(usd), dieselUpdatedAt: Date.now() }, { merge: true });
    return 'debited' as const;
  });
}

/** The account a subscription belongs to, written on its first event and read by every renewal. */
export async function subscriptionOwner(subscriptionId: string, uid: string | null): Promise<string | null> {
  const ref = db.collection(SUBSCRIPTIONS_COLLECTION).doc(subscriptionId);
  if (uid) {
    await ref.set({ uid, at: Date.now() }, { merge: true });
    return uid;
  }
  const owner = (await ref.get()).data()?.uid;
  return typeof owner === 'string' && owner ? owner : null;
}

/** The subscription as the page shows it, on the reader's own ledger document. */
export async function showSubscription(uid: string, view: SubscriptionView): Promise<void> {
  await walletDoc(uid).set({ [SUB_FIELD]: view, dieselUpdatedAt: Date.now() }, { merge: true });
}

/**
 * The subscription ended: what is left of its last delivery goes with it (owner: diesel from the
 * subscription does not carry over). Bought litres stay.
 */
export async function endSubscription(uid: string, view: SubscriptionView): Promise<number> {
  const ref = walletDoc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const balance = balanceOf(snap.data()) ?? 0;
    const expired = subLeftOf(snap.data(), balance);
    tx.set(
      ref,
      { [BALANCE_FIELD]: balance - expired, [SUB_BALANCE_FIELD]: 0, [SUB_FIELD]: view, dieselSubExpiredUsd: FieldValue.increment(expired), dieselUpdatedAt: Date.now() },
      { merge: true },
    );
    return expired;
  });
}
