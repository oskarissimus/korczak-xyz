/*
 * What the providers' own wallets say, against what the request log (`requestLog.ts`) estimated.
 *
 * Shared by the admin panel and the gateway. A reading is one figure a provider showed at one
 * moment, read by the server with a key kept for nothing else (`rpgWalletKeys/config`, no rule, so
 * no page can read it back) or typed in by hand off the provider's billing page:
 *
 * - **spent** — what the provider says was spent between `from` and `at`. Compared with what the
 *   log priced over the same window, reading by reading.
 * - **balance** — what was left at `at`. Two readings of one provider make a window: the drop
 *   between them is what was really spent, compared with what the log priced in between. A drop
 *   below zero is a top-up, and the pair is shown as such rather than as a drift.
 *
 * Only the requests that spend the server's keys are counted (`OWN_PAYERS`): an account paying with
 * its own key spends its own wallet, not ours. Anything else on the same provider account — another
 * app, a console session — is in the provider's figure and not in the estimate, and is drift too.
 */

import { usdPerVoiceCredit } from './cost';
import type { WalletAlarm } from './fundsSigns';
import type { LogPayer, RequestLogEntry } from './requestLog';

export const WALLETS_DOC = ['rpgWalletKeys', 'config'] as const;
export const WALLET_READINGS = 'rpgWallets';
export const ADMIN_WALLETS_PATH = '/admin/wallets';
export const MAX_WALLET_KEY = 512;
export const MAX_NOTE = 200;
/** How far back the panel lists readings, and the longest window one reading may cover. */
export const WALLET_DAYS = 400;

export const WALLET_PROVIDERS = ['google', 'openai', 'elevenlabs', 'fal'] as const;
export type WalletProvider = (typeof WALLET_PROVIDERS)[number];

/** The providers whose wallet an API will read, and so the keys the panel takes. Google has none. */
export const WALLET_KEY_PROVIDERS = ['openai', 'elevenlabs', 'fal'] as const;
export type WalletKeyProvider = (typeof WALLET_KEY_PROVIDERS)[number];

export type WalletKind = 'spent' | 'balance';
export type WalletUnit = 'usd' | 'credits';

/** The payers whose requests spend the server's own keys. */
export const OWN_PAYERS: readonly LogPayer[] = ['diesel', 'demo', 'test'];

export interface WalletReading {
  id: string;
  provider: WalletProvider;
  kind: WalletKind;
  unit: WalletUnit;
  amount: number;
  at: number;
  /** For `spent`: where the provider's window starts. */
  from: number | null;
  source: 'api' | 'manual';
  note: string | null;
  by: string | null;
}

/** What one read gave, before it is stored (or, on a peek, instead of being stored). */
export type WalletValue = Omit<WalletReading, 'id' | 'by'>;

export type WalletCheck = {
  provider: WalletProvider;
  check: 'ok' | 'refused' | 'failed' | 'no-key';
  reason: string | null;
  /** The figure itself, when the check was `ok`. */
  reading?: WalletValue;
};

export interface WalletsPage {
  hints: Record<WalletKeyProvider, string | null>;
  readings: WalletReading[];
  /** Logged spend of the server's keys, priced, for every reading's window (`driftRows` needs no more). */
  logged: { provider: WalletProvider; at: number; usd: number | null }[];
  /** The first logged request: a window starting before it has nothing to compare against. */
  loggingSince: number | null;
  checks?: WalletCheck[];
  /** The last refusal for want of money on our own keys, per provider (`walletAlarm.ts`). */
  alarms?: WalletAlarm[];
}

export interface WalletPatch {
  keys?: Partial<Record<WalletKeyProvider, string | null>>;
  reading?: Omit<WalletReading, 'id' | 'source' | 'by'>;
  remove?: string;
  check?: boolean;
  /** With `check`: ask every provider, answer the figures, store none (the panel's top, on every open). */
  peek?: boolean;
}

