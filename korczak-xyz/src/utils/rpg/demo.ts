/*
 * The browser's half of the RPG demo (`functions/src/rpg/handler.ts`): somebody with no account and
 * no key plays on the owner's keys, inside a budget in dollars (`demoLimits.ts`).
 *
 * WHAT GOES OUT is the story so far — the same context `beatPrompt` is built from — never a prompt.
 * The function builds the prompt itself from a context it checks field by field, and answers with
 * the very event stream Google sends, so `storyteller.ts` reads a demo beat exactly as it reads one
 * on a reader's own key. A clip goes out as its line, its voice and its language.
 */

import type { RpgDemoReason } from './demoLimits';

/** Stands in for an ElevenLabs key in `voice.ts`: "speak through the demo". Never a real key. */
export const DEMO_VOICE_KEY = 'demo:rpg';

export interface RpgDemoStatus {
  available: boolean;
  reason: RpgDemoReason | null;
  /** Whether the paying account can speak at all. */
  voice: boolean;
  /** Dollars left today: `ip` for this address, `all` for everybody. */
  remaining: { ip: number; all: number };
  perIpUsd: number;
  dailyUsd: number;
  /** Today across the whole site (`stats.ts`), or null from a function older than it. */
  today: { launches: number; playMs: number; usd: number } | null;
}

export function rpgDemoUrl(): string | null {
  const override = import.meta.env.PUBLIC_RPG_DEMO_URL as string | undefined;
  if (override) return override;
  const project = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined;
  if (!project) return null;
  return `https://europe-central2-${project}.cloudfunctions.net/rpgDemo`;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** What the function says about today, or null when it cannot be asked (offline, not deployed). */
export async function fetchRpgDemoStatus(signal?: AbortSignal): Promise<RpgDemoStatus | null> {
  const url = rpgDemoUrl();
  if (!url) return null;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const raw = (await response.json()) as Record<string, unknown>;
    const remaining = (raw.remaining ?? {}) as Record<string, unknown>;
    const today = raw.today && typeof raw.today === 'object' ? (raw.today as Record<string, unknown>) : null;
    return {
      available: raw.available === true,
      reason: typeof raw.reason === 'string' ? (raw.reason as RpgDemoReason) : null,
      voice: raw.voice === true,
      remaining: { ip: num(remaining.ip), all: num(remaining.all) },
      perIpUsd: num(raw.perIpUsd),
      dailyUsd: num(raw.dailyUsd),
      today: today ? { launches: num(today.launches), playMs: num(today.playMs), usd: num(today.usd) } : null,
    };
  } catch {
    return null;
  }
}

/** A refusal's reason, when the body is the demo's own and not Google's passed on. */
export function demoRefusal(body: unknown): RpgDemoReason | null {
  const reason = (body as { reason?: unknown } | null)?.reason;
  return reason === 'disabled' || reason === 'no-key' || reason === 'app-off' || reason === 'ip-cap' || reason === 'all-cap'
    ? reason
    : null;
}
