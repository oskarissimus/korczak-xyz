/*
 * Showing a frame to a model, from the browser, on the reader's own key.
 *
 * Two providers, because those are the two that will look at an image for a key pasted into a web
 * page: OpenAI's chat completions and Google's `generateContent` — which serves Gemma as well as
 * Gemini, and Gemma (free on an AI Studio key) is the default since Oct 2026. DeepSeek is in sloper's list and
 * not in this one — it has no vision model — and that asymmetry is the reason this app has its own
 * provider list rather than sharing sloper's.
 *
 * There is no streaming here, unlike sloper's script step, and the difference is the point: a
 * scene list is worth watching arrive because it is long, and a twelve-word remark is not worth
 * the machinery. What matters instead is that the request can be ABANDONED. A ride is a queue of
 * these, and one that is still in flight when the next snapshot is due is a remark about a road
 * that is now behind you — so every call takes a signal and the caller aborts rather than waits.
 *
 * `max_tokens` is deliberately tight on both. It is a cost control on somebody else's bill, and
 * it is also the last line of defence behind `sanitizeRemark`: a model that decides to write an
 * essay is cut off at the wire rather than at the speaker.
 */

import { DEFAULT_GOOGLE_MODEL } from './defaults';
import type { Frame, VisionProvider } from './types';

/** Enough for one sentence in either language, with the room a model needs to finish it. */
const MAX_TOKENS = 120;

/**
 * Warm, because the whole app is a personality. sloper's script step exposes this as a slider;
 * here it is a constant — a predictable annoying passenger is a broken annoying passenger, and
 * there is no second use for the setting.
 */
const TEMPERATURE = 1;

/**
 * Gemini's own, a little hotter. Its range is 0–2 like OpenAI's, but at 1 it settled on one joke
 * shape per ride; 1.3 is where the remarks stopped sounding like each other without starting to
 * not sound like sentences.
 */
const GOOGLE_TEMPERATURE = 1.3;

export interface VisionRequest {
  provider: VisionProvider;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  frame: Frame;
  signal?: AbortSignal;
}

/**
 * The provider's own complaint, carried through as it came.
 *
 * Same rule as sloper: the sentence around an error is translated and the quote is not, because
 * the quote is the string you would paste into their support page. `status` is kept apart so the
 * caller can tell a rejected key (401/403, worth stopping the ride for) from a rate limit or a
 * blip (worth one dropped round).
 */