export class BadWalletPatch extends Error {}

function isProvider(v: unknown): v is WalletProvider {
  return typeof v === 'string' && (WALLET_PROVIDERS as readonly string[]).includes(v);
}

/** The panel's POST body, checked field by field; anything unexpected is refused, not dropped. */
export function parseWalletPatch(raw: unknown, now = Date.now()): WalletPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadWalletPatch('not an object');
  const body = raw as Record<string, unknown>;
  const out: WalletPatch = {};
  if (body.keys !== undefined) {
    if (!body.keys || typeof body.keys !== 'object') throw new BadWalletPatch('keys');
    out.keys = {};
    for (const [name, value] of Object.entries(body.keys as Record<string, unknown>)) {
      if (!(WALLET_KEY_PROVIDERS as readonly string[]).includes(name)) throw new BadWalletPatch(`key ${name}`);
      if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > MAX_WALLET_KEY)) throw new BadWalletPatch(`key ${name}`);
      out.keys[name as WalletKeyProvider] = value === null ? null : (value as string).trim();
    }
  }
  if (body.reading !== undefined) {
    const r = body.reading as Record<string, unknown>;
    if (!r || typeof r !== 'object') throw new BadWalletPatch('reading');
    if (!isProvider(r.provider)) throw new BadWalletPatch('reading.provider');
    if (r.kind !== 'spent' && r.kind !== 'balance') throw new BadWalletPatch('reading.kind');
    const unit = r.unit ?? 'usd';
    if (unit !== 'usd' && unit !== 'credits') throw new BadWalletPatch('reading.unit');
    if (unit === 'credits' && r.provider !== 'elevenlabs') throw new BadWalletPatch('reading.unit');
    if (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || Math.abs(r.amount) > 1e9) throw new BadWalletPatch('reading.amount');
    if (typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at > now + 60_000 || r.at < now - WALLET_DAYS * 86_400_000) throw new BadWalletPatch('reading.at');
    let from: number | null = null;
    if (r.kind === 'spent') {
      if (typeof r.from !== 'number' || !Number.isFinite(r.from) || r.from >= r.at || r.at - r.from > WALLET_DAYS * 86_400_000) throw new BadWalletPatch('reading.from');
      from = r.from;
    }
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, MAX_NOTE) : null;
    out.reading = { provider: r.provider, kind: r.kind, unit, amount: r.amount, at: r.at, from, note };
  }
  if (body.remove !== undefined) {
    if (typeof body.remove !== 'string' || !/^[\w-]{1,64}$/.test(body.remove)) throw new BadWalletPatch('remove');
    out.remove = body.remove;
  }
  if (body.check !== undefined) out.check = body.check === true;
  if (body.peek !== undefined) out.peek = body.peek === true;
  return out;
}

/** A reading's figure in dollars: ElevenLabs' credits at the price the diesel charges them at. */
export function usdOfAmount(amount: number, unit: WalletUnit): number {
  return unit === 'credits' ? amount * usdPerVoiceCredit() : amount;
}

/** The log's priced spend of one provider in (from, to], and how many requests had no price. */
export function loggedBetween(
  logged: WalletsPage['logged'],
  provider: WalletProvider,
  from: number,
  to: number,
): { usd: number; calls: number; unpriced: number } {
  let usd = 0;
  let calls = 0;
  let unpriced = 0;
  for (const e of logged) {
    if (e.provider !== provider || e.at <= from || e.at > to) continue;
    calls++;
    if (e.usd == null) unpriced++;
    else usd += e.usd;
  }
  return { usd, calls, unpriced };
}

/** The log's entries that count against the server's wallets, cut to what `driftRows` reads. */
export function ownSpend(entries: RequestLogEntry[]): WalletsPage['logged'] {
  return entries
    .filter((e) => OWN_PAYERS.includes(e.payer) && isProvider(e.provider) && !e.reused)
    .map((e) => ({ provider: e.provider as WalletProvider, at: e.at, usd: e.usd }));
}

