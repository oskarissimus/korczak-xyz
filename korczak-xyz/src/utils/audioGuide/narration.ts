/*
 * The one request that costs money.
 *
 * A name, a category and a pair of coordinates go out; an MP3 comes back. Everything between -
 * reverse geocoding the coordinates with Nominatim, asking a model for facts, turning those into
 * a script written for a speech synthesiser, and paying ElevenLabs to read it - happens inside a
 * Cloud Function, because all three steps need API keys and a key in a static page is a key
 * anybody can spend.
 *
 * The backend is `audio-guide-function/` at the root of this repository - Go, deployed with gcloud
 * to `korczak-xyz-501720` beside the site's other functions. It came from
 * `oskarissimus/audio-guide-v2` (project `prompt-compressor-1`) in Sep 2026.
 *
 * BACKEND_URL still names the OLD deployment until the new one holds both provider keys and has
 * answered a real request; flipping it to
 * `https://europe-central2-korczak-xyz-501720.cloudfunctions.net/generate-audio` is the cutover.
 * `.claude/rules/audio-guide.md` has the sequence.
 */

import type { Attraction } from './types';

const BACKEND_URL = 'https://us-central1-prompt-compressor-1.cloudfunctions.net/generate-audio';

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
  signal: AbortSignal,
): Promise<Narration> {
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
 * The function collapses OpenAI's and ElevenLabs' failures into one 502 carrying a short reason,
 * so the status alone cannot tell a rate limit from an exhausted account — hence the match on the
 * reason text. It is deliberately loose: the wording is the providers' to change, and `failed` is
 * a perfectly good answer when they do. A 500 is the function's own "Service configuration error",
 * which means its keys are missing and no amount of retrying will help.
 */
export type GuideFailure = 'rate-limited' | 'quota' | 'config' | 'failed';

export function classifyNarrationFailure(e: unknown): GuideFailure {
  if (!(e instanceof NarrationError)) return 'failed';
  if (e.status === 429) return 'rate-limited';
  if (e.status === 500) return 'config';
  if (/quota|billing|credit|insufficient/i.test(e.message)) return 'quota';
  if (/rate.?limit|too many requests|\b429\b/i.test(e.message)) return 'rate-limited';
  return 'failed';
}

export { BACKEND_URL };
