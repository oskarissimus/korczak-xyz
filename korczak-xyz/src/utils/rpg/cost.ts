/*
 * What a quest costs, approximately: the list prices of the models and of ElevenLabs, for the
 * developer console and the summary at the end of a quest. Approximate on purpose — these are the
 * public per-token prices as of Oct 2026 (https://ai.google.dev/gemini-api/docs/pricing, OpenAI's
 * pricing page), not the bill, and several Gemini prices change on 1 Dec 2026.
 *
 * Priced by the model that actually answered (`modelVersion` in Google's response), not by the name
 * asked for: `gemini-flash-latest` is an alias, and in Oct 2026 it answered as `gemini-3.8-flash`.
 * A model missing from the table has no price, and the console says so rather than guessing.
 */

export interface Usage {
  input: number;
  output: number;
  /** Thinking tokens, which Google bills as output but counts apart from it. */
  thoughts: number;
}

/** US dollars per 1M tokens, prompts up to 200k (a beat is ~5k). Longest prefix wins. */
export const PER_MILLION: [prefix: string, input: number, output: number][] = [
  ['gemini-3.1-pro', 2, 12],
  ['gemini-4-argon', 2, 10],
  ['gemini-3.8-flash', 0.75, 3.75],
  ['gemini-3.6-flash', 0.75, 3.75],
  ['gemini-3.5-flash-lite', 0.3, 2.5],
  ['gemini-3.1-flash-lite', 0.25, 1.5],
  ['gemini-3-flash', 0.5, 3],
  ['gemini-2.5-pro', 1.25, 10],
  ['gemini-2.5-flash-lite', 0.1, 0.4],
  ['gemini-2.5-flash', 0.3, 2.5],
  // Free on AI Studio, and not offered on the paid tier at all.
  ['gemma-', 0, 0],
  ['gpt-4.1-mini', 0.4, 1.6],
  ['gpt-4.1', 2, 8],
];

/**
 * Prices Google has already announced, from the day they apply (ai.google.dev pricing page, read
 * 10 Nov 2026: "$2.00 through November 30, 2026. $4.00 starting December 1, 2026." and the same
 * shape for 3.8 / 3.6 Flash from 1 Jan 2027). A request is priced at the rate of the moment it was
 * made, so the ledger, diesel and the request log move on the day without a deploy.
 */
export const PRICE_CHANGES: { prefix: string; from: string; input: number; output: number }[] = [
  { prefix: 'gemini-4-argon', from: '2026-12-01', input: 4, output: 20 },
  { prefix: 'gemini-3.8-flash', from: '2027-01-01', input: 1.5, output: 7.5 },
  { prefix: 'gemini-3.6-flash', from: '2027-01-01', input: 1.5, output: 7.5 },
];