export interface DriftRow {
  provider: WalletProvider;
  from: number;
  to: number;
  /** What the provider's figures say was spent, in dollars; null for a top-up. */
  actualUsd: number | null;
  /** The same in the provider's own unit, when that is credits. */
  actualCredits: number | null;
  estimatedUsd: number;
  calls: number;
  unpriced: number;
  /** actual − estimated; positive means the log under-prices. */
  driftUsd: number | null;
  /** The window starts before the first logged request, so the estimate is missing a part. */
  beforeLogging: boolean;
  topUp: boolean;
  readings: string[];
}

/**
 * One row per comparable window: each `spent` reading on its own, and each pair of consecutive
 * `balance` readings of one provider in one unit. Newest first.
 */
export function driftRows(page: Pick<WalletsPage, 'readings' | 'logged' | 'loggingSince'>): DriftRow[] {
  const rows: DriftRow[] = [];
  const row = (provider: WalletProvider, from: number, to: number, spent: number | null, unit: WalletUnit, ids: string[]): DriftRow => {
    const est = loggedBetween(page.logged, provider, from, to);
    const actualUsd = spent == null ? null : usdOfAmount(spent, unit);
    return {
      provider,
      from,
      to,
      actualUsd,
      actualCredits: spent != null && unit === 'credits' ? spent : null,
      estimatedUsd: est.usd,
      calls: est.calls,
      unpriced: est.unpriced,
      driftUsd: actualUsd == null ? null : actualUsd - est.usd,
      beforeLogging: page.loggingSince == null || from < page.loggingSince,
      topUp: spent == null,
      readings: ids,
    };
  };
  for (const r of page.readings) {
    if (r.kind === 'spent' && r.from != null) rows.push(row(r.provider, r.from, r.at, r.amount, r.unit, [r.id]));
  }
  const series = new Map<string, WalletReading[]>();
  for (const r of page.readings) {
    if (r.kind !== 'balance') continue;
    const k = `${r.provider}|${r.unit}`;
    series.set(k, [...(series.get(k) ?? []), r]);
  }
  for (const list of series.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (b.at <= a.at) continue;
      const drop = a.amount - b.amount;
      rows.push(row(b.provider, a.at, b.at, drop < 0 ? null : drop, b.unit, [a.id, b.id]));
    }
  }
  return rows.sort((x, y) => y.to - x.to);
}

// --- How much is left, at a glance (owner, 20 Nov 2026: "na górze od razu widoczne, u którego
// dostawcy ile jest pieniędzy, żebym wiedział, że trzeba zaraz doładować") ---------------------

/** Below this many dollars a wallet is shown as low: about a day of the game's own spend. */
export const LOW_USD = 5;
/** Below this, as empty: a world's worth or less. */
export const EMPTY_USD = 0.5;

/** How long a refusal for want of money stays on its tile. */
export const ALARM_SHOWN_MS = 86_400_000;

export type WalletLevel = 'ok' | 'low' | 'empty' | 'unknown';

export interface WalletStanding {
  provider: WalletProvider;
  /**
   * - `live` — the provider's own balance, read just now;
   * - `read` — its balance as last read or typed, with nothing logged on our keys since;
   * - `estimate` — that balance minus what the request log priced on our keys since (no API reads
   *   the balance, or the read failed);
   * - `spent` — only what was spent is known (OpenAI's costs, Google's billing export): no balance;
   * - `none` — nothing read or typed yet.
   */
  basis: 'live' | 'read' | 'estimate' | 'spent' | 'none';
  /** Dollars left (for `spent`, dollars spent); null for `none`. */
  usd: number | null;
  /** The same in credits, for ElevenLabs. */
  credits: number | null;
  /** When the figure it stands on was read, and how. */
  at: number | null;
  source: 'api' | 'manual' | null;
  /** For `spent`: where the spent window starts. */
  from: number | null;
  /** For `estimate`: what the log priced since the reading, and whether the log covers all of it. */
  loggedUsd: number;
  partial: boolean;
  level: WalletLevel;
  /** The last refusal for want of money in the past day; newer than the figure, it outranks it. */
  alarm: WalletAlarm | null;
}

