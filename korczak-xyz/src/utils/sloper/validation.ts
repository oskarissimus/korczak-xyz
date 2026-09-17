/*
 * "Is this key real, and what will it let me use?"
 *
 * Every provider answers both questions with the same request — list the models — so validating a
 * key and populating its dropdown are one call, which is why the config screen never has a
 * separate "check key" button for the two that have a model list.
 *
 * A network failure and a rejected key are kept apart on purpose: the first is `success: false`
 * with the browser's message, the second with the provider's. Reporting a flat "invalid key" for
 * a phone that lost signal is how somebody comes to re-paste a key that was fine.
 */

export interface ModelFetchResult {
  success: boolean;
  models: string[];
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Substrings that mean "not a chat model". Matched against the id, so `tts` also drops
 * `gpt-4o-mini-tts` — which is the point, since nothing here would know what to do with it.
 */
const OPENAI_EXCLUDED = [
  'whisper', 'tts', 'dall-e', 'embedding', 'moderation', 'babbage', 'davinci',
  'realtime', 'transcribe', 'diarize', 'search', 'audio', 'codex',
];
const DEEPSEEK_EXCLUDED = ['embedding'];

function filterAndSort(models: string[], excluded: string[]): string[] {
  return models
    .filter((id) => !excluded.some((ex) => id.toLowerCase().includes(ex)))
    .sort((a, b) => a.localeCompare(b));
}

function networkFailure(err: unknown): ModelFetchResult {
  return {
    success: false,
    models: [],
    error: err instanceof Error ? err.message : 'Network error fetching models',
  };
}

async function fetchBearerModels(
  url: string,
  apiKey: string,
  excluded: string[],
  showAll: boolean,
  invalidKeyMessage: string,
): Promise<ModelFetchResult> {
  if (!apiKey.trim()) return { success: false, models: [], error: 'API key is required' };

  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, models: [], error: invalidKeyMessage };
      }
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        models: [],
        error: error.error?.message || `API error: ${response.status}`,
      };
    }

    const data = await response.json();
    const all = (data.data as { id: string }[]).map((m) => m.id);
    return {
      success: true,
      models: showAll ? [...all].sort((a, b) => a.localeCompare(b)) : filterAndSort(all, excluded),
    };
  } catch (err) {
    return networkFailure(err);
  }
}

export function fetchOpenAiModels(apiKey: string, showAll = false): Promise<ModelFetchResult> {
  return fetchBearerModels(
    'https://api.openai.com/v1/models',
    apiKey,
    OPENAI_EXCLUDED,
    showAll,
    'Invalid OpenAI API key',
  );
}

export function fetchDeepSeekModels(apiKey: string, showAll = false): Promise<ModelFetchResult> {
  return fetchBearerModels(
    'https://api.deepseek.com/v1/models',
    apiKey,
    DEEPSEEK_EXCLUDED,
    showAll,
    'Invalid DeepSeek API key',
  );
}

/**
 * Google's image models, both families.
 *
 * `generateContent` is Gemini's and `predict` is Imagen's, and the app calls two different
 * endpoints for them (see images.ts) — so both are kept, and the name is what decides which.
 */
export async function fetchGeminiImageModels(apiKey: string): Promise<ModelFetchResult> {
  if (!apiKey.trim()) return { success: false, models: [], error: 'API key is required' };

  try {
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
        error: error.error?.message || `API error: ${response.status}`,
      };
    }

    const data = await response.json();
    const models = (data.models as { name: string; supportedGenerationMethods?: string[] }[])
      .filter(
        (m) =>
          m.name.includes('image') &&
          (m.supportedGenerationMethods?.includes('generateContent') ||
            m.supportedGenerationMethods?.includes('predict')),
      )
      .map((m) => m.name.replace('models/', ''))
      .sort((a, b) => a.localeCompare(b));

    return { success: true, models };
  } catch (err) {
    return networkFailure(err);
  }
}

/**
 * ElevenLabs, which has no model list worth showing — the four models are a fixed dropdown — so
 * this is the one key with a validation call of its own, made when Start is pressed.
 */
export async function validateElevenLabsKey(apiKey: string): Promise<ValidationResult> {
  if (!apiKey.trim()) return { valid: false, error: 'ElevenLabs API key is required' };

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    });

    if (response.ok) return { valid: true };
    if (response.status === 401) return { valid: false, error: 'Invalid ElevenLabs API key' };

    const error = await response.json().catch(() => ({}));
    return {
      valid: false,
      error: error.detail?.message || error.message || `API error: ${response.status}`,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Network error validating API key',
    };
  }
}
