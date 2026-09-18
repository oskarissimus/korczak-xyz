import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONFIG,
  MAX_INTERVAL,
  MIN_INTERVAL,
  canStart,
  missingKeys,
  normalizeConfig,
  requiredKeys,
} from './defaults';

/*
 * `normalizeConfig` is fed three things it does not control: a localStorage blob written by an
 * older build, a Firestore document written by another device, and whatever `JSON.parse` made of
 * either. The rule every test below checks is the same one: a bad field degrades to its default
 * and never to `undefined`, because `undefined` reaches the UI as `NaN` and the provider as a 400.
 */
describe('normalizeConfig', () => {
  it('gives the defaults for nothing at all', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig('a string')).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig([])).toEqual(DEFAULT_CONFIG);
  });

  it('keeps what a well-formed document says', () => {
    const config = normalizeConfig({
      apiKeys: { openai: 'sk-abc', google: 'AIza', elevenLabs: 'el-xyz' },
      vision: { provider: 'google', model: 'gemini-2.5-flash' },
      remarks: { intervalSeconds: 30, persona: 'codriver', intensity: 'relentless' },
      voice: { engine: 'elevenlabs', deviceVoiceUri: 'x', voiceId: 'v1', rate: 1.3 },
      camera: { facing: 'user' },
    });

    expect(config.apiKeys.openai).toBe('sk-abc');
    expect(config.vision).toEqual({ provider: 'google', model: 'gemini-2.5-flash' });
    expect(config.remarks).toEqual({
      intervalSeconds: 30,
      persona: 'codriver',
      intensity: 'relentless',
    });
    expect(config.voice.engine).toBe('elevenlabs');
    expect(config.voice.rate).toBeCloseTo(1.3);
    expect(config.camera.facing).toBe('user');
  });

  it('trims a key and reads an empty one as not set', () => {
    // Whitespace is how a half-pasted key arrives, and `''` and null must not be two states.
    const config = normalizeConfig({ apiKeys: { openai: '  sk-abc  ', google: '   ' } });
    expect(config.apiKeys.openai).toBe('sk-abc');
    expect(config.apiKeys.google).toBeNull();
  });

  /*
   * The interval floor is not a preference. Below it the passenger talks over its own last
   * sentence, and every tick is a vision call on somebody's own key.
   */
  it('clamps the interval to something a passenger can actually speak in', () => {
    expect(normalizeConfig({ remarks: { intervalSeconds: 1 } }).remarks.intervalSeconds).toBe(
      MIN_INTERVAL,
    );
    expect(normalizeConfig({ remarks: { intervalSeconds: 9000 } }).remarks.intervalSeconds).toBe(
      MAX_INTERVAL,
    );
    expect(normalizeConfig({ remarks: { intervalSeconds: 20.6 } }).remarks.intervalSeconds).toBe(21);
  });

  it('clamps the speaking rate to what both engines accept', () => {
    expect(normalizeConfig({ voice: { rate: 0 } }).voice.rate).toBe(0.5);
    expect(normalizeConfig({ voice: { rate: 99 } }).voice.rate).toBe(2);
    expect(normalizeConfig({ voice: { rate: 'fast' } }).voice.rate).toBe(DEFAULT_CONFIG.voice.rate);
  });

  it('falls back on any value outside a closed list', () => {
    expect(normalizeConfig({ vision: { provider: 'anthropic' } }).vision.provider).toBe('openai');
    expect(normalizeConfig({ remarks: { persona: 'dog' } }).remarks.persona).toBe('nervous');
    expect(normalizeConfig({ remarks: { intensity: 'loud' } }).remarks.intensity).toBe('normal');
    expect(normalizeConfig({ voice: { engine: 'azure' } }).voice.engine).toBe('device');
    expect(normalizeConfig({ camera: { facing: 'left' } }).camera.facing).toBe('environment');
  });

  it('degrades one bad field without taking the rest with it', () => {
    const config = normalizeConfig({
      apiKeys: { openai: 'sk-abc' },
      vision: { provider: 'google', model: 42 },
      remarks: { intervalSeconds: null, persona: 'parent' },
    });

    expect(config.vision.provider).toBe('google');
    expect(config.vision.model).toBe(DEFAULT_CONFIG.vision.model);
    expect(config.remarks.intervalSeconds).toBe(DEFAULT_CONFIG.remarks.intervalSeconds);
    expect(config.remarks.persona).toBe('parent');
  });
});

describe('which keys a ride actually needs', () => {
  it('asks only for the provider that is selected', () => {
    expect(requiredKeys(DEFAULT_CONFIG)).toEqual(['openai']);
    expect(
      requiredKeys({ ...DEFAULT_CONFIG, vision: { provider: 'google', model: 'x' } }),
    ).toEqual(['google']);
  });

  /* The whole reason the device synthesiser is the default: one key and the app runs. */
  it('does not ask for an ElevenLabs key until an ElevenLabs voice is chosen', () => {
    expect(requiredKeys(DEFAULT_CONFIG)).not.toContain('elevenLabs');
    expect(
      requiredKeys({
        ...DEFAULT_CONFIG,
        voice: { ...DEFAULT_CONFIG.voice, engine: 'elevenlabs' },
      }),
    ).toContain('elevenLabs');
  });

  it('reports exactly what is missing', () => {
    expect(missingKeys(DEFAULT_CONFIG)).toEqual(['openai']);
    expect(
      missingKeys({ ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys, openai: 'sk' } }),
    ).toEqual([]);
  });
});

describe('canStart', () => {
  const withKey = { ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys, openai: 'sk' } };

  it('wants a key and a model, and says no without either', () => {
    expect(canStart(DEFAULT_CONFIG)).toBe(false);
    expect(canStart(withKey)).toBe(true);
    expect(canStart({ ...withKey, vision: { ...withKey.vision, model: '  ' } })).toBe(false);
  });
});
