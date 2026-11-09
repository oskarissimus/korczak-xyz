/*
 * Diesel as a balance: a signed-in reader with no key of their own plays on the server's keys (set on
 * the admin panel, `rpgServerKeys/config`), and every request is paid out of their tank (owner,
 * 9 Nov 2026: "make the demo and signed-in use run on the server keys, gated by the amount of
 * diesel").
 *
 * COMPILED TWICE: the gateway (`functions/src/rpg/wallet.ts`, `gateway.ts`) decides from these, and
 * the game reads the same names and numbers. Nothing here may import the DOM, Firebase or React.
 *
 * DOLLARS ON DISK, LITRES ON SCREEN, as everywhere else (`diesel.ts`: one litre is one cent at list
 * price). The balance is `dieselUsd` on `rpgLedger/{uid}`, beside the running total the ledger
 * already kept, so "how much was spent" and "how much is left" are one document. The reader may read
 * that one document (`firestore.rules`) and nothing writes it but the Admin SDK.
 *
 * THE SAME RESERVATION AS THE DEMO'S (`demoLimits.ts`): before a request is passed on, its worst case
 * is taken out of the tank in a transaction, and afterwards the difference to what it really cost is
 * given back. So the tank cannot go below zero, only approach it; a request whose price is unknown,
 * or a stream cut before its usage arrived, keeps the reservation.
 */

import { MAX_OUTPUT_TOKENS, beatReservation } from './demoLimits';
import { GEMINI_IMAGE_RATES, costUpfront, isFalFollowUp, type GatewayTarget } from './gatewayRoutes';
import { tokenPrice } from './cost';
import type { KeyName } from '../accountKeys/keys';

/** The gateway's own endpoint: the balance, granting the first tank to a new account. */
export const WALLET_PATH = '/wallet';
/** An admin's canister: poured for free, no payment (owner, 9 Nov 2026: "when I click refuel and I'm admin I should get more fuel without needing to pay"). */
export const REFUEL_PATH = '/wallet/refuel';

/** Where the balance sits: `rpgLedger/{uid}`, fields below. */
export const WALLET_COLLECTION = 'rpgLedger';
export const BALANCE_FIELD = 'dieselUsd';
export const GRANTED_FIELD = 'dieselGrantedAt';

/** The panel's diesel settings: `rpgDiesel/config`, no Firestore rule (Admin SDK only). */
export const DIESEL_CONFIG_DOC = ['rpgDiesel', 'config'] as const;

/** What a new account finds in its tank unless the panel says otherwise: 100 L, about one world played through. */
export const DEFAULT_GRANT_USD = 1;
/** The most the panel may set as the first tank, and the most one top-up may add. */
export const MAX_GRANT_USD = 20;
export const MAX_TOPUP_USD = 100;

/** The keys diesel can stand in for: the server's, as the panel names them. */
export const DIESEL_KEYS = ['google', 'elevenLabs', 'fal', 'openai'] as const satisfies readonly KeyName[];
export type DieselKey = (typeof DIESEL_KEYS)[number];

/** Says, in the 402's words, that the tank is what ran out — not a provider's balance. */
export const NO_DIESEL = 'no-diesel';

/** A worst case for what has no price before its answer and none in the tables after: kept whole. */
const UNKNOWN_USD = 0.25;
/** A picture from Gemini's own API: about 1,300 image tokens; reserved with room. */
const IMAGE_TOKENS = 4096;

export interface WalletStatus {
  /** What is left, in dollars (said in litres). */
  balanceUsd: number;
  /** What a new account is given, for the plant's scale. */
  grantUsd: number;
  /** Which of the server's keys exist: diesel stands in only for those. */
  server: Record<DieselKey, boolean>;
}

/**
 * Whether diesel may pay for this request at all. Only the game's own requests — the page marks them
 * (`x-rpg-keep`), the gateway is every app's — and only the routes the game makes: not sloper's
 * pictures, not the key checks, not DeepSeek or the audio guide.
 */
export function dieselRoute(target: GatewayTarget, method: string): boolean {
  const m = method.toUpperCase();
  switch (target.provider) {
    case 'google':
      return m === 'POST' && /:(?:streamGenerateContent|generateContent)$/.test(target.path);
    case 'openai':
      return m === 'POST' && target.path === '/v1/chat/completions';
    case 'elevenlabs':
      return target.path !== '/v1/user' && target.path !== '/v1/user/subscription' && target.path !== '/v1/voices';
    case 'fal':
      return true;
    default:
      return false;
  }
}

/**
 * The most this request can cost, reserved before it is made: a clip, the score and a fal.ai job
 * are priced exactly up front; a model's answer is the whole prompt in and the whole output budget
 * out at its price. A follow-up (a fal.ai status, its result, an upload, a library search) costs
 * nothing.
 */
export function dieselReservation(target: GatewayTarget, method: string, body: Record<string, unknown>, bodyChars: number): number {
  const upfront = costUpfront(target, body);
  if (upfront !== null) return upfront;
  const m = method.toUpperCase();
  if (target.provider === 'fal') {
    if (target.host === 'rest.alpha.fal.ai' || isFalFollowUp(target.path) || m === 'GET') return 0;
    return UNKNOWN_USD;
  }
  if (target.provider === 'elevenlabs') {
    // A library search or a voice deleted is free; a voice designed is priced by nobody up front.
    return m === 'POST' ? 0.05 : 0;
  }
  if (target.provider === 'google') {
    const model = /^\/v1beta\/models\/([^:]+):/.exec(target.path)?.[1] ?? '';
    const image = GEMINI_IMAGE_RATES[model];
    if (image) return (bodyChars * image.input + IMAGE_TOKENS * image.image) / 1_000_000;
    return beatReservation(model, bodyChars) ?? UNKNOWN_USD;
  }
  if (target.provider === 'openai') {
    const price = tokenPrice(typeof body.model === 'string' ? body.model : '');
    if (!price) return UNKNOWN_USD;
    return (bodyChars * price.input + MAX_OUTPUT_TOKENS * price.output) / 1_000_000;
  }
  return UNKNOWN_USD;
}

/** A follow-up of work already paid for: let through on any balance, even an empty one. */
export function isFollowUp(target: GatewayTarget, method: string): boolean {
  return target.provider === 'fal' && (target.host === 'rest.alpha.fal.ai' || isFalFollowUp(target.path) || method.toUpperCase() === 'GET');
}

/** The balance out of the ledger's document; a missing one is an account never granted. */
export function balanceOf(data: Record<string, unknown> | undefined): number | null {
  if (!data || data[GRANTED_FIELD] === undefined) return null;
  const v = data[BALANCE_FIELD];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** The first tank, from the panel's document. */
export function grantOf(data: Record<string, unknown> | undefined): number {
  const v = data?.grantUsd;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_GRANT_USD ? v : DEFAULT_GRANT_USD;
}

/**
 * The keys the game passes around for a reader on diesel: their own where they have one, the
 * account's handle where only the server has one — the gateway then pays it from the tank.
 */
export function fuelKeys<K extends Partial<Record<KeyName, string | null>>>(own: K, server: Record<DieselKey, boolean>, handle: string): K {
  const out = { ...own };
  for (const name of DIESEL_KEYS) {
    if (!out[name] && server[name]) (out as Record<string, string | null>)[name] = handle;
  }
  return out;
}