/** The row a model is priced by: the longest matching prefix, or null. */
export function priceRowOf(model: string): (typeof PER_MILLION)[number] | null {
  let best: (typeof PER_MILLION)[number] | null = null;
  for (const row of PER_MILLION) {
    if (model.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row;
  }
  return best;
}

/** The price per 1M tokens at `at` (ms, default now): the row's, or the latest announced change in force. */
export function tokenPrice(model: string, at: number = Date.now()): { input: number; output: number } | null {
  const best = priceRowOf(model);
  if (!best) return null;
  let price = { input: best[1], output: best[2] };
  let since = '';
  for (const c of PRICE_CHANGES) {
    if (c.prefix === best[0] && Date.parse(`${c.from}T00:00:00Z`) <= at && c.from > since) {
      price = { input: c.input, output: c.output };
      since = c.from;
    }
  }
  return price;
}

/** Dollars for one request, or null when the model has no price here. */
export function tokenCost(model: string, usage: Usage, at: number = Date.now()): number | null {
  const price = tokenPrice(model, at);
  if (!price) return null;
  return (usage.input * price.input + (usage.output + usage.thoughts) * price.output) / 1_000_000;
}

/**
 * ElevenLabs bills credits, not dollars: `eleven_flash_v2_5` costs half a credit per character
 * (checked against the account's own history in Oct 2026: 200 characters moved the count by 100).
 * Every other speech model is a credit a character: v4 and v3, the ones that act audio tags. A
 * tagged line costs twice what it would on Flash (`voice.ts`, `TAG_MODEL`).
 */
export const VOICE_CREDITS_PER_CHAR = 0.5;

export function voiceCreditsPerChar(model: string): number {
  return model.startsWith('eleven_flash') || model.startsWith('eleven_turbo') ? VOICE_CREDITS_PER_CHAR : 1;
}

/**
 * What a credit costs the owner, net of VAT, from the day each rate applies (owner, 27 Nov 2026:
 * "make diesel accurate now and once the new plan is in force"). Read off the account that day:
 * Creator, $22 a month ($27.06 with VAT), 121,000 credits a month plus what rolled over, nothing
 * paid beyond the fee so far. Until then the code priced a credit at $22 / 300,000, the Creator of
 * Oct 2026; by November the same $22 bought 121k, so every ElevenLabs price was ~2.5× low.
 *
 * - **Until 17 Dec 2026, legacy credits**: $22 / 121,000 a credit, the fee spread over the month's
 *   own credits. Within them a clip costs nothing more; this is its share of the fee.
 * - **From 17 Dec 2026, the prepaid API pricing** (the owner confirmed *Switch to new pricing* on
 *   27 Nov; it takes effect at the end of the billing cycle, and there is no way back): the API is
 *   billed at the list price, $0.04 per 1k characters on Flash/Turbo and $0.08 on v4/v3
 *   (elevenlabs.io/pricing/api). The plan's $22 covers that much (550k Flash characters) and past it
 *   a prepaid balance pays the same rates, topped up $20 at a time. Both are $0.08 per 1k credits at
 *   0.5 and 1 credit a character, so a credit stays the unit. Music is $0.15 a minute on that list,
 *   not credits (`musicUsd`).
 *
 * If the switch moves, change the date here; nothing else names it.
 */
export const VOICE_PRICES: { from: string; usdPerCredit: number; musicUsdPerMinute: number | null; plan: string }[] = [
  { from: '2026-01-01', usdPerCredit: 22 / 121_000, musicUsdPerMinute: null, plan: 'Creator, $22 / 121k credits' },
  { from: '2026-12-17', usdPerCredit: 0.08 / 1000, musicUsdPerMinute: 0.15, plan: 'API pricing, $0.04 / $0.08 per 1k chars' },
];

/** The voice rate in force at `at` (ms, default now). */
export function voicePrice(at: number = Date.now()): (typeof VOICE_PRICES)[number] {
  let row = VOICE_PRICES[0];
  for (const r of VOICE_PRICES) if (Date.parse(`${r.from}T00:00:00Z`) <= at) row = r;
  return row;
}

export function usdPerVoiceCredit(at: number = Date.now()): number {
  return voicePrice(at).usdPerCredit;
}

/**
 * Music is billed per generation by its length: ~900 credits a minute on the legacy credits
 * (ElevenLabs' pricing page, Oct 2026), from the same credits as the voices (`music.ts`); $0.15 a
 * minute on the API pricing.
 */
export const MUSIC_CREDITS_PER_MINUTE = 900;

export function voiceCost(credits: number, at: number = Date.now()): number {
  return credits * usdPerVoiceCredit(at);
}

/**
 * A score's price: per minute on the API pricing; before it, the credits ElevenLabs charged
 * (`credits`, else 900 a minute) at the credit rate.
 */
export function musicUsd(seconds: number, credits: number | null = null, at: number = Date.now()): number {
  const row = voicePrice(at);
  if (row.musicUsdPerMinute !== null) return (seconds / 60) * row.musicUsdPerMinute;
  return (credits ?? (seconds / 60) * MUSIC_CREDITS_PER_MINUTE) * row.usdPerCredit;
}

/** The rate as text for a basis line, e.g. "$0.1818/1k credits (Creator, $22 / 121k credits)". */
export function voiceRateText(at: number = Date.now()): string {
  const row = voicePrice(at);
  return `$${Math.round(row.usdPerCredit * 1e7) / 1e4}/1k credits (${row.plan})`;
}

export function formatUsd(usd: number | null): string {
  if (usd === null) return '?';
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

export function formatMs(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}
