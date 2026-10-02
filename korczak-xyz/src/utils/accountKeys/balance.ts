/*
 * What has been spent on each key and what is left — as far as each provider will say.
 *
 * Every call here goes from the page straight to the provider with the account's own key, like
 * every other call the apps make; nothing passes through a server of ours. All four endpoints
 * answer a browser (checked against korczak.xyz's origin, Oct 2026).
 *
 * The providers differ, and the page says so rather than inventing a number:
 *
 *   ElevenLabs  `GET /v1/user/subscription` — characters used and the period's limit. Both halves.
 *   DeepSeek    `GET /user/balance` — the balance. No API says what was spent.
 *   OpenAI      Neither, with an ordinary key. `GET /v1/organization/costs` reads spend, but only
 *               with an admin key (`api.usage.read`), and no API at all reads the prepaid credit.
 *               So: spend from the admin key when there is one, and what is left as the credit
 *               somebody typed in off the billing page minus what has been spent since.
 *   Google      Neither. An AI Studio key has no billing API; on the free tier there is nothing
 *               to spend, only per-minute and per-day limits. The key is checked, nothing more.
 *
 * The parsers are pure and tested; the fetchers are thin.
 */

/** How a provider answered a key. */
export type KeyCheck = 'ok' | 'refused' | 'failed';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function checkOf(status: number): 'refused' | 'failed' {
  return status === 401 || status === 403 || status === 400 ? 'refused' : 'failed';
}

/** A provider's own words for a refusal, when it gives any. Shown, because "refused" alone helps nobody. */
async function reasonOf(response: Response): Promise<string | null> {
  try {
    const body = record(await response.json());
    const error = body.error ?? body.detail;
    if (typeof error === 'string') return error;
    const nested = record(error);
    const message = nested.message ?? nested.status;
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

// --- DeepSeek ---------------------------------------------------------------------------------

export interface DeepSeekBalance {
  available: boolean;
  balances: { currency: string; total: number; granted: number; toppedUp: number }[];
}

export function parseDeepSeekBalance(json: unknown): DeepSeekBalance {
  const raw = record(json);
  const infos = Array.isArray(raw.balance_infos) ? raw.balance_infos : [];
  return {
    available: raw.is_available === true,
    balances: infos.map((info) => {
      const i = record(info);
      return {
        currency: typeof i.currency === 'string' ? i.currency : '?',
        total: num(i.total_balance) ?? 0,
        granted: num(i.granted_balance) ?? 0,
        toppedUp: num(i.topped_up_balance) ?? 0,
      };
    }),
  };
}

// --- ElevenLabs -------------------------------------------------------------------------------

export interface ElevenLabsUsage {
  tier: string;
  used: number;
  limit: number;
  /** When the character count starts again, ms. Null when the plan does not say. */
  resetAt: number | null;
}

export function parseElevenLabsSubscription(json: unknown): ElevenLabsUsage {
  const raw = record(json);
  const reset = num(raw.next_character_count_reset_unix);
  return {
    tier: typeof raw.tier === 'string' ? raw.tier : '?',
    used: num(raw.character_count) ?? 0,
    limit: num(raw.character_limit) ?? 0,
    resetAt: reset ? reset * 1000 : null,
  };
}

// --- OpenAI -----------------------------------------------------------------------------------

/** One day of OpenAI spend: the bucket's start, in seconds, and its total in dollars. */
export interface CostDay {
  start: number;
  usd: number;
}

/** The days out of one page of `/v1/organization/costs`, each bucket's results summed. */
export function parseOpenAiCosts(json: unknown): { days: CostDay[]; nextPage: string | null } {
  const raw = record(json);
  const data = Array.isArray(raw.data) ? raw.data : [];
  const days = data.map((bucket) => {
    const b = record(bucket);
    const results = Array.isArray(b.results) ? b.results : [];
    const usd = results.reduce<number>(
      (sum, result) => sum + (num(record(record(result).amount).value) ?? 0),
      0,
    );
    return { start: num(b.start_time) ?? 0, usd };
  });
  const nextPage = raw.has_more === true && typeof raw.next_page === 'string' ? raw.next_page : null;
  return { days, nextPage };
}

/** Dollars spent on days starting at or after `fromMs`. Buckets are whole UTC days. */
export function spentSince(days: CostDay[], fromMs: number): number {
  const from = Math.floor(startOfUtcDay(fromMs) / 1000);
  return days.filter((d) => d.start >= from).reduce((sum, d) => sum + d.usd, 0);
}

export function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function startOfUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// --- Fetchers ---------------------------------------------------------------------------------

export type Reading<T> =
  | { check: 'ok'; data: T }
  | { check: 'refused' | 'failed'; reason: string | null };

async function get<T>(
  url: string,
  headers: Record<string, string>,
  parse: (json: unknown) => T,
  signal?: AbortSignal,
): Promise<Reading<T>> {
  try {
    const response = await fetch(url, { headers, signal });
    if (!response.ok) return { check: checkOf(response.status), reason: await reasonOf(response) };
    return { check: 'ok', data: parse(await response.json()) };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { check: 'failed', reason: e instanceof Error ? e.message : null };
  }
}

export function readDeepSeek(key: string, signal?: AbortSignal) {
  return get(
    'https://api.deepseek.com/user/balance',
    { Authorization: `Bearer ${key}` },
    parseDeepSeekBalance,
    signal,
  );
}

export function readElevenLabs(key: string, signal?: AbortSignal) {
  return get(
    'https://api.elevenlabs.io/v1/user/subscription',
    { 'xi-api-key': key },
    parseElevenLabsSubscription,
    signal,
  );
}

/** Whether an OpenAI key works: listing models is free and is what the apps' own forms do. */
export function checkOpenAi(key: string, signal?: AbortSignal) {
  return get('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }, () => null, signal);
}

/** Whether a Google AI Studio key works, the same way. */
export function checkGoogle(key: string, signal?: AbortSignal) {
  // The key in the query, as the apps send it: a custom header would make this a preflighted
  // request, and Google's preflight is not one to rely on.
  return get(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`,
    {},
    () => null,
    signal,
  );
}

/**
 * Every day of OpenAI spend since `fromMs`, read with an admin key. A few pages at most: a daily
 * bucket page holds up to 180 days, and nothing here asks for more than a few months.
 */
export async function readOpenAiCosts(
  adminKey: string,
  fromMs: number,
  signal?: AbortSignal,
): Promise<Reading<CostDay[]>> {
  const days: CostDay[] = [];
  let page: string | null = null;
  for (let i = 0; i < 5; i++) {
    const params = new URLSearchParams({
      start_time: String(Math.floor(startOfUtcDay(fromMs) / 1000)),
      bucket_width: '1d',
      limit: '180',
    });
    if (page) params.set('page', page);
    const reading: Reading<{ days: CostDay[]; nextPage: string | null }> = await get(
      `https://api.openai.com/v1/organization/costs?${params}`,
      { Authorization: `Bearer ${adminKey}` },
      parseOpenAiCosts,
      signal,
    );
    if (reading.check !== 'ok') return reading;
    days.push(...reading.data.days);
    page = reading.data.nextPage;
    if (!page) break;
  }
  return { check: 'ok', data: days };
}
