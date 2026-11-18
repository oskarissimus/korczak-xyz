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
 * The token and the price ids are in `paddleConfig.ts`, read from the build's env: this file is
 * compiled into the functions too, where there is no `import.meta.env`.
 */

/** Where Paddle sends its webhooks: `rpgApi/paddle/webhook`, outside CORS (no Origin, a signature instead). */
export const PADDLE_WEBHOOK_PATH = '/paddle/webhook';

/** The endpoint secret(s) from Paddle's notification destination: `rpgPaddle/config`, no rule (Admin SDK only). */
export const PADDLE_CONFIG_DOC = ['rpgPaddle', 'config'] as const;

/** One document per Paddle transaction, `rpgPurchases/{txn_id}`, no rule: what makes a webhook idempotent. */
export const PURCHASES_COLLECTION = 'rpgPurchases';

/** Which account a Paddle subscription pours into, `rpgSubscriptions/{sub_id}`, no rule: a renewal finds its uid here. */
export const SUBSCRIPTIONS_COLLECTION = 'rpgSubscriptions';

/** On `rpgLedger/{uid}`: the part of `dieselUsd` that is this period's delivery, and expires with it. */
export const SUB_BALANCE_FIELD = 'dieselSubUsd';
/** On `rpgLedger/{uid}`: the subscription as the page shows it (`SubscriptionView`). */
export const SUB_FIELD = 'dieselSub';

/** What the reader's own ledger document says about their subscription; the page reads it live. */
export interface SubscriptionView {
  id: string;
  /** Paddle's: `active`, `trialing`, `past_due`, `paused`, `canceled`. */
  status: string;
  /** When the next delivery comes (and this one's litres expire), ISO; null once it ends. */
  nextBilledAt: string | null;
  /** Set when a cancellation is scheduled for the period's end, ISO. */
  endsAt: string | null;
  /** Paddle's own page to cancel, and to change the card — from the subscription's `management_urls`. */
  cancelUrl: string | null;
  updatePaymentUrl: string | null;
}

/** The delivery still in the tank: never more than the tank itself (spending may have run ahead). */
export function subLeftOf(data: Record<string, unknown> | undefined, balance: number): number {
  const v = data?.[SUB_BALANCE_FIELD];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(balance, v)) : 0;
}

/** The subscription off the ledger document, or null when there is none to show. */
export function subscriptionOf(data: Record<string, unknown> | undefined): SubscriptionView | null {
  const v = data?.[SUB_FIELD] as Partial<SubscriptionView> | undefined;
  return v && typeof v.id === 'string' && typeof v.status === 'string' && v.status !== 'canceled'
    ? {
        id: v.id,
        status: v.status,
        nextBilledAt: typeof v.nextBilledAt === 'string' ? v.nextBilledAt : null,
        endsAt: typeof v.endsAt === 'string' ? v.endsAt : null,
        cancelUrl: typeof v.cancelUrl === 'string' ? v.cancelUrl : null,
        updatePaymentUrl: typeof v.updatePaymentUrl === 'string' ? v.updatePaymentUrl : null,
      }
    : null;
}

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
