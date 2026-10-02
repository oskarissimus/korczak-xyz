/*
 * The account's API keys: one store every app reads.
 *
 * Until Oct 2026 each app that spends somebody's API credit kept its own copy of the keys — sloper
 * in `users/{uid}/sloper/config`, the backseat driver in `users/{uid}/backseat/config`, the audio
 * guide in `users/{uid}/audioGuide/config` — and the second and third apps *borrowed* from the
 * first on a first visit. That worked and had the cost `.claude/rules/backseat.md` was honest
 * about: three documents holding the same OpenAI key, so revoking one meant clearing it three
 * times, and a key you thought was gone could still be working next door. This file is the shape
 * that note said was the better one: `users/{uid}/keys/config`, read by every app, edited from the
 * account page or from any app's own key fields, which now write here.
 *
 * WHERE THE KEYS LIVE IS UNCHANGED, AND DELIBERATELY. In this browser's localStorage and in the
 * account's own Firestore document, under the `users/{uid}/{document=**}` catch-all — not in
 * Secret Manager behind a function of ours. The reasoning is sloper's and still holds: the keys are
 * in the clear in the page's memory every time it calls a provider, and the only design that keeps
 * them out of the browser is a server of ours making every call with them, which is a much larger
 * thing to own and puts this site on the hook for the bill. Moving them into one document changes
 * how many copies there are, not who can read them.
 *
 * LAST WRITE WINS, WHOLESALE, ON ONE `updatedAt`, and `settled` written on purpose — the two rules
 * every per-app copy was built on, for the same two bugs (a cleared key resurrected from another
 * device's copy; a document that exists as a side effect of a sync being mistaken for a decision).
 *
 * Everything in this file is pure, so it can be pinned by a test without a browser.
 */

/** Every key an app on this site can spend. `openaiAdmin` spends nothing: it only reads costs. */
export type KeyName = 'openai' | 'google' | 'elevenLabs' | 'deepseek' | 'openaiAdmin';

export const KEY_NAMES: readonly KeyName[] = [
  'openai',
  'google',
  'elevenLabs',
  'deepseek',
  'openaiAdmin',
];

export type ApiKeys = Record<KeyName, string | null>;

export const NO_KEYS: ApiKeys = {
  openai: null,
  google: null,
  elevenLabs: null,
  deepseek: null,
  openaiAdmin: null,
};

/** Who writes an audio guide. ElevenLabs reads it either way. */
export type AudioGuideWriter = 'google' | 'openai';

/**
 * A balance somebody read off a provider's billing page and typed in, because the provider has no
 * API that would tell us. In US dollars, and stamped, so the page can say how old it is and — for
 * OpenAI with a usage key — subtract what was spent since.
 */
export interface ManualBalance {
  amount: number;
  at: number;
}

export interface AccountKeys {
  apiKeys: ApiKeys;
  /** OpenAI's prepaid credit as last read off its billing page. See `ManualBalance`. */
  openaiCredit: ManualBalance | null;
  /** The audio guide's one provider choice; sloper and the backseat driver keep theirs. */
  audioGuideWriter: AudioGuideWriter;
}

export const DEFAULT_ACCOUNT_KEYS: AccountKeys = {
  apiKeys: NO_KEYS,
  openaiCredit: null,
  // Google since Oct 2026, when the OpenAI account ran dry. See `.claude/rules/audio-guide.md`.
  audioGuideWriter: 'google',
};

export interface StampedAccountKeys {
  value: AccountKeys;
  /** When this copy was last edited, by whichever device edited it. 0 means "never". */
  updatedAt: number;
  /** Somebody has decided what the keys here are. Nothing is ever seeded into a settled copy. */
  settled: boolean;
}

/** A trimmed non-empty string, or null. The rule every app has written keys with. */
export function asKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The keys out of anything with an `apiKeys` object — this store, or any app's old config, which
 * all spell them the same way. Tolerant on purpose: it reads blobs written by older builds of
 * other apps, and the worst case has to be nulls rather than a throw.
 */
export function keysFrom(value: unknown): ApiKeys {
  const apiKeys = record(record(value).apiKeys);
  const result = { ...NO_KEYS };
  for (const name of KEY_NAMES) result[name] = asKey(apiKeys[name]);
  return result;
}

function balanceFrom(value: unknown): ManualBalance | null {
  const raw = record(value);
  const amount = raw.amount;
  const at = raw.at;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  return { amount, at };
}

export function normalizeAccountKeys(value: unknown): AccountKeys {
  const raw = record(value);
  return {
    apiKeys: keysFrom(raw),
    openaiCredit: balanceFrom(raw.openaiCredit),
    audioGuideWriter: raw.audioGuideWriter === 'openai' ? 'openai' : 'google',
  };
}

export function anyKey(keys: ApiKeys): boolean {
  return KEY_NAMES.some((name) => Boolean(keys[name]));
}

/** Only an empty copy nobody has decided is seeded. The second half stops a cleared key returning. */
export function shouldSeed(keys: ApiKeys, settled: boolean): boolean {
  return !settled && !anyKey(keys);
}

/** One app's old copy of the keys, and when that app last saved it. */
export interface KeySource {
  keys: ApiKeys;
  updatedAt: number;
}

/**
 * The keys to start the store from, out of the apps' old copies.
 *
 * Per key, from the most recently edited copy that has one: somebody may have pasted a new Google
 * key into the audio guide last night while sloper still holds last month's. Per key rather than
 * per copy, because the backseat driver never held DeepSeek and the guide never held it either.
 */
export function seedKeys(sources: KeySource[]): ApiKeys {
  const newestFirst = [...sources].sort((a, b) => b.updatedAt - a.updatedAt);
  const result = { ...NO_KEYS };
  for (const name of KEY_NAMES) {
    result[name] = newestFirst.find((source) => source.keys[name])?.keys[name] ?? null;
  }
  return result;
}

/** A config with its `updatedAt`, read tolerantly. 0 when there is none. */
export function stampOf(value: unknown): number {
  const updatedAt = record(value).updatedAt;
  return typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0;
}

/** The account page, where every key and what is left on it is shown. */
export function accountPath(lang: 'en' | 'pl'): string {
  return lang === 'pl' ? '/pl/account/' : '/account/';
}
