/*
 * The two API keys a guide is paid with, and where a first visit borrows them from.
 *
 * The same arrangement as sloper's and the backseat driver's, on purpose: an app that holds
 * somebody's keys should not differ from the other two in where it puts them or who can read them.
 * They live in localStorage under `audio-guide-config` and, for the signed-in account this app
 * always has, in `users/{uid}/audioGuide/config` under the `users/{uid}/{document=**}` rule — see
 * `keyStorage.ts` and `keyCloud.ts`. The reasoning for storing them at all is sloper's and is in
 * `.claude/rules/sloper.md`.
 *
 * The one difference is where they go next. The other two apps call the providers from the page;
 * this one hands them to its own Go function with each request (`narration.ts`), because a guide is
 * four steps and a minute of MP3 rather than one call. The function uses them for that request and
 * keeps nothing.
 *
 * Everything in this file is pure, so the borrow can be pinned by a test without a browser.
 */

export type KeyName = 'openai' | 'elevenLabs';

export type ApiKeys = Record<KeyName, string | null>;

export const NO_KEYS: ApiKeys = { openai: null, elevenLabs: null };

/** Both are needed for every guide: OpenAI writes it, ElevenLabs reads it. */
export const KEY_NAMES: readonly KeyName[] = ['openai', 'elevenLabs'];

export interface StampedKeys {
  keys: ApiKeys;
  /** When this copy was last edited, by whichever device edited it. 0 means "never". */
  updatedAt: number;
  /** True while the keys on screen were borrowed from another app rather than typed here. */
  borrowed: boolean;
  /**
   * Somebody has decided what the keys here are — typed one, cleared one, or pressed Clear. The
   * backseat driver's flag, for the backseat driver's reason: a fact that exists as a side-effect
   * of a sync (a document being there) cannot carry the meaning "do not borrow into this", and the
   * version of that app which tried shipped broken. See `.claude/rules/backseat.md`.
   */
  settled: boolean;
}

/** A trimmed non-empty string, or null. The same rule the other two apps write keys with. */
function asKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The two keys out of anything with an `apiKeys` object — this app's own config, sloper's, or the
 * backseat driver's, which all spell them `openai` and `elevenLabs`.
 *
 * Tolerant by design: it reads blobs written by older builds of other apps, and the worst case has
 * to be two nulls rather than a throw on a page that was working a moment ago.
 */
export function keysFrom(value: unknown): ApiKeys {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const apiKeys =
    typeof raw.apiKeys === 'object' && raw.apiKeys !== null
      ? (raw.apiKeys as Record<string, unknown>)
      : {};
  return { openai: asKey(apiKeys.openai), elevenLabs: asKey(apiKeys.elevenLabs) };
}

export function anyKey(keys: ApiKeys): boolean {
  return Boolean(keys.openai || keys.elevenLabs);
}

/** What a tap still needs. Empty means a guide can be asked for. */
export function missingKeys(keys: ApiKeys): KeyName[] {
  return KEY_NAMES.filter((name) => !keys[name]);
}

/**
 * Whether to borrow into this copy: only when it holds nothing *and* nobody has decided that it
 * should. The second condition is what stops a key cleared here being resurrected from another
 * app's copy on the next load, which is the one bug worth going out of the way to avoid.
 */
export function shouldBorrow(keys: ApiKeys, settled: boolean): boolean {
  return !settled && !anyKey(keys);
}

/**
 * The keys to start from, given the other apps' copies in order of preference.
 *
 * Per key, first source that has it: sloper keeps both, the backseat driver keeps ElevenLabs only
 * when a voice of theirs is picked, and somebody may have typed OpenAI into one and ElevenLabs into
 * the other. Taking whole configs would leave half the pair behind.
 */
export function borrowKeys(sources: ApiKeys[]): ApiKeys {
  const result: ApiKeys = { ...NO_KEYS };
  for (const name of KEY_NAMES) {
    result[name] = sources.find((source) => source[name])?.[name] ?? null;
  }
  return result;
}
