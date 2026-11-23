/*
 * What each provider says when the money is gone, and where its balance is topped up.
 *
 * Shared by the game (`funds.ts`: one banner, not a toast per request), the admin panel's wallets
 * (`AdminWallets.tsx`: the top-up links beside each balance) and the functions (`walletAlarm.ts`:
 * a request on the server's own keys refused for want of money is a Sentry incident at once). So
 * nothing here may import outside this file — no logger, no DOM.
 */

export type FundsProvider = 'fal' | 'elevenlabs' | 'google' | 'openai';

export const FUNDS_PROVIDERS: readonly FundsProvider[] = ['google', 'openai', 'elevenlabs', 'fal'];

/** Where each provider's balance is topped up. */
export const TOP_UP: Record<FundsProvider, { name: string; url: string }> = {
  fal: { name: 'fal.ai', url: 'https://fal.ai/dashboard/usage-billing/credits' },
  elevenlabs: { name: 'ElevenLabs', url: 'https://elevenlabs.io/app/subscription' },
  google: { name: 'Google AI Studio', url: 'https://aistudio.google.com/usage' },
  openai: { name: 'OpenAI', url: 'https://platform.openai.com/settings/organization/billing' },
};

/**
 * The provider's own words for an empty balance, as of Oct 2026. Narrow on purpose: Google's
 * per-model 429 ends "please check your plan and billing details" too, and is only a quota the chain
 * moves past, so for Google only the prepayment and billing wording counts. OpenAI's same sentence is
 * `insufficient_quota`, which is the balance. The text is `${status} ${body}`, so a bare 402 counts
 * where the provider uses it only for money (fal, ElevenLabs).
 */
export const PROVIDER_SIGNS: Record<FundsProvider, RegExp> = {
  fal: /user is locked|top_?up|exhausted balance|insufficient (?:balance|credits|funds)|^402\b/i,
  elevenlabs: /quota_exceeded|exceeds your quota|payment_required|insufficient[_ ](?:credits|funds)|^(?:ElevenLabs )?402\b/i,
  google: /credits are depleted|prepayment|requires billing|billing_disabled|billing (?:is )?(?:not enabled|disabled)/i,
  openai: /insufficient_quota|exceeded your current quota|billing_hard_limit/i,
};

/** Whether a provider's refusal reads as its account having no money left (never our own gateway's 402). */
export function isProviderFundsError(provider: FundsProvider, error: string): boolean {
  return PROVIDER_SIGNS[provider].test(error.trim());
}

/** The gateway's provider names that have a wallet; anything else (DeepSeek, the audio guide) is null. */
export function fundsProviderOf(provider: string): FundsProvider | null {
  return (FUNDS_PROVIDERS as readonly string[]).includes(provider) ? (provider as FundsProvider) : null;
}

/** An incident is wanted for a provider at most this often per instance: Sentry groups the rest anyway. */
export const ALARM_EVERY_MS = 10 * 60_000;

/** Where the functions note the last refusal per provider, for the admin panel's wallets. */
export const WALLET_ALARMS = 'rpgWalletAlarms';

export interface WalletAlarm {
  provider: FundsProvider;
  at: number;
  status: number | null;
  /** The provider's words, cut. */
  error: string;
  /** Which server path met it: `gateway`, `demo`, `proposals`. */
  where: string;
  count: number;
}
