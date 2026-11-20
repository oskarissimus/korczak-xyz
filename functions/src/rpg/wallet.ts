/*
 * The diesel tank on the server: a signed-in reader with no key of their own is paid for out of
 * `rpgLedger/{uid}.dieselUsd`, on the server's keys from the admin panel. The rules, the names and
 * the reservation are in `utils/rpg/wallet.ts`; this file is the Firestore half.
 *
 * - **The first tank is granted once**, the first time the account asks (`/wallet`, or its first
 *   request on diesel): `grantUsd` from `rpgDiesel/config` (the panel), 100 L by default.
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
import { db } from '../runtime';

function walletDoc(uid: string) {
  return db.collection(WALLET_COLLECTION).doc(uid);
}

function configDoc() {
  return db.collection(DIESEL_CONFIG_DOC[0]).doc(DIESEL_CONFIG_DOC[1]);
}

/** The first tank, kept a minute per instance: it is read on every request on diesel. */
let grantCache: { at: number; usd: number } | null = null;
export async function grantUsd(): Promise<number> {
  if (grantCache && Date.now() - grantCache.at < 60_000) return grantCache.usd;
  const usd = grantOf((await configDoc().get()).data());
  grantCache = { at: Date.now(), usd };
  return usd;
}

export type Reservation = { ok: true; balanceUsd: number } | { ok: false; balanceUsd: number };

/**
 * Takes `usd` out of the tank, granting the first tank if the account never had one. Refused when it
 * does not fit; `free` lets a follow-up of paid work through on any balance (nothing is taken).
 */
export async function reserveDiesel(uid: string, usd: number, free = false): Promise<Reservation> {
  const grant = await grantUsd();
  const ref = walletDoc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const known = balanceOf(snap.data());
    const balance = known ?? grant;
    const fresh = known === null ? { [GRANTED_FIELD]: Date.now(), dieselGrantUsd: grant } : {};
    if (free) {
      if (known === null) tx.set(ref, { [BALANCE_FIELD]: balance, ...fresh }, { merge: true });
      return { ok: true as const, balanceUsd: balance };
    }
    // Nothing on an empty tank, not even a model that costs nothing: diesel is the gate.
    if (!(balance > 0) || usd > balance) {
      if (known === null) tx.set(ref, { [BALANCE_FIELD]: balance, ...fresh }, { merge: true });
      return { ok: false as const, balanceUsd: balance };
    }
    tx.set(ref, { [BALANCE_FIELD]: balance - usd, dieselUpdatedAt: Date.now(), ...fresh }, { merge: true });
    return { ok: true as const, balanceUsd: balance - usd };
  });
}

/**
 * Settles a reservation: what it cost is spent (never more than was reserved), the rest goes back.
 * `actual` null — a price nobody knows, a stream cut before its usage — keeps the whole reservation.
 */
export async function settleDiesel(uid: string, reserved: number, actual: number | null): Promise<void> {
  const spent = actual === null ? reserved : Math.min(reserved, Math.max(0, actual));
  const refund = reserved - spent;
  // The month's delivery is spent first (`SUBSCRIPTION`): what it held goes down by what was spent.
  // It may run below zero for an account with none; it is read clamped (`subLeftOf`).
  const write: Record<string, unknown> = {
    dieselSpentUsd: FieldValue.increment(spent),
    [SUB_BALANCE_FIELD]: FieldValue.increment(-spent),
    dieselUpdatedAt: Date.now(),
  };
  if (refund > 0) write[BALANCE_FIELD] = FieldValue.increment(refund);
  await walletDoc(uid).set(write, { merge: true });
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
export async function walletStatus(uid: string): Promise<WalletStatus> {
  const [reservation, keys, grant] = await Promise.all([reserveDiesel(uid, 0, true), readServerKeys(), grantUsd()]);
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