export class VisionError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'VisionError';
    this.status = status;
  }

  /** A key that will not start working by itself. Stopping the ride is the honest response. */
  get fatal(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function errorFrom(response: Response): Promise<VisionError> {
  const body = await response.json().catch(() => ({}));
  const message =
    body?.error?.message ||
    body?.message ||
    (response.status === 429 ? 'Rate limited by the provider' : `API error: ${response.status}`);
  return new VisionError(String(message), response.status);
}

async function askOpenAi(request: VisionRequest): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: request.signal,
    body: JSON.stringify({
      model: request.model,
      max_completion_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [
        { role: 'system', content: request.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: request.user },
            {
              type: 'image_url',
              /*
               * `detail: 'low'` is not a quality setting to be raised later. It caps the image at
               * one 512px tile, which is both what the frame already is (see `frame.ts`) and what
               * keeps a per-15-seconds vision call affordable on somebody's own key. A high-detail
               * read of a blurry windscreen photograph buys nothing a joke needs.
               */
              image_url: { url: request.frame.dataUrl, detail: 'low' },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw await errorFrom(response);

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * Gemma on Google's API refuses a `systemInstruction` outright — "Developer instruction is not
 * enabled for models/gemma-3-27b-it", a 400 on every round — so for Gemma the system prompt goes
 * at the head of the user turn instead, which is what Gemma's own chat template does with one.
 */
export function isGemma(model: string): boolean {
  return model.startsWith('gemma');
}

/**
 * Gemini thinks before it answers, and its thinking is counted against `maxOutputTokens`. With
 * the 120 a remark needs, a thinking model spent them all and the ride spoke one word of the
 * answer — "Boże," on gemini-pro-latest, the first time anybody picked it. So thinking is turned
 * off where it can be (a 2.5 Flash), turned down where it cannot (Pro, and the 3 family), and a
 * thinking model gets room to think and still finish the sentence. `sanitizeRemark` caps the
 * length that is spoken either way; the token cap here was only ever a backstop.
 */
/**
 * Flash models in the 3 family that have not refused `thinkingLevel: 'minimal'`.
 *
 * Thinking is most of the wait between the photograph and the voice: on `low`, a 3.x Flash thinks
 * for a second or two before writing an eighteen-word sentence, and the joke does not get better
 * for it — the angle, the persona and the banned shapes are all in the prompt already. `minimal`
 * is the Flash family's near-off. Pro does not take it, and a Flash that answers it with a 400 is
 * remembered here for the rest of the tab and asked again on `low` (`askGoogle`), so a model
 * Google ships without `minimal` costs one retried round rather than a ride of failures.
 */
const NO_MINIMAL = new Set<string>();

export function thinksMinimally(model: string): boolean {
  return /^gemini-([3-9][\d.]*-flash|flash(-lite)?-latest)/.test(model) && !NO_MINIMAL.has(model);
}

export function googleGeneration(model: string): Record<string, unknown> {
  const base = { temperature: GOOGLE_TEMPERATURE };
  if (isGemma(model)) return { ...base, maxOutputTokens: MAX_TOKENS };
  if (/^gemini-2\.5-flash/.test(model)) {
    return { ...base, maxOutputTokens: MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } };
  }
  if (/^gemini-2\.5-pro/.test(model)) {
    // The smallest budget 2.5 Pro takes; it cannot be turned off.
    return { ...base, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 128 } };
  }
  if (/^gemini-([3-9]|\w+-latest)/.test(model)) {
    // The 3 family takes a level rather than a budget, and an alias may be any of them. A Flash
    // goes to `minimal`, which is the latency fix of Oct 2026 — see `thinksMinimally`.
    const level = thinksMinimally(model) ? 'minimal' : 'low';
    return { ...base, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: level } };
  }
  return { ...base, maxOutputTokens: 2048 };
}

async function askGoogle(request: VisionRequest): Promise<string> {
  try {
    return await askGoogleOnce(request);
  } catch (e) {
    // A Flash that will not think minimally says so with a 400 naming the field; ask it again the
    // way every 3.x model accepts, and never ask it for `minimal` again in this tab.
    if (
      e instanceof VisionError &&
      e.status === 400 &&
      thinksMinimally(request.model) &&
      /thinking/i.test(e.message)
    ) {
      NO_MINIMAL.add(request.model);
      return askGoogleOnce(request);
    }
    throw e;
  }
}

async function askGoogleOnce(request: VisionRequest): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}` +
    `:generateContent?key=${encodeURIComponent(request.apiKey)}`;
  const gemma = isGemma(request.model);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: request.signal,
    body: JSON.stringify({
      // Gemini takes the system prompt in its own field rather than as a message, and putting it
      // in `contents` instead makes it one more thing the model may answer about. Gemma has no
      // such field (see `isGemma`), so there it leads the user turn.
      ...(gemma ? {} : { systemInstruction: { parts: [{ text: request.system }] } }),
      contents: [
        {
          role: 'user',
          parts: [
            // The image first: Google's guidance for a single image, and the order in which the
            // text reads as being about it.
            // Base64 without the data-URL prefix — Google rejects the whole payload if the
            // prefix is left on, with an error about the image rather than about the encoding.
            { inline_data: { mime_type: request.frame.mimeType, data: request.frame.base64 } },
            { text: gemma ? `${request.system}\n\n${request.user}` : request.user },
          ],
        },
      ],
      generationConfig: googleGeneration(request.model),
    }),
  });

  if (!response.ok) throw await errorFrom(response);

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: { text?: string }) => part?.text ?? '')
    .join('')
    .trim();
}

/** One frame in, one unsanitised line out. `remarks.ts` decides whether it is speakable. */
export function askForRemark(request: VisionRequest): Promise<string> {
  return request.provider === 'google' ? askGoogle(request) : askOpenAi(request);
}

/**
 * The vision models a key can reach.
 *
 * Same trick as sloper's: listing the models IS the validation call, so there is no separate
 * "check this key" button. The filtering is the part worth reading — a chat model that cannot see
 * an image fails at the first snapshot with a confusing error, so the list is narrowed to families
 * known to take one rather than shown whole.
 */
export interface ModelListResult {
  success: boolean;
  models: string[];
  error?: string;
}

/** OpenAI ids that can take an image. Prefix-matched, so dated snapshots come along. */
const OPENAI_VISION = ['gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-5', 'o3', 'o4-mini', 'chatgpt-4o'];

/** …minus the ones that share a prefix and cannot be used here. */
const OPENAI_EXCLUDED = ['audio', 'realtime', 'transcribe', 'tts', 'search', 'image'];

export function filterOpenAiVisionModels(ids: string[]): string[] {
  return ids
    .filter((id) => OPENAI_VISION.some((prefix) => id.startsWith(prefix)))
    .filter((id) => !OPENAI_EXCLUDED.some((bad) => id.includes(bad)))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Gemma ids on Google's API that read text only: the 1B, the 270M, and the 3n family (which takes
 * images on a device but not through `generateContent`).
 */
const GEMMA_TEXT_ONLY = ['-1b', '-270m', 'gemma-3n'];

/**
 * The default first, then Gemini, then Gemma largest first — the first entry is what the setup
 * sheet picks for you when the saved model is not on offer.
 */
function googleRank(id: string): [number, number] {
  if (id === DEFAULT_GOOGLE_MODEL) return [0, 0];
  if (!isGemma(id)) return [1, 0];
  const size = Number(/-(\d+)b-/.exec(id)?.[1] ?? 0);
  return [2, -size];
}

export function filterGoogleVisionModels(
  models: { name: string; supportedGenerationMethods?: string[] }[],
): string[] {
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    // Every current Gemini takes an image; the older text-only families and the embedders do not.
    .filter(
      (id) =>
        (id.startsWith('gemini') && !id.includes('embedding')) ||
        (isGemma(id) && !GEMMA_TEXT_ONLY.some((bad) => id.includes(bad))),
    )
    .sort((a, b) => {
      const [ga, sa] = googleRank(a);
      const [gb, sb] = googleRank(b);
      return ga - gb || sa - sb || a.localeCompare(b);
    });
}

function networkFailure(err: unknown): ModelListResult {
  return {
    success: false,
    models: [],
    error: err instanceof Error ? err.message : 'Network error fetching models',
  };
}

export async function fetchVisionModels(
  provider: VisionProvider,
  apiKey: string,
): Promise<ModelListResult> {
  if (!apiKey.trim()) return { success: false, models: [], error: 'API key is required' };

  try {
    if (provider === 'google') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      );
      if (!response.ok) {
        // Google answers a bad key with 400 as readily as 401.
        if ([400, 401, 403].includes(response.status)) {
          return { success: false, models: [], error: 'Invalid Google API key' };
        }
        const error = await response.json().catch(() => ({}));
        return {
          success: false,
          models: [],
          error: error?.error?.message || `API error: ${response.status}`,
        };
      }
      const data = await response.json();
      return { success: true, models: filterGoogleVisionModels(data?.models ?? []) };
    }

    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, models: [], error: 'Invalid OpenAI API key' };
      }
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        models: [],
        error: error?.error?.message || `API error: ${response.status}`,
      };
    }
    const data = await response.json();
    const ids = ((data?.data ?? []) as { id: string }[]).map((m) => m.id);
    return { success: true, models: filterOpenAiVisionModels(ids) };
  } catch (err) {
    return networkFailure(err);
  }
}
