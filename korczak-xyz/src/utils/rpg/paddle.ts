/*
 * Buying diesel through Paddle (owner, 14 Nov 2026: the packs 20/40/99 zł for 250/550/1400 L).
 * Paddle is the merchant of record: it takes the card, BLIK, Apple Pay, Google Pay or PayPal, adds
 * and remits the VAT, and sends the gateway a signed webhook when the money is in.
 *
 * COMPILED TWICE, like `wallet.ts`: the page opens the checkout with a price id from here, and the
 * gateway (`functions/src/rpg/paddle.ts`) reads the litres back out of the same webhook shape with
 * `litresOf`. Nothing here may import the DOM, Firebase or React.
 *
 * THE PAGE NEVER SAYS HOW MANY LITRES. It names a price and the account (`customData.uid`); the
 * litres are `custom_data.litres` on the price inside Paddle, so what is poured is what was paid
 * for, whatever the page sent. The webhook is signed with a secret only the gateway holds.
 *
 * SANDBOX FOR NOW: the account is not verified for live payments yet. The token and the price ids
 * below are sandbox objects (product "Diesel", `pro_01m7daxkazw506xzkp27r7ynq4`) and are public by
 * design — a client-side token can only open a checkout. Going live is a new token and three new
 * price ids here, `environment: 'production'`, and a live notification destination.
 */

import type { Canister } from './diesel';

export const PADDLE = {
  environment: 'sandbox' as 'sandbox' | 'production',
  token: 'test_a6f1d7ba50e4f6e6de42e33bf37',
  prices: {
    can: 'pri_01m7daxkc4b6w327j494v88pyr',
    barrel: 'pri_01m7daxkda4nmg96q4r6eq8y8v',
    tank: 'pri_01m7daxke7fw2e6fmhvj4kyqgw',
  } satisfies Record<Canister['id'], string>,
};

/** Where Paddle sends its webhooks: `rpgApi/paddle/webhook`, outside CORS (no Origin, a signature instead). */
export const PADDLE_WEBHOOK_PATH = '/paddle/webhook';

/** The endpoint secret(s) from Paddle's notification destination: `rpgPaddle/config`, no rule (Admin SDK only). */
export const PADDLE_CONFIG_DOC = ['rpgPaddle', 'config'] as const;

/** One document per Paddle transaction, `rpgPurchases/{txn_id}`, no rule: what makes a webhook idempotent. */
export const PURCHASES_COLLECTION = 'rpgPurchases';

interface PaddleItem {
  quantity?: unknown;
  price?: { id?: unknown; custom_data?: { litres?: unknown } | null } | null;
}

/** The litres a transaction paid for: each item's price's `custom_data.litres` times its quantity. */
export function litresOf(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const item of items as PaddleItem[]) {
    const l = Number(item?.price?.custom_data?.litres);
    const q = Number(item?.quantity ?? 1);
    if (Number.isFinite(l) && l > 0 && Number.isFinite(q) && q > 0) total += l * Math.floor(q);
  }
  return total;
}

/** Paddle's `Paddle-Signature: ts=…;h1=…` header, split; several `h1` while a secret is being rotated. */
export function parseSignature(header: string | undefined | null): { ts: string; h1: string[] } | null {
  if (!header) return null;
  let ts = '';
  const h1: string[] = [];
  for (const part of header.split(';')) {
    const [k, v] = part.split('=', 2).map((s) => s?.trim() ?? '');
    if (k === 'ts') ts = v;
    else if (k === 'h1' && v) h1.push(v);
  }
  return ts && h1.length ? { ts, h1 } : null;
}
