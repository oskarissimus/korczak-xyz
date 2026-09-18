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
 * WHAT MAKES IT SAFE TO DO ONCE. There is no flag and no marker, because there is already a fact
 * that means the same thing: whether this browser has ever written `backseat-config`. Nothing is
 * borrowed over a config that exists, and every edit — including clearing a key, and including
 * Clear everything, which writes the defaults back — creates one. So a key deliberately cleared
 * here is never resurrected from sloper's copy on the next load, which is the same rule the
 * account sync is built on and the one bug worth going out of the way to avoid.
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
