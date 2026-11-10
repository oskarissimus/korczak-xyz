/*
 * The log of every paid request, the half both runtimes share (`functions/src/rpg/requestLog.ts`
 * writes it, `components/Rpg/AdminCosts.tsx` reads it).
 *
 * Owner, 10 Nov 2026: "every request to an outside API we pay for should be saved — the request,
 * the response, and the price; if the response states it, good, if not we need a price list and a
 * way of computing it". So:
 *
 * - **The record** is a Firestore document, `rpgRequests/{id}`: who, what for (world, quest),
 *   provider, endpoint, model, status, how long, the usage the provider reported, the price with how
 *   it was worked out (`basis`) and where the number came from (`source`), and the USD/PLN rate of
 *   that day (NBP). Small and queryable — the dashboard is built from these alone. Top level with no
 *   Firestore rule, like `rpgLedger`: only the Admin SDK reads it, and the panel reads it through the
 *   gateway's `/admin/requests`, which checks `admins/{uid}`.
 * - **The bodies** — the request as sent (keys never: they travel in headers this log does not keep)
 *   and the answer as it came, an event stream as text — are one JSON file in the game's bucket,
 *   `requests/{day}/{id}.json`. They are megabytes where the record is a kilobyte, nobody queries
 *   them, and Firestore caps a document at 1 MiB; the panel fetches one on demand
 *   (`/admin/request?id=`). Inline base64 is cut to its length, audio is kept as its size.
 *
 * What is logged: every request on the server's keys (diesel, the demo, the key test) — what we pay
 * for — and the game's requests on a signed-in reader's own key (`account`), which the owner's own
 * play goes through on korczak.xyz and which show whether the pricing is right just as well. A
 * signed-out reader's own key (`byok`) is never kept: the server promised to keep nothing of it.
 * Free requests (a status poll, a model list, a library search) are not logged.
 */

import { MUSIC_CREDITS_PER_MINUTE, tokenPrice, USD_PER_VOICE_CREDIT, voiceCreditsPerChar } from './cost';
import type { GatewayProvider, GatewayTarget } from './gatewayRoutes';
import { GEMINI_IMAGE_RATES, isFalFollowUp } from './gatewayRoutes';

export const REQUEST_LOG_COLLECTION = 'rpgRequests';
export const ADMIN_REQUESTS_PATH = '/admin/requests';
export const ADMIN_REQUEST_PATH = '/admin/request';

/** Who paid: the server's keys out of a tank, the demo, the panel's key test; or the reader's own account key. */
export type LogPayer = 'diesel' | 'demo' | 'test' | 'account';

/**
 * Where the price came from:
 * - `provider` — the provider said it in the answer (ElevenLabs' `character-cost`, in credits);
 * - `usage` — the provider's token counts × our price list;
 * - `list` — our price list alone, before the answer (a fal.ai job, a clip by its characters);
 * - `none` — no price known (logged anyway, so it shows).
 */
export type PriceSource = 'provider' | 'usage' | 'list' | 'none';

export interface LoggedUsage {
  input?: number;
  output?: number;
  thoughts?: number;
  /** ElevenLabs: characters sent, and credits charged where it said. */
  chars?: number;
  credits?: number;
  /** ElevenLabs music: seconds asked for. */
  seconds?: number;
}

export interface RequestLogEntry {
  id: string;
  /** ms since the epoch. */
  at: number;
  uid: string | null;
  /** The demo's address hash for the day (`ipKey`), so a demo player is one row in the breakdown. */
  ip?: string | null;
  payer: LogPayer;
  provider: GatewayProvider;
  host: string;
  method: string;
  /** The provider's path, query dropped. */
  path: string;
  model: string;
  status: number;
  ms: number;
  world: string | null;
  quest: string | null;
  usd: number | null;
  source: PriceSource;
  /** The arithmetic, readable: "8000 in × $0.75/1M + 2000 out × $3.75/1M". */
  basis: string;
  usage?: LoggedUsage;
  /** USD → PLN at the NBP mid rate of the day it was made, and that table's date. */
  usdPln: number | null;
  fxDate: string | null;
  /** What was taken out of the tank first, on diesel. */
  reservedUsd?: number;
  /** Answered from the bucket for nothing (a kept asset) — logged so the saving shows. */
  reused?: boolean;
  /** Where the bodies are, in the game's bucket; null when they could not be kept. */
  bodies: string | null;
  requestBytes: number;
  responseBytes: number;
  contentType: string | null;
}

