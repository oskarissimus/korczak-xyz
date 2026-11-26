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
 * given back — or, when it cost more than reserved, taken too, so the tank may end below zero and
 * refuses the next request until it is filled (security audit, 26 Nov 2026: the overrun used to be
 * the owner's). A request whose price is unknown, or a stream cut before its usage arrived, keeps the
 * reservation. And diesel pays only for requests shaped as the game sends them (`dieselRefusal`).
 */

import { MAX_OUTPUT_TOKENS, beatReservation } from './demoLimits';
import { GEMINI_IMAGE_RATES, costUpfront, isFalFollowUp, type GatewayTarget } from './gatewayRoutes';
import { tokenPrice } from './cost';
import type { KeyName } from '../accountKeys/keys';

/** The gateway's own endpoint: the balance, granting the first tank to a new account. */
export const WALLET_PATH = '/wallet';

/** Where the balance sits: `rpgLedger/{uid}`, fields below. */
export const WALLET_COLLECTION = 'rpgLedger';
export const BALANCE_FIELD = 'dieselUsd';
export const GRANTED_FIELD = 'dieselGrantedAt';

/** The panel's diesel settings: `rpgDiesel/config`, no Firestore rule (Admin SDK only). */
export const DIESEL_CONFIG_DOC = ['rpgDiesel', 'config'] as const;

/**
 * What a new account finds in its tank unless the panel says otherwise: the sign-up bonus, 400 L (owner,
 * 23 Nov 2026; it was 100 L). Poured once — nothing refills it for free, not monthly, not daily.
 */
export const DEFAULT_GRANT_USD = 4;
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

/**
 * Each Paddle discount pours once per account (owner, 20 Nov 2026: "one person may use a code only
 * once — I want to share it in a group chat and not have one person fill up to the brim"). Paddle's
 * `usage_limit` is only a total, so `rpgLedger/{uid}.paddleDiscounts` maps each discount the account
 * redeemed to its transaction: the webhook pours a second one for nothing, and the checkout closes
 * the moment a used code is applied, before it costs one of the code's uses.
 */
export const DISCOUNTS_FIELD = 'paddleDiscounts';

/** The discounts the ledger says this account has redeemed. */
export function discountsOf(data: Record<string, unknown> | undefined): string[] {
  const m = data?.[DISCOUNTS_FIELD];
  return m && typeof m === 'object' ? Object.keys(m as Record<string, unknown>) : [];
}

export interface WalletStatus {
  /** What is left, in dollars (said in litres). */
  balanceUsd: number;
  /** What a new account is given, for the plant's scale. */
  grantUsd: number;
  /** Which of the server's keys exist: diesel stands in only for those. */
  server: Record<DieselKey, boolean>;
  /** Of `balanceUsd`, this month's subscription delivery, which expires (`paddle.ts`); read live off the ledger. */
  subUsd?: number;
  /** The monthly delivery, when there is one (read live off the ledger). */
  subscription?: import('./paddle').SubscriptionView | null;
  /** Paddle discounts this account has redeemed, each once (`DISCOUNTS_FIELD`; read live off the ledger). */
  discountsUsed?: string[];
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
      // What the game itself does on the server's ElevenLabs key: speak, compose, design a voice and
      // keep its own designed voices tidy. Listing and deleting are for the game's voices only, which
      // the gateway checks before a DELETE goes on (`dieselVoiceDelete` in `functions/src/rpg/gateway.ts`).
      if (m === 'POST') return /^\/v1\/(?:text-to-speech\/\w+(?:\/stream)?|text-to-dialogue|music(?:\/stream)?|text-to-voice(?:\/design)?)$/.test(target.path);
      if (m === 'GET') return target.path === '/v2/voices' || target.path === '/v1/shared-voices';
      return m === 'DELETE' && /^\/v1\/voices\/\w+$/.test(target.path);
    case 'fal':
      return true;
    default:
      return false;
  }
}

/** The name every voice the game designs carries (`voiceDesign.ts`); diesel deletes no other. */
export const GAME_VOICE_PREFIX = 'rpg · ';

/** The longest score diesel composes: the game asks for `MUSIC_MS` (2 min). */
export const DIESEL_MUSIC_MAX_MS = 180_000;

