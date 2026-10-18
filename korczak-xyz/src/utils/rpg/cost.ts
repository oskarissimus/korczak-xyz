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
const PER_MILLION: [prefix: string, input: number, output: number][] = [
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

export function tokenPrice(model: string): { input: number; output: number } | null {
  let best: (typeof PER_MILLION)[number] | null = null;
  for (const row of PER_MILLION) {
    if (model.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row;
  }
  return best ? { input: best[1], output: best[2] } : null;
}

/** Dollars for one request, or null when the model has no price here. */
export function tokenCost(model: string, usage: Usage): number | null {
  const price = tokenPrice(model);
  if (!price) return null;
  return (usage.input * price.input + (usage.output + usage.thoughts) * price.output) / 1_000_000;
}

/**
 * ElevenLabs bills credits, not dollars: `eleven_flash_v2_5` costs half a credit per character. The
 * dollar figure is the Creator plan's rate ($22 for 100k credits); on another plan it differs, so
 * the credits are the number to trust.
 */
export const VOICE_CREDITS_PER_CHAR = 0.5;
export const USD_PER_VOICE_CREDIT = 22 / 100_000;

export function voiceCost(credits: number): number {
  return credits * USD_PER_VOICE_CREDIT;
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
