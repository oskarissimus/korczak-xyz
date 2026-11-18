/*
 * Paddle's webhook (`utils/rpg/paddle.ts`): the one way bought diesel reaches a tank.
 *
 * - **Signed, not authorised.** Paddle sends no Origin and no Firebase token, so this is routed in
 *   `handleRpgApi` before the CORS gate, and the only thing that lets a body through is its
 *   `Paddle-Signature`: HMAC-SHA256 of `ts:rawBody` under the destination's endpoint secret, which
 *   lives in `rpgPaddle/config.webhookSecret` (Firestore rather than Secret Manager, so a project
 *   without it — the game's own, before its destination exists — still deploys and simply refuses).
 * - **`transaction.paid` and `transaction.completed` both pour**, whichever comes first; the second
 *   finds `rpgPurchases/{txn}` and does nothing (`creditPurchase`).
 * - **Who and how much come from Paddle's own record**: the account is `custom_data.uid` the page
 *   set when it opened the checkout, the litres are on the prices (`litresOf`). A paid transaction
 *   with neither is kept as an orphan and reported, and still answered 200 — Paddle retrying it
 *   would not add the missing uid. Anything that failed on our side is a 500, so Paddle retries.
 * - **The monthly delivery** (`SUBSCRIPTION`) is a transaction like any other with a `subscription_id`:
 *   its litres replace what is left of the last delivery (`creditPurchase`), and a renewal finds its
 *   account in `rpgSubscriptions/{id}`. `subscription.*` keeps the page's view of it on the ledger and
 *   takes the last delivery's rest away when it ends — subscription diesel does not carry over.
 * - **A refund or a chargeback takes its share back** (`adjustment.created`/`updated` once
 *   approved): the adjustment's total over the transaction's, of the litres bought.
 * - **Only from Paddle's own addresses** (owner, 18 Nov 2026, for going live): before the signature,
 *   the sender (`callerIp`, the last `x-forwarded-for` entry — the one Google saw) must be in Paddle's
 *   published list, live (`api.paddle.com/ips`) and sandbox both, since one project's destination
 *   may be either account's. The list is read from Paddle, never written here, and refreshed hourly;
 *   a failed refresh keeps the last list. With no list at all (Paddle unreachable since a cold start)
 *   the signature alone decides and that is reported — refusing every delivery would lose money
 *   Paddle has already taken, while the signature is what actually proves the body.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';

import { PADDLE_CONFIG_DOC, PURCHASES_COLLECTION, litresOf, parseSignature } from '../../../korczak-xyz/src/utils/rpg/paddle';
import { creditPurchase, debitAdjustment, endSubscription, showSubscription, subscriptionOwner } from './wallet';
import type { SubscriptionView } from '../../../korczak-xyz/src/utils/rpg/paddle';
import { db } from '../runtime';
import { callerIp } from '../demo/limits';
import { reportError } from '../sentry';

/** How old a signature may be: Paddle signs each delivery afresh, retries included. */
const MAX_AGE_S = 300;

let secretCache: { at: number; secrets: string[] } | null = null;
async function webhookSecrets(): Promise<string[]> {
  if (secretCache && Date.now() - secretCache.at < 60_000) return secretCache.secrets;
  const data = (await db.doc(PADDLE_CONFIG_DOC.join('/')).get()).data() ?? {};
  const raw = [data.webhookSecret, ...(Array.isArray(data.webhookSecrets) ? data.webhookSecrets : [])];
  const secrets = raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
  secretCache = { at: Date.now(), secrets };
  return secrets;
}

/** Paddle's published sender addresses: the source of truth, never a list in the code. */
export const PADDLE_IP_LISTS = ['https://api.paddle.com/ips', 'https://sandbox-api.paddle.com/ips'];
const IP_TTL_MS = 3_600_000;
let ipCache: { at: number; cidrs: string[] } | null = null;