/** A fal.ai app's namespace, the first two segments (`fal-ai/meshy`), which its queue follow-ups share. */
function falNamespace(app: string): string {
  return app.split('/').slice(0, 2).join('/');
}

/**
 * What diesel will not pay for, in words, or null when it may (security audit, 26 Nov 2026).
 *
 * A reservation is a guess made from the request's own body, which whoever sends it writes. So diesel
 * pays only for what the game itself asks for, in the shape it asks for it: fal.ai apps with a price
 * in `falCost` (any other app was a $0.25 reservation for a video costing dollars), one picture at a
 * time, models with a list price, one answer per request, no tools, no fetched files (a YouTube link
 * in `fileData` is a few characters in the body and a million tokens at the model), and a score of a
 * stated length (an absent `music_length_ms` priced it at $0). Everything here the game never sends.
 */
export function dieselRefusal(target: GatewayTarget, method: string, body: Record<string, unknown>): string | null {
  const m = method.toUpperCase();
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
  if (target.provider === 'fal') {
    if (target.host === 'rest.alpha.fal.ai') return null;
    const app = target.path.slice(1);
    if (isFalFollowUp(target.path) || m !== 'POST') {
      const ns = falNamespace(app);
      return DIESEL_FAL_APPS.some((a) => falNamespace(a) === ns) ? null : `fal.ai app ${ns} is not one the game uses`;
    }
    if (!(DIESEL_FAL_APPS as readonly string[]).includes(app)) return `fal.ai app ${app} is not one the game uses`;
    if (body.num_images !== undefined && num(body.num_images) !== 1) return 'one picture at a time';
    return null;
  }
  if (target.provider === 'google') {
    const model = /^\/v1beta\/models\/([^:]+):/.exec(target.path)?.[1] ?? '';
    if (!GEMINI_IMAGE_RATES[model] && beatReservation(model, 0) === null) return `model ${model} has no price`;
    if (body.tools !== undefined || body.toolConfig !== undefined) return 'no tools';
    if (JSON.stringify(body.contents ?? '').includes('"fileData"') || JSON.stringify(body.contents ?? '').includes('"file_data"')) return 'no fetched files';
    const config = (body.generationConfig ?? body.generation_config ?? {}) as Record<string, unknown>;
    if (config.candidateCount !== undefined && num(config.candidateCount) > 1) return 'one answer per request';
    if (config.maxOutputTokens !== undefined && !(num(config.maxOutputTokens) <= MAX_OUTPUT_TOKENS)) return `at most ${MAX_OUTPUT_TOKENS} output tokens`;
    return null;
  }
  if (target.provider === 'openai') {
    const model = typeof body.model === 'string' ? body.model : '';
    if (!tokenPrice(model)) return `model ${model || '?'} has no price`;
    if (body.tools !== undefined || body.functions !== undefined) return 'no tools';
    if (body.n !== undefined && num(body.n) > 1) return 'one answer per request';
    for (const k of ['max_tokens', 'max_completion_tokens']) {
      if (body[k] !== undefined && !(num(body[k]) <= MAX_OUTPUT_TOKENS)) return `at most ${MAX_OUTPUT_TOKENS} output tokens`;
    }
    return null;
  }
  if (target.provider === 'elevenlabs' && m === 'POST' && target.path.startsWith('/v1/music')) {
    const ms = num(body.music_length_ms);
    return ms > 0 && ms <= DIESEL_MUSIC_MAX_MS ? null : `a score of 1 ms to ${DIESEL_MUSIC_MAX_MS / 1000} s, stated`;
  }
  return null;
}

/** The fal.ai apps the game asks for: exactly those `falCost` prices. */
export const DIESEL_FAL_APPS = [
  'fal-ai/flux/schnell',
  'fal-ai/flux/dev',
  'fal-ai/flux-2',
  'fal-ai/nano-banana',
  'fal-ai/nano-banana-2',
  'fal-ai/nano-banana-2.1',
  'fal-ai/nano-banana-lite',
  'fal-ai/trellis',
  'fal-ai/trellis-2',
  'tripo3d/tripo/v2.5/image-to-3d',
  'fal-ai/hunyuan3d/v2',
  'fal-ai/meshy/rigging',
  'fal-ai/meshy/v6/image-to-3d',
  'fal-ai/meshy/v6/text-to-3d',
  'fal-ai/birefnet/v2',
] as const;

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
