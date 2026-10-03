/*
 * The settings a first ride starts from, and the one function that turns anything claiming to be
 * a saved config back into one.
 *
 * `normalizeConfig` is as paranoid as sloper's and for the same three reasons: it is fed a
 * localStorage blob written by an older build, a Firestore document written by another device,
 * and whatever `JSON.parse` made of either. Every field is checked against the defaults rather
 * than spread over them, so a document that lost a key — or gained a string where a number
 * belongs — degrades to the default for that one field instead of putting `undefined` somewhere
 * the UI reads as `NaN` and the provider answers with a 400.
 *
 * The one number here that is not a preference is `intervalSeconds`, whose floor is 6. Below that
 * the passenger is talking over its own last sentence, every snapshot costs a vision call, and a
 * phone on mobile data is uploading a frame faster than it can speak about one. The ceiling is
 * 120 because a passenger silent for longer than two minutes is not the joke this app is.
 */

import type {
  ApiKeys,
  BackseatConfig,
  CameraFacing,
  ElevenModel,
  Intensity,
  KeyName,
  Persona,
  RemarkLanguage,
  VisionProvider,
  VoiceEngine,
} from './types';

export const KEY_NAMES: readonly KeyName[] = ['openai', 'google', 'elevenLabs'];

export const PERSONAS: readonly Persona[] = [
  'nervous',
  'instructor',
  'parent',
  'child',
  'codriver',
];

export const INTENSITIES: readonly Intensity[] = ['mild', 'normal', 'relentless'];

export const REMARK_LANGUAGES: readonly RemarkLanguage[] = ['en', 'pl'];

export const MIN_INTERVAL = 6;
export const MAX_INTERVAL = 120;

/**
 * Where a Google setup starts, and since Oct 2026 where every setup starts.
 *
 * Google rather than OpenAI because of the bill: the OpenAI account this app was first run on ran
 * out of credit mid-drive ("You have no credits remaining"), and Gemini Flash-Lite is free on an
 * ordinary AI Studio key. Gemma is on the list too (see FIRST_GOOGLE_MODEL for why it is not the
 * default).
 *
 * Named rather than inlined because `importKeys.ts` needs it. If the guess is wrong for the
 * account, the model list replaces it as soon as it comes back.
 */
export const DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash-lite';

/**
 * The default for the first hour after the switch, and not a good one: on the first ride it
 * answered a road with a heading ("Nervous passenger.") rather than a remark, and its jokes were
 * flat. Flash-Lite is free on the same key (15 a minute, about a thousand a day, so four hours of
 * riding at fifteen seconds), follows a system prompt it is actually given, and is moved onto from
 * this once (`switchedToGoogle`).
 */
export const FIRST_GOOGLE_MODEL = 'gemma-3-27b-it';

/** Where an OpenAI setup starts — only ever chosen by hand, or borrowed with an OpenAI-only set. */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export function defaultModelFor(provider: VisionProvider): string {
  return provider === 'google' ? DEFAULT_GOOGLE_MODEL : DEFAULT_OPENAI_MODEL;
}

export const DEFAULT_CONFIG: BackseatConfig = {
  apiKeys: { openai: null, google: null, elevenLabs: null },
  vision: { provider: 'google', model: DEFAULT_GOOGLE_MODEL },
  remarks: { intervalSeconds: 15, persona: 'nervous', intensity: 'normal', language: null },
  voice: {
    engine: 'device',
    deviceVoiceUri: '',
    // ElevenLabs' own "Rachel". Only read when the engine is theirs, and replaced the moment
    // somebody picks a voice from their account.
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    elevenModel: 'eleven_flash_v2_5',
    rate: 1,
  },
  camera: { facing: 'environment' },
};

const VISION_PROVIDERS: readonly VisionProvider[] = ['openai', 'google'];
const VOICE_ENGINES: readonly VoiceEngine[] = ['device', 'elevenlabs'];
const FACINGS: readonly CameraFacing[] = ['environment', 'user'];
export const ELEVEN_MODELS: readonly ElevenModel[] = ['eleven_flash_v2_5', 'eleven_multilingual_v2'];

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

export function normalizeConfig(value: unknown): BackseatConfig {
  const raw = asRecord(value);
  const vision = asRecord(raw.vision);
  const remarks = asRecord(raw.remarks);
  const voice = asRecord(raw.voice);
  const camera = asRecord(raw.camera);

  const provider = asOneOf(vision.provider, VISION_PROVIDERS, DEFAULT_CONFIG.vision.provider);

  return {
    apiKeys: normalizeApiKeys(raw.apiKeys),
    vision: {
      provider,
      // The fallback follows the provider: one provider's name with the other's model is a 404.
      model: asString(vision.model, defaultModelFor(provider)),
    },
    remarks: {
      intervalSeconds: asInt(
        remarks.intervalSeconds,
        DEFAULT_CONFIG.remarks.intervalSeconds,
        MIN_INTERVAL,
        MAX_INTERVAL,
      ),
      persona: asOneOf(remarks.persona, PERSONAS, DEFAULT_CONFIG.remarks.persona),
      intensity: asOneOf(remarks.intensity, INTENSITIES, DEFAULT_CONFIG.remarks.intensity),
      language:
        typeof remarks.language === 'string' &&
        (REMARK_LANGUAGES as readonly string[]).includes(remarks.language)
          ? (remarks.language as RemarkLanguage)
          : null,
    },
    voice: {
      engine: asOneOf(voice.engine, VOICE_ENGINES, DEFAULT_CONFIG.voice.engine),
      deviceVoiceUri: asString(voice.deviceVoiceUri, DEFAULT_CONFIG.voice.deviceVoiceUri),
      voiceId: asString(voice.voiceId, DEFAULT_CONFIG.voice.voiceId),
      elevenModel: asOneOf(voice.elevenModel, ELEVEN_MODELS, DEFAULT_CONFIG.voice.elevenModel),
      rate: asNumber(voice.rate, DEFAULT_CONFIG.voice.rate, 0.5, 2),
    },
    camera: {
      facing: asOneOf(camera.facing, FACINGS, DEFAULT_CONFIG.camera.facing),
    },
  };
}

/** The language the passenger speaks: the one chosen, or the page's until somebody chooses. */
export function remarkLanguage(config: BackseatConfig, pageLang: RemarkLanguage): RemarkLanguage {
  return config.remarks.language ?? pageLang;
}

/** BCP-47 for the device synthesiser. */
export function speechLocale(lang: RemarkLanguage): string {
  return lang === 'pl' ? 'pl-PL' : 'en-GB';
}

/**
 * Which keys this configuration actually needs.
 *
 * The vision key is never optional — without a model looking at the road there is nothing to say.
 * The ElevenLabs key is needed only when their voice is the one chosen, which is the whole reason
 * the device synthesiser is the default: one key and the app runs.
 */
export function requiredKeys(config: BackseatConfig): KeyName[] {
  const needed: KeyName[] = [config.vision.provider === 'openai' ? 'openai' : 'google'];
  if (config.voice.engine === 'elevenlabs') needed.push('elevenLabs');
  return needed;
}

/** Everything missing before Start means anything. */
export function missingKeys(config: BackseatConfig): KeyName[] {
  return requiredKeys(config).filter((name) => !config.apiKeys[name]);
}

/** Whether a ride could begin at all: every required key present, and a model chosen. */
export function canStart(config: BackseatConfig): boolean {
  return missingKeys(config).length === 0 && config.vision.model.trim() !== '';
}