/** The file beside a record: what was sent and what came back. */
export interface RequestBodies {
  request: { method: string; url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown };
}

/** A request worth logging: one that can cost money. Polls, lists and searches are free. */
export function isPaidRequest(target: GatewayTarget, method: string): boolean {
  const m = method.toUpperCase();
  if (m !== 'POST') return false;
  const { provider, host, path } = target;
  if (provider === 'google') return /:(?:streamGenerateContent|generateContent|predict)$/.test(path);
  if (provider === 'openai' || provider === 'deepseek') return path === '/v1/chat/completions' || path === '/v1/images/generations';
  if (provider === 'elevenlabs') return /^\/v1\/(?:text-to-speech|text-to-dialogue|music|text-to-voice)/.test(path);
  if (provider === 'fal') return host !== 'rest.alpha.fal.ai' && !isFalFollowUp(path);
  return false;
}

/** A string longer than `max` (inline base64, a whole picture) is cut to its length. */
export function trimForLog(value: unknown, max = 4000): unknown {
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, 200)}… [${value.length} characters]` : value;
  if (Array.isArray(value)) return value.map((v) => trimForLog(v, max));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = trimForLog(v, max);
    return out;
  }
  return value;
}

/** Headers safe to keep: never one that carries a key or a token. */
export function safeHeaders(headers: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers) {
    const name = k.toLowerCase();
    if (/key|auth|token|cookie|secret/.test(name)) continue;
    out[name] = v;
  }
  return out;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6));

/** The arithmetic of a token-priced request, as the dashboard prints it. */
export function tokenBasis(model: string, u: { input: number; output: number; thoughts: number }, price: { input: number; output: number } | null): string {
  if (!price) return `${model}: no price in the list (${u.input} in, ${u.output} out, ${u.thoughts} thinking)`;
  const out = u.output + u.thoughts;
  return `${u.input} in × $${fmt(price.input)}/1M + ${out} out${u.thoughts ? ` (${u.output} + ${u.thoughts} thinking)` : ''} × $${fmt(price.output)}/1M`;
}

/** The day in Warsaw, `YYYY-MM-DD` — the same day the ledger and the demo count by. */
export function warsawDay(at: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

export type GroupBy = 'provider' | 'model' | 'user' | 'world' | 'quest' | 'payer';

/** The key an entry is grouped under for `by`; a missing world or quest groups as "—". */
export function groupKey(e: RequestLogEntry, by: GroupBy): string {
  switch (by) {
    case 'provider':
      return e.provider;
    case 'model':
      return e.model || '?';
    case 'user':
      return e.uid ?? (e.ip ? `demo:${e.ip.slice(0, 8)}` : '—');
    case 'world':
      return e.world ?? '—';
    case 'quest':
      return e.quest ?? '—';
    case 'payer':
      return e.payer;
  }
}

export interface CostGroup {
  key: string;
  usd: number;
  pln: number;
  calls: number;
  /** Calls with no known price, which `usd` counts as nothing. */
  unpriced: number;
}

export interface CostDay {
  day: string;
  usd: number;
  calls: number;
}

/** What an entry costs in złoty: at its own day's rate, or `fallback` (today's) where it has none. */
export function plnOf(e: RequestLogEntry, fallback: number | null): number {
  const rate = e.usdPln ?? fallback;
  return e.usd !== null && rate !== null ? e.usd * rate : 0;
}

/** Totals per group, dearest first. */
export function groupCosts(entries: RequestLogEntry[], by: GroupBy, fallbackRate: number | null): CostGroup[] {
  const map = new Map<string, CostGroup>();
  for (const e of entries) {
    const key = groupKey(e, by);
    const g = map.get(key) ?? { key, usd: 0, pln: 0, calls: 0, unpriced: 0 };
    g.calls += 1;
    if (e.usd === null) g.unpriced += 1;
    else g.usd += e.usd;
    g.pln += plnOf(e, fallbackRate);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.usd - a.usd || b.calls - a.calls);
}

/** Every Warsaw day from `from` to `to` (ms), each with what the entries cost on it — empty days included. */
export function dailyCosts(entries: RequestLogEntry[], from: number, to: number): CostDay[] {
  const days: CostDay[] = [];
  const index = new Map<string, CostDay>();
  // Step by 6 h so a DST day is never skipped; keep each day once.
  for (let t = from; t <= to + 6 * 3600_000; t += 6 * 3600_000) {
    const day = warsawDay(Math.min(t, to));
    if (index.has(day)) continue;
    const d = { day, usd: 0, calls: 0 };
    index.set(day, d);
    days.push(d);
  }
  for (const e of entries) {
    const d = index.get(warsawDay(e.at));
    if (!d) continue;
    d.calls += 1;
    d.usd += e.usd ?? 0;
  }
  return days;
}

/** What `/admin/requests` answers. */
export interface RequestsPage {
  entries: RequestLogEntry[];
  /** uid → e-mail (or display name), for the accounts in `entries`. */
  users: Record<string, string>;
  /** Today's NBP rate, for rows logged before a rate was known. */
  fx: { usdPln: number; date: string } | null;
  /** True when the range held more than the answer carries. */
  truncated: boolean;
}

/** The most records one answer carries. */
export const MAX_REQUESTS_PAGE = 5000;

export interface PriceFacts {
  /** What the gateway charged (`pass`'s answer). */
  usd: number | null;
  /** The model that answered (a meter's), or the one asked for. */
  model: string;
  /** Token counts from the answer, where it had them. */
  usage: { input: number; output: number; thoughts: number } | null;
  /** True when the answer was a Gemini picture (priced by image tokens). */
  image: boolean;
  /** ElevenLabs' `character-cost` header, in credits, where it was sent. */
  credits: number | null;
  at: number;
}

/** How a request's price was worked out — where the number came from, the arithmetic, and the usage to keep. */
export function describePrice(
  target: GatewayTarget,
  body: Record<string, unknown>,
  f: PriceFacts,
): { source: PriceSource; basis: string; usage?: LoggedUsage } {
  const perK = `$${fmt(USD_PER_VOICE_CREDIT * 1000)}/1k credits`;
  if (target.provider === 'elevenlabs') {
    const model = typeof body.model_id === 'string' ? body.model_id : 'eleven_flash_v2_5';
    if (target.path.startsWith('/v1/music')) {
      const seconds = (typeof body.music_length_ms === 'number' ? body.music_length_ms : 0) / 1000;
      return {
        source: f.usd === null ? 'none' : 'list',
        basis: `${seconds} s × ${MUSIC_CREDITS_PER_MINUTE} credits/min × ${perK}`,
        usage: { seconds },
      };
    }
    const chars =
      typeof body.text === 'string'
        ? body.text.length
        : Array.isArray(body.inputs)
          ? body.inputs.reduce((n: number, i) => n + (typeof i?.text === 'string' ? i.text.length : 0), 0)
          : 0;
    if (f.credits !== null) {
      return { source: 'provider', basis: `${f.credits} credits (ElevenLabs' character-cost) × ${perK}`, usage: { chars, credits: f.credits } };
    }
    if (f.usd === null) return { source: 'none', basis: `${model}: no price in the list`, usage: { chars } };
    return { source: 'list', basis: `${chars} chars × ${voiceCreditsPerChar(model)} credit (${model}) × ${perK}`, usage: { chars } };
  }
  if (target.provider === 'fal') {
    const size = body.image_size as { width?: number; height?: number } | undefined;
    const dims = size?.width && size?.height ? ` at ${size.width}×${size.height}` : '';
    const rig = body.enable_rigging === true ? ' with rigging' : '';
    const model = target.path.slice(1);
    return { source: f.usd === null ? 'none' : 'list', basis: f.usd === null ? `${model}: no price in the list` : `fal.ai list price, ${model}${dims}${rig}` };
  }
  if (f.usage) {
    const usage = { input: f.usage.input, output: f.usage.output, thoughts: f.usage.thoughts };
    if (f.image) {
      const r = GEMINI_IMAGE_RATES[f.model];
      return {
        source: f.usd === null ? 'none' : 'usage',
        basis: r
          ? `${usage.input} in × $${r.input}/1M + image tokens × $${r.image}/1M + other output × $${r.text}/1M (${f.model})`
          : `${f.model}: no image price in the list`,
        usage,
      };
    }
    return { source: f.usd === null ? 'none' : 'usage', basis: `${f.model}: ${tokenBasis(f.model, usage, tokenPrice(f.model, f.at))}`, usage };
  }
  return {
    source: f.usd === null ? 'none' : 'list',
    basis: f.usd === null ? `${f.model || target.path}: no usage in the answer, no price` : 'list price',
  };
}
