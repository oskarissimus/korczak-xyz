/*
 * The one-time move off OpenAI, for a config saved before Google was the default.
 *
 * This file used to be the borrow: a backseat config that had never been saved started from the
 * video generation wizard's keys, with a `settled` flag to stop a cleared key being borrowed back.
 * Since Oct 2026 the keys are the account's, one copy shared by every app (`utils/accountKeys/`),
 * and there is nothing left to borrow. The name stays because the move below still takes a key
 * from somewhere: the shared store's Google key, laid over `config.apiKeys` by the caller.
 */

import { DEFAULT_GOOGLE_MODEL, FIRST_GOOGLE_MODEL } from './defaults';
import type { BackseatConfig } from './types';

/**
 * When the default moved from OpenAI to Google (1 Oct 2026, 10:00 UTC). A config last edited
 * before it was set up on OpenAI because that was all there was, and is moved over once.
 */
export const GOOGLE_SWITCH_AT = Date.UTC(2026, 9, 1, 10, 0);

/** When the Google default moved from Gemma to Gemini Flash-Lite, after the first ride on it. */
export const SMARTER_SWITCH_AT = Date.UTC(2026, 9, 1, 11, 10);

/**
 * The one-time move of a config saved on OpenAI to Gemma, with a Google key from wherever one is
 * — this config, or the wizard's copy. Null when there is nothing to do or no key to do it with.
 *
 * Keyed on `updatedAt` rather than a new flag: the move itself is an edit stamped now, and so is
 * any choice somebody makes afterwards, so a config that is put back on OpenAI by hand is never
 * moved again. The OpenAI account ran dry mid-drive and its owner could not paste a key from the
 * car — which is why this borrows into a settled config, the one thing the borrow otherwise never
 * does. It only ever adds a Google key where there was none; it clears nothing.
 */
export function switchedToGoogle(
  config: BackseatConfig,
  updatedAt: number,
  sloperGoogleKey: string | null,
): BackseatConfig | null {
  // Moved onto Gemma by the first version of this, before anybody chose it: on to Flash-Lite.
  if (
    config.vision.provider === 'google' &&
    config.vision.model === FIRST_GOOGLE_MODEL &&
    updatedAt < SMARTER_SWITCH_AT
  ) {
    return { ...config, vision: { provider: 'google', model: DEFAULT_GOOGLE_MODEL } };
  }
  if (config.vision.provider !== 'openai' || updatedAt >= GOOGLE_SWITCH_AT) return null;
  const google = config.apiKeys.google ?? sloperGoogleKey;
  if (!google) return null;
  return {
    ...config,
    apiKeys: { ...config.apiKeys, google },
    vision: { provider: 'google', model: DEFAULT_GOOGLE_MODEL },
  };
}
