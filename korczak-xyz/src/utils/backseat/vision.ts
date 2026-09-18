/*
 * Showing a frame to a model, from the browser, on the reader's own key.
 *
 * Two providers, because those are the two that will look at an image for a key pasted into a web
 * page: OpenAI's chat completions and Google's `generateContent`. DeepSeek is in sloper's list and
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

import type { Frame, VisionProvider } from './types';

/** Enough for one sentence in either language, with the room a model needs to finish it. */
const MAX_TOKENS = 120;

/**
 * Warm, because the whole app is a personality. sloper's script step exposes this as a slider;
 * here it is a constant — a predictable annoying passenger is a broken annoying passenger, and
 * there is no second use for the setting.
 */
const TEMPERATURE = 1;

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

async function askGoogle(request: VisionRequest): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}` +
    `:generateContent?key=${encodeURIComponent(request.apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: request.signal,
    body: JSON.stringify({
      // Google takes the system prompt in its own field rather than as a message, and putting it
      // in `contents` instead makes it one more thing the model may answer about.
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: request.user },
            // Base64 without the data-URL prefix — Google rejects the whole payload if the
            // prefix is left on, with an error about the image rather than about the encoding.
            { inline_data: { mime_type: request.frame.mimeType, data: request.frame.base64 } },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: TEMPERATURE },
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

export function filterGoogleVisionModels(
  models: { name: string; supportedGenerationMethods?: string[] }[],
): string[] {
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    // Every current Gemini takes an image; the older text-only families and the embedders do not.
    .filter((id) => id.startsWith('gemini') && !id.includes('embedding'))
    .sort((a, b) => a.localeCompare(b));
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
