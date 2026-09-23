/*
 * The one request that costs money.
 *
 * A name, a category and a pair of coordinates go out, with the reader's two keys; an MP3 comes
 * back. Everything between - reverse geocoding with Nominatim, asking a model for facts, turning
 * those into a script written for a speech synthesiser, and paying ElevenLabs to read it - happens
 * in `audio-guide-function/` at the root of this repository: Go, deployed with gcloud to
 * `korczak-xyz-501720` beside the site's other functions. It came from `oskarissimus/audio-guide-v2`
 * (project `prompt-compressor-1`) in Sep 2026.
 *
 * The keys are the reader's, typed into the keys sheet or borrowed from sloper or the backseat
 * driver (`keys.ts`), and travel in two headers on every request. The function uses them for that
 * one guide and keeps nothing - which is also why it can answer anybody: a stranger posting here
 * pays for their own guide.
 */

import type { ApiKeys } from './keys';
import type { Attraction } from './types';

const BACKEND_URL = 'https://europe-central2-korczak-xyz-501720.cloudfunctions.net/generate-audio';

/**
 * The header the function sets when Nominatim could not tell it where the coordinates are.
 *
 * It is a warning rather than a failure: the narration is still written and still read aloud,
 * from the name and the category alone, and is more likely to be generic or to be about a
 * different place of the same name in another country. The reader is told so.
 */
const LOCATION_WARNING_HEADER = 'X-Location-Warning';

export interface Narration {
  audioUrl: string;
  locationWarning: string | null;
}

/**
 * What the backend said went wrong, if it said anything.
 *
 * Its error bodies are `{"error": "..."}` and in English, and they are shown verbatim for the
 * same reason the other apps show a provider's words verbatim: it is the sentence you would
 * paste into a support page. The sentence around it is translated; the quote is not.
 */
export class NarrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NarrationError';
  }
}

/**
 * Ask for one narration.
 *
 * `language` is a free-text language name rather than a locale code, because it is going into a
 * prompt: the model is told to write in it, and "Polski", "Spanish" and "Bavarian German" are all
 * things it can honour where `pl-PL` is only a hint. The voice is multilingual, so nothing else
 * has to change with it.
 *
 * The blob is turned into an object URL here and never into a data URL: an MP3 of a minute's
 * speech is tens of kilobytes of base64 per second of audio, and iOS will not stream from a data
 * URL the way it streams from a blob.
 */
export async function requestNarration(
  attraction: Attraction,
  language: string,
  keys: ApiKeys,
  signal: AbortSignal,
): Promise<Narration> {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Named in the function's Access-Control-Allow-Headers; a header it does not list fails the
      // preflight and the tap with it.
      'X-OpenAI-Key': keys.openai ?? '',
      'X-ElevenLabs-Key': keys.elevenLabs ?? '',
    },
    body: JSON.stringify({
      name: attraction.name,
      category: attraction.category,
      latitude: attraction.lat,
      longitude: attraction.lon,
      language,
    }),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new NarrationError(body?.error ?? `HTTP ${response.status}`, response.status);
  }

  const blob = await response.blob();
  // An empty header is not a warning. The function only sets it when it has something to say, but
  // a proxy that rewrites it to `""` would otherwise put a notice about accuracy on every guide.
  const warning = response.headers.get(LOCATION_WARNING_HEADER)?.trim();
  return {
    audioUrl: URL.createObjectURL(blob),
    locationWarning: warning ? warning : null,
  };
}

/**
 * What went wrong, as something the UI can put a sentence to.
 *
 * 401 is the function saying a key is missing or a provider refused one, which is the one failure
 * the reader can fix on the spot — the app opens the keys sheet for it. Everything else from a
 * provider arrives as a 502 carrying the provider's own sentence, so the status alone cannot tell a
 * rate limit from an exhausted account — hence the match on the text. It is deliberately loose: the
 * wording is the providers' to change, and `failed` is a perfectly good answer when they do.
 */
export type GuideFailure = 'keys' | 'rate-limited' | 'quota' | 'failed';

export function classifyNarrationFailure(e: unknown): GuideFailure {
  if (!(e instanceof NarrationError)) return 'failed';
  // Before the 401: ElevenLabs answers an exhausted quota with a 401 of its own, and sending the
  // reader to re-paste a key that is fine would be the wrong advice.
  if (/quota|billing|credit|insufficient/i.test(e.message)) return 'quota';
  if (e.status === 401) return 'keys';
  if (e.status === 429) return 'rate-limited';
  if (/rate.?limit|too many requests|\b429\b/i.test(e.message)) return 'rate-limited';
  return 'failed';
}

export { BACKEND_URL };