function levelOf(usd: number): WalletLevel {
  return usd < EMPTY_USD ? 'empty' : usd < LOW_USD ? 'low' : 'ok';
}

/**
 * Where one provider's wallet stands: a live balance if one was just read, else the newest balance
 * reading less the log since, else what was last read as spent. A refusal for want of money newer
 * than the figure makes it empty whatever the figure says.
 */
export function walletStanding(
  page: Pick<WalletsPage, 'readings' | 'logged' | 'loggingSince' | 'alarms'>,
  provider: WalletProvider,
  now: number,
  live: WalletValue[] = [],
): WalletStanding {
  const base = { provider, credits: null, from: null, loggedUsd: 0, partial: false } as const;
  // The last refusal is shown for a day; it makes the wallet empty only while nothing newer was read.
  const alarm = page.alarms?.find((a) => a.provider === provider && now - a.at < ALARM_SHOWN_MS) ?? null;
  const withAlarm = (s: WalletStanding): WalletStanding =>
    alarm ? { ...s, alarm, level: alarm.at > (s.at ?? 0) ? 'empty' : s.level } : s;
  const liveBalance = live.find((v) => v.provider === provider && v.kind === 'balance');
  if (liveBalance) {
    const usd = usdOfAmount(liveBalance.amount, liveBalance.unit);
    return withAlarm({
      ...base,
      basis: 'live',
      usd,
      credits: liveBalance.unit === 'credits' ? liveBalance.amount : null,
      at: liveBalance.at,
      source: 'api',
      level: levelOf(usd),
      alarm: null,
    });
  }
  // Readings are newest first.
  const balance = page.readings.find((r) => r.provider === provider && r.kind === 'balance');
  if (balance) {
    const since = loggedBetween(page.logged, provider, balance.at, now);
    const usd = usdOfAmount(balance.amount, balance.unit) - since.usd;
    return withAlarm({
      ...base,
      basis: since.calls > 0 ? 'estimate' : 'read',
      usd,
      credits: balance.unit === 'credits' ? balance.amount - since.usd / usdPerVoiceCredit() : null,
      at: balance.at,
      source: balance.source,
      loggedUsd: since.usd,
      partial: since.unpriced > 0 || page.loggingSince == null || page.loggingSince > balance.at,
      level: levelOf(usd),
      alarm: null,
    });
  }
  const spent =
    live.find((v) => v.provider === provider && v.kind === 'spent') ?? page.readings.find((r) => r.provider === provider && r.kind === 'spent');
  if (spent) {
    return withAlarm({ ...base, basis: 'spent', usd: usdOfAmount(spent.amount, spent.unit), at: spent.at, source: spent.source, from: spent.from, level: 'unknown', alarm: null });
  }
  return withAlarm({ ...base, basis: 'none', usd: null, at: null, source: null, level: 'unknown', alarm: null });
}

// --- What each provider's API says, parsed (the server fetches; these are pure and tested) ---

/** fal's `GET rest.alpha.fal.ai/billing/user_balance`: a bare number of dollars (checked 10 Nov 2026). */
export function parseFalBalance(json: unknown): number | null {
  if (typeof json === 'number' && Number.isFinite(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const k of ['balance', 'current_balance', 'credits']) if (typeof o[k] === 'number') return o[k] as number;
  }
  return null;
}

/** ElevenLabs' `GET /v1/user/subscription`: the credits left this period. */
export function parseElevenLabsLeft(json: unknown): number | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const used = Number(o.character_count);
  const limit = Number(o.character_limit);
  return Number.isFinite(used) && Number.isFinite(limit) ? limit - used : null;
}

