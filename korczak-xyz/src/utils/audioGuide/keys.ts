/*
 * The keys a guide is paid with, and who writes it.
 *
 * Since Oct 2026 the keys are the account's, one copy shared by every app on the site
 * (`utils/accountKeys/`, `users/{uid}/keys/config`), and so is the one choice this app has: who
 * writes the guide. Until then the guide kept its own copy under `audio-guide-config` and
 * `users/{uid}/audioGuide/config`, borrowed from sloper and the backseat driver on a first visit;
 * those copies seeded the shared store and were emptied.
 *
 * What is unchanged is where they go next. The other apps call the providers from the page; this
 * one hands the keys to its own Go function with each request (`narration.ts`), because a guide is
 * four steps and a minute of MP3 rather than one call. The function uses them for that request and
 * keeps nothing. It takes Google's path when `X-Google-Key` is set and OpenAI's when only
 * `X-OpenAI-Key` is — so the writer is chosen by which of the two is sent, and only one ever is.
 *
 * Everything in this file is pure.
 */

import type { AudioGuideWriter } from '../accountKeys/keys';

export type { AudioGuideWriter };

export type KeyName = 'google' | 'openai' | 'elevenLabs';

/** What a tap needs: the writer, its key, and ElevenLabs to read it out. */
export interface ApiKeys {
  writer: AudioGuideWriter;
  google: string | null;
  openai: string | null;
  elevenLabs: string | null;
}

export const NO_KEYS: ApiKeys = { writer: 'google', google: null, openai: null, elevenLabs: null };

/** The keys the current writer needs, in the order the sheet shows them. */
export function requiredKeys(keys: Pick<ApiKeys, 'writer'>): KeyName[] {
  return [keys.writer, 'elevenLabs'];
}

/** What a tap still needs. Empty means a guide can be asked for. */
export function missingKeys(keys: ApiKeys): KeyName[] {
  return requiredKeys(keys).filter((name) => !keys[name]);
}

/** The two headers a request carries: the writer's key, and ElevenLabs'. Never both writers. */
export function keyHeaders(keys: ApiKeys): Record<string, string> {
  return {
    [keys.writer === 'openai' ? 'X-OpenAI-Key' : 'X-Google-Key']:
      (keys.writer === 'openai' ? keys.openai : keys.google) ?? '',
    'X-ElevenLabs-Key': keys.elevenLabs ?? '',
  };
}
