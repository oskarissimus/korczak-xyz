/*
 * The settings a fresh sitting starts from, and the one function that turns anything claiming to
 * be a saved config back into one.
 *
 * `normalizeConfig` is deliberately paranoid, because it is fed three different things: a
 * localStorage blob written by an older build, a Firestore document written by another device,
 * and — through the two of them — whatever a `JSON.parse` happened to produce. Every field is
 * checked against the defaults rather than spread over them, so a document that lost a key, or
 * gained a string where a number belongs, degrades to the default for that one field instead of
 * putting `undefined` somewhere the UI will read as `NaN`.
 *
 * `nanoBanana` is migrated to `google` here. That was sloper's own name for the Gemini image
 * provider before Google settled on one, and a browser that last opened sloper on GitHub Pages
 * still has it in localStorage.
 */

import type {
  ApiKeys,
  ImageProvider,
  ImageQuality,
  KeyName,
  LlmProvider,
  SloperConfig,
  TtsPlan,
} from './types';

export const KEY_NAMES: readonly KeyName[] = ['openai', 'deepseek', 'google', 'elevenLabs'];

export const DEFAULT_CONFIG: SloperConfig = {
  apiKeys: { openai: null, deepseek: null, google: null, elevenLabs: null },
  llm: { provider: 'openai', model: '' },
  video: {
    resolution: { width: 1024, height: 1536 },
    frameRate: 24,
    numScenes: 1,
    targetDuration: 3,
  },
  image: { provider: 'openai', model: 'gpt-image-1', quality: 'low' },
  tts: {
    model: 'eleven_multilingual_v2',
    voiceId: 'Bx2lBwIZJBilRBVc3AGO',
    speed: 1.1,
    concurrency: 4,
    plan: 'starter',
  },
  temperature: 0.7,
};

const LLM_PROVIDERS: readonly LlmProvider[] = ['openai', 'deepseek'];
const IMAGE_PROVIDERS: readonly ImageProvider[] = ['openai', 'google'];
const QUALITIES: readonly ImageQuality[] = ['low', 'medium', 'high'];
export const TTS_PLANS: readonly TtsPlan[] = [
  'free',
  'starter',
  'creator',
  'pro',
  'scale',
  'business',
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** A trimmed non-empty string, or null. Whitespace is how a half-pasted key arrives. */
function asKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(asNumber(value, fallback, min, max));
}

function asOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function normalizeApiKeys(value: unknown): ApiKeys {
  const raw = asRecord(value);
  const keys = { ...DEFAULT_CONFIG.apiKeys };
  for (const name of KEY_NAMES) keys[name] = asKey(raw[name]);
  return keys;
}

export function normalizeConfig(value: unknown): SloperConfig {
  const raw = asRecord(value);
  const llm = asRecord(raw.llm);
  const video = asRecord(raw.video);
  const resolution = asRecord(video.resolution);
  const image = asRecord(raw.image);
  const tts = asRecord(raw.tts);

  // sloper shipped the Gemini provider as `nanoBanana` first.
  const imageProvider = image.provider === 'nanoBanana' ? 'google' : image.provider;
  const aspectRatio = typeof image.aspectRatio === 'string' && image.aspectRatio
    ? image.aspectRatio
    : undefined;

  return {
    apiKeys: normalizeApiKeys(raw.apiKeys),
    llm: {
      provider: asOneOf(llm.provider, LLM_PROVIDERS, DEFAULT_CONFIG.llm.provider),
      model: asString(llm.model, DEFAULT_CONFIG.llm.model),
    },
    video: {
      resolution: {
        // 4096 is the backend's own ceiling — see functions/src/sloper/assemble.ts.
        width: asInt(resolution.width, DEFAULT_CONFIG.video.resolution.width, 16, 4096),
        height: asInt(resolution.height, DEFAULT_CONFIG.video.resolution.height, 16, 4096),
      },
      frameRate: asInt(video.frameRate, DEFAULT_CONFIG.video.frameRate, 1, 60),
      numScenes: asInt(video.numScenes, DEFAULT_CONFIG.video.numScenes, 1, 100),
      targetDuration: asInt(video.targetDuration, DEFAULT_CONFIG.video.targetDuration, 1, 3600),
    },
    image: {
      provider: asOneOf(imageProvider, IMAGE_PROVIDERS, DEFAULT_CONFIG.image.provider),
      model: asString(image.model, DEFAULT_CONFIG.image.model),
      quality: asOneOf(image.quality, QUALITIES, DEFAULT_CONFIG.image.quality),
      ...(aspectRatio ? { aspectRatio } : {}),
    },
    tts: {
      model: asString(tts.model, DEFAULT_CONFIG.tts.model),
      voiceId: asString(tts.voiceId, DEFAULT_CONFIG.tts.voiceId),
      speed: asNumber(tts.speed, DEFAULT_CONFIG.tts.speed, 0.5, 2),
      concurrency: asInt(tts.concurrency, DEFAULT_CONFIG.tts.concurrency, 1, 10),
      plan: asOneOf(tts.plan, TTS_PLANS, DEFAULT_CONFIG.tts.plan),
    },
    temperature: asNumber(raw.temperature, DEFAULT_CONFIG.temperature, 0, 1),
  };
}

/** Which key the LLM half of a sitting needs, and which the image half does. */
export function requiredKeys(config: SloperConfig): KeyName[] {
  const needed = new Set<KeyName>(['elevenLabs']);
  needed.add(config.llm.provider === 'openai' ? 'openai' : 'deepseek');
  needed.add(config.image.provider === 'openai' ? 'openai' : 'google');
  return [...needed];
}

/** Everything a sitting needs before the Start button means anything. */
export function missingKeys(config: SloperConfig): KeyName[] {
  return requiredKeys(config).filter((name) => !config.apiKeys[name]);
}