/** OpenAI's `GET /v1/organization/costs` page: the dollars it holds, every bucket's results summed. */
export function parseOpenAiSpent(json: unknown): { usd: number; next: string | null } {
  const o = (json ?? {}) as Record<string, unknown>;
  let usd = 0;
  for (const bucket of Array.isArray(o.data) ? o.data : []) {
    for (const r of Array.isArray((bucket as Record<string, unknown>).results) ? ((bucket as Record<string, unknown>).results as unknown[]) : []) {
      const v = Number(((r as Record<string, unknown>).amount as Record<string, unknown> | undefined)?.value);
      if (Number.isFinite(v)) usd += v;
    }
  }
  return { usd, next: o.has_more === true && typeof o.next_page === 'string' ? o.next_page : null };
}

export function startOfUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/**
 * Where a provider's own window may start so the log can answer for all of it: `start` (the month),
 * or the first whole `bucketMs` after the first logged request, whichever is later. A provider counts
 * in buckets (Cloud Billing's export by the hour, OpenAI's costs by the UTC day), and a bucket that
 * straddles the first logged request holds spend the log never saw. Before this, Google's reading ran
 * from the 1st of the month while the log began on 10 Nov 2026 09:22 UTC, and the $2.15 Gemini spent
 * before it stood in every row as drift (the part after it matched the log to the cent).
 */
export function comparableFrom(start: number, loggingSince: number | null, bucketMs: number): number {
  if (loggingSince == null) return start;
  return Math.max(start, Math.ceil(loggingSince / bucketMs) * bucketMs);
}

// --- Google: the Cloud Billing export in BigQuery (no key reads Gemini API billing) ------------

/** Where the billing account's standard usage-cost export lands (`terraform/rpg/billing.tf`). */
export const BILLING_PROJECT = 'korczak-rpg';
export const BILLING_DATASET = 'billing_export';
export const BILLING_LOCATION = 'EU';
/** The Gemini API's service in the export; it was the Generative Language API before the rename. */
export const GEMINI_SERVICES = ['Gemini API', 'Generative Language API'] as const;

/**
 * Gemini API spend since `fromMs`, in dollars, credits included, across every project on the
 * billing account. The export is in the account's own currency (`currency_conversion_rate` is
 * local per dollar), so each row is divided back. `at` is where the export's data ends — it runs
 * hours behind — so the log is compared over the same window.
 */
export function geminiBillingSql(fromMs: number): string {
  const from = new Date(fromMs).toISOString();
  const services = GEMINI_SERVICES.map((s) => `'${s}'`).join(', ');
  return `SELECT
  SUM((cost + IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) / IF(currency_conversion_rate > 0, currency_conversion_rate, 1)) AS usd,
  UNIX_MILLIS(MAX(usage_end_time)) AS until,
  STRING_AGG(DISTINCT project.id) AS projects,
  ANY_VALUE(currency) AS currency
FROM \`${BILLING_PROJECT}.${BILLING_DATASET}.gcp_billing_export_v1_*\`
WHERE service.description IN (${services})
  AND usage_start_time >= TIMESTAMP('${from}')`;
}

/** One row of `jobs.query`'s answer: `{ rows: [{ f: [{ v }] }] }`, every value a string or null. */
export function parseGeminiBilling(json: unknown): { usd: number; until: number | null; projects: string | null; currency: string | null } | null {
  const rows = (json as { rows?: { f?: { v?: unknown }[] }[] } | null)?.rows;
  const f = rows?.[0]?.f;
  if (!f) return { usd: 0, until: null, projects: null, currency: null };
  const str = (i: number) => (typeof f[i]?.v === 'string' ? (f[i].v as string) : null);
  const usd = str(0) == null ? 0 : Number(str(0));
  const until = str(1) == null ? null : Number(str(1));
  if (!Number.isFinite(usd) || (until !== null && !Number.isFinite(until))) return null;
  return { usd, until, projects: str(2), currency: str(3) };
}