async function paddleCidrs(): Promise<string[] | null> {
  if (ipCache && Date.now() - ipCache.at < IP_TTL_MS) return ipCache.cidrs;
  try {
    const lists = await Promise.all(
      PADDLE_IP_LISTS.map(async (url) => {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        const cidrs = ((await r.json()) as { data?: { ipv4_cidrs?: unknown } }).data?.ipv4_cidrs;
        if (!Array.isArray(cidrs) || !cidrs.length) throw new Error(`${url}: no ipv4_cidrs`);
        return cidrs.filter((c): c is string => typeof c === 'string');
      }),
    );
    ipCache = { at: Date.now(), cidrs: lists.flat() };
  } catch (e) {
    reportError('rpgPaddle.ips', e);
    if (ipCache) ipCache.at = Date.now() - IP_TTL_MS + 300_000; // keep the last list, try again in 5 min
  }
  return ipCache?.cidrs ?? null;
}

function ipv4(ip: string): number | null {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some((n) => n > 255) ? null : ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

/** Whether `ip` is inside one of `cidrs` (IPv4; Paddle publishes /32s, any prefix works). */
export function inCidrs(ip: string, cidrs: readonly string[]): boolean {
  const a = ipv4(ip);
  if (a === null) return false;
  return cidrs.some((c) => {
    const [base, bits = '32'] = c.split('/');
    const b = ipv4(base);
    const n = Number(bits);
    if (b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

/** For the tests: forget the cached list. */
export function resetPaddleIps(): void {
  ipCache = null;
}

/** Whether `raw` was signed by one of `secrets` within `MAX_AGE_S` of `nowS`. */
export function verifySignature(raw: Buffer, header: string | undefined, secrets: readonly string[], nowS = Date.now() / 1000): boolean {
  const sig = parseSignature(header);
  if (!sig || !secrets.length) return false;
  const ts = Number(sig.ts);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > MAX_AGE_S) return false;
  for (const secret of secrets) {
    const want = createHmac('sha256', secret).update(`${sig.ts}:`).update(raw).digest();
    for (const h1 of sig.h1) {
      const got = Buffer.from(h1, 'hex');
      if (got.length === want.length && timingSafeEqual(got, want)) return true;
    }
  }
  return false;
}

interface PaddleEvent {
  event_id?: string;
  event_type?: string;
  data?: Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

async function onPaid(event: PaddleEvent): Promise<string> {
  const data = event.data ?? {};
  const txnId = str(data.id);
  if (!txnId) return 'no-id';
  const subscriptionId = str(data.subscription_id);
  // A renewal names its account through the subscription; the first payment names it itself.
  const named = str((data.custom_data as Record<string, unknown> | null)?.uid);
  const uid = subscriptionId ? await subscriptionOwner(subscriptionId, named) : named;
  const litres = litresOf(data.items);
  const details = data.details as { totals?: { grand_total?: unknown } } | undefined;
  const totalMinor = str(details?.totals?.grand_total);
  const currency = str(data.currency_code);
  const priceIds = Array.isArray(data.items)
    ? (data.items as { price?: { id?: unknown } }[]).map((i) => str(i?.price?.id)).filter((s): s is string => s !== null)
    : [];
  if (!uid || !(litres > 0)) {
    // Paid, but nobody to pour it into: kept for the owner to sort out by hand, and reported.
    await db.doc(`${PURCHASES_COLLECTION}/${txnId}`).set(
      { txnId, uid, litres, totalMinor, currency, priceIds, eventId: str(event.event_id), status: 'orphan', at: Date.now() },
      { merge: true },
    );
    reportError('rpgApi.paddle.orphan', new Error(`paddle: paid transaction ${txnId} has ${uid ? 'no litres' : 'no uid'}`), { txnId });
    return 'orphan';
  }
  return creditPurchase({ txnId, uid, litres, totalMinor, currency, eventId: str(event.event_id), priceIds, subscriptionId });
}

function viewOf(data: Record<string, unknown>): SubscriptionView | null {
  const id = str(data.id);
  const status = str(data.status);
  if (!id || !status) return null;
  const urls = (data.management_urls ?? {}) as Record<string, unknown>;
  const change = data.scheduled_change as { action?: unknown; effective_at?: unknown } | null | undefined;
  return {
    id,
    status,
    nextBilledAt: str(data.next_billed_at),
    endsAt: change && change.action === 'cancel' ? str(change.effective_at) : null,
    cancelUrl: str(urls.cancel),
    updatePaymentUrl: str(urls.update_payment_method),
  };
}

/**
 * `subscription.created`/`updated`/`canceled`: the subscription as the page shows it (with Paddle's
 * own cancel link — the gateway holds no Paddle API key to open a customer portal), and on the end
 * of it, the rest of its last delivery taken away.
 */
async function onSubscription(event: PaddleEvent): Promise<string> {
  const data = event.data ?? {};
  const view = viewOf(data);
  if (!view) return 'no-id';
  const uid = await subscriptionOwner(view.id, str((data.custom_data as Record<string, unknown> | null)?.uid));
  if (!uid) {
    reportError('rpgApi.paddle.subscription', new Error(`paddle: subscription ${view.id} has no account`), { subscriptionId: view.id });
    return 'orphan';
  }
  if (view.status === 'canceled') {
    await endSubscription(uid, view);
    return 'ended';
  }
  await showSubscription(uid, view);
  return 'shown';
}

async function onAdjustment(event: PaddleEvent): Promise<string> {
  const data = event.data ?? {};
  const action = str(data.action);
  if (data.status !== 'approved' || (action !== 'refund' && action !== 'chargeback')) return 'ignored';
  const txnId = str(data.transaction_id);
  const adjId = str(data.id);
  if (!txnId || !adjId) return 'no-id';
  const purchase = (await db.doc(`${PURCHASES_COLLECTION}/${txnId}`).get()).data();
  const total = Number(purchase?.totalMinor);
  const amount = Number((data.totals as { total?: unknown } | undefined)?.total);
  const share = Number.isFinite(total) && total > 0 && Number.isFinite(amount) ? amount / total : 1;
  const result = await debitAdjustment(txnId, adjId, share, action);
  if (result === 'unknown') reportError('rpgApi.paddle.adjustment', new Error(`paddle: ${action} for unknown transaction ${txnId}`), { txnId, adjId });
  return result;
}

export async function handlePaddleWebhook(req: Request, res: Response, raw: Buffer | undefined): Promise<void> {
  if (req.method !== 'POST' || !raw) {
    res.status(405).json({ reason: 'method' });
    return;
  }
  const cidrs = await paddleCidrs();
  const from = callerIp(req.headers['x-forwarded-for'] as string | undefined, req.ip);
  if (cidrs && !inCidrs(from, cidrs)) {
    reportError('rpgPaddle.source', new Error(`webhook from ${from}, not a Paddle address`));
    res.status(403).json({ reason: 'source' });
    return;
  }
  const header = req.headers['paddle-signature'];
  if (!verifySignature(raw, typeof header === 'string' ? header : undefined, await webhookSecrets())) {
    res.status(401).json({ reason: 'signature' });
    return;
  }
  let event: PaddleEvent;
  try {
    event = JSON.parse(raw.toString('utf8')) as PaddleEvent;
  } catch {
    res.status(400).json({ reason: 'body' });
    return;
  }
  const type = event.event_type ?? '';
  const outcome =
    type === 'transaction.paid' || type === 'transaction.completed'
      ? await onPaid(event)
      : type === 'adjustment.created' || type === 'adjustment.updated'
        ? await onAdjustment(event)
        : type === 'subscription.created' || type === 'subscription.updated' || type === 'subscription.canceled'
          ? await onSubscription(event)
          : 'ignored';
  res.status(200).json({ ok: true, outcome });
}
