/*
 * Borrowing the keys from the video generation wizard.
 *
 * Both apps are paid for with the same three keys off the same three accounts, and somebody who
 * has already pasted an OpenAI key into `/apps/sloper/` should not be asked for it a second time
 * to hear a passenger complain about a lorry. So a browser — or an account — that has never saved
 * a Backseat config starts from sloper's.
 *
 * WHAT THIS IS NOT. It is not a shared key store, and the difference matters the first time
 * somebody revokes something. After the borrow there are two copies: editing a key here does not
 * change it there, and clearing it there does not clear it here. The setup sheet says so in a line
 * under the key, because a key that appears in an app you never typed it into is startling, and a
 * key you think you have revoked in one place is worse. The one-store version — both apps reading
 * `users/{uid}/keys/…` — is the better shape and is a migration of a working app's live data; see
 * `.claude/rules/backseat.md` for where that stands.
 *
 * WHAT MAKES IT SAFE TO DO ONCE. `settled` — one boolean, stored beside `updatedAt` in both
 * localStorage and the account document, meaning **somebody has decided what the keys here are**.
 * Every edit sets it, including clearing a key and including Clear everything. Nothing is ever
 * borrowed into a settled config, so a key deliberately cleared here is never resurrected from
 * sloper's copy on the next load — the same rule the account sync is built on, and the one bug
 * worth going out of the way to avoid.
 *
 * It was originally the absence of a `backseat-config` in localStorage, on the grounds that the
 * absence meant the same thing and cost nothing to store. **That was wrong for the account half
 * and shipped broken.** `useBackseatConfig` pushes a config up the first time somebody opens the
 * app signed in, keys or no keys, so within minutes of the app going live there were accounts
 * holding an empty document with a recent `updatedAt` — which then beat the borrow for ever,
 * because the borrow only ran when there was no document at all. A fact that exists as a
 * side-effect of a sync cannot carry a meaning the sync does not know about; the flag has to be
 * written on purpose. Configs predating the flag have no `settled`, which reads as false, so they
 * borrow once and are then settled — which is exactly the repair those accounts need.
 *
 * DEEPSEEK IS DROPPED ON THE WAY THROUGH. sloper keeps four keys; this app has no use for the
 * fourth, DeepSeek having no model that can look at a photograph.
 */

import { describeError, log } from '../../lib/logger';
import { DEFAULT_CONFIG, DEFAULT_GOOGLE_MODEL } from './defaults';
import type { ApiKeys, BackseatConfig } from './types';

/** sloper's own localStorage keys, named here rather than imported — see the note in cloud.ts. */
const SLOPER_CONFIG_KEY = 'sloper-config';
const SLOPER_LEGACY_CONFIG_KEY = 'sloper-api-config';

/** A trimmed non-empty string, or null. The same rule sloper wrote the key with. */
function asKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The three keys this app can use, out of anything shaped like a sloper config.
 *
 * Deliberately tolerant: it is fed a localStorage blob written by an older build of a different
 * app and a Firestore document written by another device, and the worst case has to be three
 * nulls rather than a throw on a page that was working a moment ago.
 */
export function keysFromSloper(value: unknown): ApiKeys {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const apiKeys =
    typeof raw.apiKeys === 'object' && raw.apiKeys !== null
      ? (raw.apiKeys as Record<string, unknown>)
      : {};

  return {
    openai: asKey(apiKeys.openai),
    google: asKey(apiKeys.google),
    elevenLabs: asKey(apiKeys.elevenLabs),
  };
}

/** Whether a set of keys has anything in it at all. */
export function anyKey(keys: ApiKeys): boolean {
  return Boolean(keys.openai || keys.google || keys.elevenLabs);
}

/** Whether this config is still holding none of its own. Nothing is ever borrowed over a key. */
export function hasNoKeys(config: BackseatConfig): boolean {
  return !anyKey(config.apiKeys);
}

/**
 * The whole decision, in one place so that both halves of the borrow ask the same question and so
 * that it can be tested without a browser or a React renderer.
 *
 * Two conditions and they are not the same one: keys already here mean there is nothing to borrow
 * into, and `settled` means there is nothing to borrow into *on purpose*. The second is the only
 * thing standing between a deliberately cleared key and its own resurrection.
 */
export function shouldBorrow(config: BackseatConfig, settled: boolean): boolean {
  return !settled && hasNoKeys(config);
}

/**
 * The keys sloper left in this browser, if any.
 *
 * The legacy name is read too, for the same reason sloper reads it: a browser that last opened the
 * app on GitHub Pages may carry it, and this is a cheap place to catch that.
 */
export function sloperKeysInBrowser(): ApiKeys {
  const empty = { openai: null, google: null, elevenLabs: null };
  if (typeof window === 'undefined') return empty;

  try {
    const raw =
      localStorage.getItem(SLOPER_CONFIG_KEY) ?? localStorage.getItem(SLOPER_LEGACY_CONFIG_KEY);
    if (!raw) return empty;
    return keysFromSloper(JSON.parse(raw));
  } catch (e) {
    // A corrupt config belonging to a different app is not this app's problem to fix, but a
    // silent nothing here reads as "the import does not work", so it is worth one line.
    log.warn('backseat.import.sloper.failed', describeError(e));
    return empty;
  }
}

/**
 * The config to start from, given borrowed keys.
 *
 * The provider is moved to whichever key actually turned up, which is the difference between the
 * import working and the import looking broken: the default provider is OpenAI, so borrowing a
 * Google-only setup would fill in a key the app then never asks for and leave Start dead with
 * nothing on screen explaining why. The model moves with it; if that guess is wrong for the
 * account, the model list replaces it as soon as it comes back.
 */
export function configWithBorrowedKeys(base: BackseatConfig, keys: ApiKeys): BackseatConfig {
  const googleOnly = !keys.openai && Boolean(keys.google);

  return {
    ...base,
    apiKeys: { ...base.apiKeys, ...keys },
    vision: googleOnly
      ? { provider: 'google', model: DEFAULT_GOOGLE_MODEL }
      : base.vision,
  };
}

/** The whole borrow, for a browser that has never saved a config of its own. */
export function borrowFromBrowser(): { config: BackseatConfig; borrowed: boolean } {
  const keys = sloperKeysInBrowser();
  if (!anyKey(keys)) return { config: DEFAULT_CONFIG, borrowed: false };
  return { config: configWithBorrowedKeys(DEFAULT_CONFIG, keys), borrowed: true };
}
