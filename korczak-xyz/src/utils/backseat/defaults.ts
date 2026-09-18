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
  Intensity,
  KeyName,
  Persona,
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

export const MIN_INTERVAL = 6;
export const MAX_INTERVAL = 120;

/**
 * Where a Google setup starts.
 *
 * Named rather than inlined because `importKeys.ts` needs it: borrowing a Google-only set of keys
 * has to move the provider as well, and leaving the OpenAI default model behind would be a config
 * that names one provider and one of the other's models. If the guess is wrong for the account,
 * the model list replaces it as soon as it comes back.
 */
export const DEFAULT_GOOGLE_MODEL = 'gemini-2.5-flash';

export const DEFAULT_CONFIG: BackseatConfig = {
  apiKeys: { openai: null, google: null, elevenLabs: null },
  vision: { provider: 'openai', model: 'gpt-4o-mini' },
  remarks: { intervalSeconds: 15, persona: 'nervous', intensity: 'normal' },
  voice: {
    engine: 'device',
    deviceVoiceUri: '',
    // ElevenLabs' own "Rachel". Only read when the engine is theirs, and replaced the moment
    // somebody picks a voice from their account.
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    rate: 1,
  },
  camera: { facing: 'environment' },
};

const VISION_PROVIDERS: readonly VisionProvider[] = ['openai', 'google'];
const VOICE_ENGINES: readonly VoiceEngine[] = ['device', 'elevenlabs'];
const FACINGS: readonly CameraFacing[] = ['environment', 'user'];

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

  return {
    apiKeys: normalizeApiKeys(raw.apiKeys),
    vision: {
      provider: asOneOf(vision.provider, VISION_PROVIDERS, DEFAULT_CONFIG.vision.provider),
      model: asString(vision.model, DEFAULT_CONFIG.vision.model),
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
    },
    voice: {
      engine: asOneOf(voice.engine, VOICE_ENGINES, DEFAULT_CONFIG.voice.engine),
      deviceVoiceUri: asString(voice.deviceVoiceUri, DEFAULT_CONFIG.voice.deviceVoiceUri),
      voiceId: asString(voice.voiceId, DEFAULT_CONFIG.voice.voiceId),
      rate: asNumber(voice.rate, DEFAULT_CONFIG.voice.rate, 0.5, 2),
    },
    camera: {
      facing: asOneOf(camera.facing, FACINGS, DEFAULT_CONFIG.camera.facing),
    },
  };
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
