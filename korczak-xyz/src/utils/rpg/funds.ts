/*
 * An account that has run out of money, said once and plainly (owner, 30 Oct 2026: "errors saying the
 * money ran out should be more apparent"). fal.ai answered every piece of a quest with
 * `403 {"detail":"User is locked. Reason: TOP_UP."}`, and the only sign was a column of red entries
 * in the `~` console, one per place, each with its whole prompt above it.
 *
 * Every request ends in `endRequest` (`devlog.ts`), which hands each error here. One that reads as an
 * empty balance or a locked account marks its provider, and from then on:
 * - the game puts up one banner naming the provider and where to top up (`FundsBanner` in `Rpg.tsx`),
 *   and the console one line over every tab — not a toast per request;
 * - fal.ai and ElevenLabs are not asked again this sitting (`outOfFunds` in `landmark3d.ts`,
 *   `voice.ts`, `music.ts`): each would only fail the same way and cost the reader the wait. The
 *   game goes on without them, as it does without a key. The story's model chain is left alone,
 *   since it already moves to the next model and ends on a reason on screen;
 * - one Sentry error per provider, `rpg.funds`, not one per refused request.
 *
 * A request to the same provider that succeeds afterwards clears it (the reader topped up, or it was
 * one model's quota after all). Nothing else does but a reload, which the banner says.
 */

import { log } from '../../lib/logger';

export type FundsProvider = 'fal' | 'elevenlabs' | 'google' | 'openai';

export interface FundsAlert {
  provider: FundsProvider;
  /** The provider's own words, the first time. */
  error: string;
  at: number;
  /** Requests refused for it since, the first included. */
  count: number;
}

/** Where each provider's balance is topped up: the banner's link. */
export const TOP_UP: Record<FundsProvider, { name: string; url: string }> = {
  fal: { name: 'fal.ai', url: 'https://fal.ai/dashboard/billing' },
  elevenlabs: { name: 'ElevenLabs', url: 'https://elevenlabs.io/app/subscription' },
  google: { name: 'Google AI Studio', url: 'https://aistudio.google.com/usage' },
  openai: { name: 'OpenAI', url: 'https://platform.openai.com/settings/organization/billing' },
};

/**
 * What each provider says when the money is gone, as of Oct 2026. Narrow on purpose: Google's
 * per-model 429 ends "please check your plan and billing details" too, and is only a quota the chain
 * moves past, so for Google only the prepayment and billing wording counts. OpenAI's same sentence is
 * `insufficient_quota`, which is the balance.
 */
const SIGNS: Record<FundsProvider, RegExp> = {
  fal: /user is locked|top_?up|exhausted balance|insufficient (?:balance|credits|funds)|^402\b/i,
  elevenlabs: /quota_exceeded|exceeds your quota|payment_required|insufficient[_ ](?:credits|funds)|^(?:ElevenLabs )?402\b/i,
  google: /credits are depleted|prepayment|requires billing|billing_disabled|billing (?:is )?(?:not enabled|disabled)/i,
  openai: /insufficient_quota|exceeded your current quota|billing_hard_limit/i,
};

/** Whose request a console entry is, by its kind and the model asked. */
export function providerOf(kind: 'model' | 'voice' | 'fal' | 'music', model: string): FundsProvider {
  // A person's picture from Google's own API is logged with fal's steps, but billed by Google.
  if (kind === 'fal') return model.startsWith('gemini-') ? 'google' : 'fal';
  if (kind === 'voice' || kind === 'music') return 'elevenlabs';
  return /^(?:gpt|o\d|chatgpt)/i.test(model) ? 'openai' : 'google';
}

/** Whether an error reads as the account having no money left. */
export function isFundsError(provider: FundsProvider, error: string): boolean {
  return SIGNS[provider].test(error.trim());
}

let alerts: FundsAlert[] = [];
const dismissed = new Set<FundsProvider>();
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeFunds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function fundsVersion(): number {
  return version;
}

/** Every provider out of money, oldest first. */
export function fundsAlerts(): readonly FundsAlert[] {
  return alerts;
}

/** The ones the game's banner still shows: the console keeps all of them. */
export function bannerAlerts(): readonly FundsAlert[] {
  return alerts.filter((a) => !dismissed.has(a.provider));
}

export function dismissFunds(provider: FundsProvider): void {
  dismissed.add(provider);
  changed();
}

export function outOfFunds(provider: FundsProvider): boolean {
  return alerts.some((a) => a.provider === provider);
}

/** A request ended: an empty balance marks its provider, a success clears it. */
export function noteResult(provider: FundsProvider, error: string | null): void {
  const current = alerts.find((a) => a.provider === provider);
  if (error === null) {
    if (!current) return;
    alerts = alerts.filter((a) => a !== current);
    dismissed.delete(provider);
    changed();
    return;
  }
  if (!isFundsError(provider, error)) return;
  if (current) {
    alerts = alerts.map((a) => (a === current ? { ...a, count: a.count + 1 } : a));
  } else {
    alerts = [...alerts, { provider, error: error.slice(0, 300), at: Date.now(), count: 1 }];
    log.error('rpg.funds', { provider, error: error.slice(0, 300) });
  }
  changed();
}

/** For tests. */
export function resetFunds(): void {
  alerts = [];
  dismissed.clear();
  changed();
}
