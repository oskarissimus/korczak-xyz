/*
 * The one request that costs money.
 *
 * A name, a category, a pair of coordinates and the place's story tags go out, with the reader's
 * two keys; an MP3 comes back, with the links its facts were taken from. Everything between -
 * reading the place up on Wikipedia and Wikidata, having a model pick facts out of that with a
 * quote for each, checking every quote, turning what survives into a script written for a speech
 * synthesiser, and paying ElevenLabs to read it - happens
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
import { parseServerTiming } from './telemetry';
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

/**
 * Space-separated, percent-encoded URLs of the sources the facts in this narration came from:
 * Wikipedia articles, a Wikidata item, the OpenStreetMap object. Only the ones a checked fact was
 * actually taken from.
 */
const SOURCES_HEADER = 'X-Guide-Sources';

export interface Narration {
  audioUrl: string;
  locationWarning: string | null;
  sources: string[];
  timing: NarrationTiming;
}

/**
 * How the request went, for the measurement `useAudioGuide` sends: when the headers arrived and
 * when the MP3 had finished downloading (both `performance.now()`), its size, and the function's
 * own stages from its Server-Timing header (`sources`, `facts`, `script`, `tts`, `total`, `cold`).
 */
export interface NarrationTiming {
  headersAt: number;
  bodyAt: number;
  bytes: number;
  server: Record<string, number>;
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
    /** `no_sources` when nothing checkable is known about the place; otherwise absent. */
    readonly code: string | null = null,
    /** How far the request got before it failed. Absent for a request that never answered. */
    readonly timing: NarrationTiming | null = null,
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
      osm: attraction.key,
      tags: attraction.tags,
    }),
    signal,
  });
  const headersAt = performance.now();
  // Exposed by the function's Access-Control-Expose-Headers; without that it reads as null.
  const server = parseServerTiming(response.headers.get('Server-Timing'));

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    throw new NarrationError(
      body?.error ?? `HTTP ${response.status}`,
      response.status,
      body?.code ?? null,
      { headersAt, bodyAt: performance.now(), bytes: 0, server },
    );
  }

  const blob = await response.blob();
  const timing = { headersAt, bodyAt: performance.now(), bytes: blob.size, server };
  // An empty header is not a warning. The function only sets it when it has something to say, but
  // a proxy that rewrites it to `""` would otherwise put a notice about accuracy on every guide.
  const warning = response.headers.get(LOCATION_WARNING_HEADER)?.trim();
  return {
    audioUrl: URL.createObjectURL(blob),
    locationWarning: warning ? warning : null,
    sources: parseSources(response.headers.get(SOURCES_HEADER)),
    timing,
  };
}

/** The sources header, as links. Anything that is not an https URL is dropped, not linked. */
export function parseSources(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(/\s+/)
    .filter((u) => {
      try {
        return new URL(u).protocol === 'https:';
      } catch {
        return false;
      }
    });
}

/** What a source link is called in the player: "Wikipedia (pl)", "Wikidata", "OpenStreetMap". */
export function sourceLabel(link: string): string {
  const host = new URL(link).hostname;
  const wiki = /^([a-z-]+)\.wikipedia\.org$/.exec(host);
  if (wiki) return `Wikipedia (${wiki[1]})`;
  if (host.endsWith('wikidata.org')) return 'Wikidata';
  if (host.endsWith('openstreetmap.org')) return 'OpenStreetMap';
  return host;
}

/**
 * What went wrong, as something the UI can put a sentence to.
 *
 * 401 is the function saying a key is missing or a provider refused one, which is the one failure
 * the reader can fix on the spot — the app opens the keys sheet for it. Everything else from a
 * provider arrives as a 502 carrying the provider's own sentence, so the status alone cannot tell a
 * rate limit from an exhausted account — hence the match on the text. It is deliberately loose: the
 * wording is the providers' to change, and `failed` is a perfectly good answer when they do.
 *
 * `no-sources` is not a failure of anything. The function found no source about the place, or
 * none of the facts the model picked out survived the check against their quotes, and said so
 * rather than narrating a guess - the one answer it gives by `code` rather than by wording.
 */
export type GuideFailure = 'keys' | 'rate-limited' | 'quota' | 'no-sources' | 'failed';

export function classifyNarrationFailure(e: unknown): GuideFailure {
  if (!(e instanceof NarrationError)) return 'failed';
  // Nothing failed: nothing checkable is known about the place, so no guide was made up for it.
  if (e.code === 'no_sources') return 'no-sources';
  // Before the 401: ElevenLabs answers an exhausted quota with a 401 of its own, and sending the
  // reader to re-paste a key that is fine would be the wrong advice.
  if (/quota|billing|credit|insufficient/i.test(e.message)) return 'quota';
  if (e.status === 401) return 'keys';
  if (e.status === 429) return 'rate-limited';
  if (/rate.?limit|too many requests|\b429\b/i.test(e.message)) return 'rate-limited';
  return 'failed';
}

export { BACKEND_URL };
