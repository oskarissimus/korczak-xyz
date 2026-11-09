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
  DIESEL_KEYS,
  GRANTED_FIELD,
  WALLET_COLLECTION,
  balanceOf,
  grantOf,
  type WalletStatus,
} from '../../../korczak-xyz/src/utils/rpg/wallet';
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
  const write: Record<string, unknown> = { dieselSpentUsd: FieldValue.increment(spent), dieselUpdatedAt: Date.now() };
  if (refund > 0) write[BALANCE_FIELD] = FieldValue.increment(refund);
  await walletDoc(uid).set(write, { merge: true });
}

/** Adds to an account's tank (the panel's top-up; later, a purchase). Grants the first tank too. */
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
