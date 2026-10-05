import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONFIG,
  DEFAULT_LIVE_MODEL,
  MAX_INTERVAL,
  QUICK_ROAST_INTERVAL,
  MIN_INTERVAL,
  canStart,
  demoRestrictions,
  missingKeys,
  normalizeConfig,
  quickRoastConfig,
  remarkLanguage,
  requiredKeys,
} from './defaults';
import { FLAVOURS } from './flavour';

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
      language: null,
    });
    expect(config.voice.engine).toBe('elevenlabs');
    expect(config.voice.rate).toBeCloseTo(1.3);
    // Saved before the model was a setting: Flash, the fast one.
    expect(config.voice.elevenModel).toBe('eleven_flash_v2_5');
    expect(
      normalizeConfig({ voice: { elevenModel: 'eleven_multilingual_v2' } }).voice.elevenModel,
    ).toBe('eleven_multilingual_v2');
    expect(normalizeConfig({ voice: { elevenModel: 'nope' } }).voice.elevenModel).toBe(
      'eleven_flash_v2_5',
    );
    expect(config.camera.facing).toBe('user');
  });

  it('keeps a chosen passenger language and reads anything else as not chosen', () => {
    expect(normalizeConfig({ remarks: { language: 'pl' } }).remarks.language).toBe('pl');
    expect(normalizeConfig({ remarks: { language: 'en' } }).remarks.language).toBe('en');
    expect(normalizeConfig({ remarks: { language: 'de' } }).remarks.language).toBeNull();
    expect(normalizeConfig({ remarks: {} }).remarks.language).toBeNull();
  });

  it('speaks the page language until one is chosen', () => {
    expect(remarkLanguage(DEFAULT_CONFIG, 'pl')).toBe('pl');
    const english = normalizeConfig({ remarks: { language: 'en' } });
    expect(remarkLanguage(english, 'pl')).toBe('en');
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

  it('falls back to the model of the provider that was saved, not the default provider', () => {
    expect(normalizeConfig({ vision: { provider: 'openai' } }).vision.model).toBe('gpt-4o-mini');
    expect(normalizeConfig({}).vision).toEqual({ provider: 'google', model: 'gemini-2.5-flash-lite' });
  });

  it('falls back on any value outside a closed list', () => {
    expect(normalizeConfig({ vision: { provider: 'anthropic' } }).vision.provider).toBe('google');
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
    expect(requiredKeys(DEFAULT_CONFIG)).toEqual(['google']);
    expect(
      requiredKeys({ ...DEFAULT_CONFIG, vision: { provider: 'openai', model: 'x' } }),
    ).toEqual(['openai']);
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
    expect(missingKeys(DEFAULT_CONFIG)).toEqual(['google']);
    expect(
      missingKeys({ ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys, google: 'AIza' } }),
    ).toEqual([]);
  });
});

describe('canStart', () => {
  const withKey = { ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys, google: 'AIza' } };

  it('wants a key and a model, and says no without either', () => {
    expect(canStart(DEFAULT_CONFIG)).toBe(false);
    expect(canStart(withKey)).toBe(true);
    expect(canStart({ ...withKey, vision: { ...withKey.vision, model: '  ' } })).toBe(false);
  });
});

/*
 * The demo rides on the site's key, and these three are what that changes about the settings. Each
 * was a way for the app to be wrong: a demo that asked for a key it does not need, a Start button
 * dead for want of a model the function chooses, and a Live session that cannot be lent because
 * its key goes in a WebSocket URL.
 */
describe('the demo', () => {
  const demo = { ...DEFAULT_CONFIG, demoMode: true };

  it('asks for no key at all', () => {
    expect(requiredKeys(demo)).toEqual([]);
    expect(missingKeys(demo)).toEqual([]);
    expect(canStart(demo)).toBe(true);
  });

  /* An ElevenLabs voice is the reader's own key on the reader's own bill either way, so it is
     still asked for — and it is the one key field the sheet keeps while the demo is on. */
  it('still asks for ElevenLabs when an ElevenLabs voice is chosen', () => {
    const withEleven = { ...demo, voice: { ...demo.voice, engine: 'elevenlabs' as const } };
    expect(requiredKeys(withEleven)).toEqual(['elevenLabs']);
    expect(canStart(withEleven)).toBe(false);
  });

  it('starts without a model, because the function picks it', () => {
    expect(canStart({ ...demo, vision: { ...demo.vision, model: '' } })).toBe(true);
  });

  it('moves a demo ride off Gemini Live and puts the function\'s floor under the interval', () => {
    const restricted = demoRestrictions(
      { ...demo, voice: { ...demo.voice, engine: 'live' }, remarks: { ...demo.remarks, intervalSeconds: 6 } },
      12,
    );
    expect(restricted.voice.engine).toBe('device');
    expect(restricted.remarks.intervalSeconds).toBe(12);
  });

  it('leaves a slower interval and an ElevenLabs voice alone', () => {
    const restricted = demoRestrictions(
      { ...demo, voice: { ...demo.voice, engine: 'elevenlabs' }, remarks: { ...demo.remarks, intervalSeconds: 30 } },
      12,
    );
    expect(restricted.voice.engine).toBe('elevenlabs');
    expect(restricted.remarks.intervalSeconds).toBe(30);
  });

  it('is a pass-through when the demo is off', () => {
    expect(demoRestrictions(DEFAULT_CONFIG, 60)).toBe(DEFAULT_CONFIG);
  });

  it('is off unless the stored config says so in so many words', () => {
    expect(normalizeConfig({}).demoMode).toBe(false);
    expect(normalizeConfig({ demoMode: 'yes' }).demoMode).toBe(false);
    expect(normalizeConfig({ demoMode: true }).demoMode).toBe(true);
  });
});

describe('quickRoastConfig', () => {
  it('is Live, front camera, the default comic, every three seconds, in the chosen language', () => {
    const saved = normalizeConfig({}, FLAVOURS.roaster);
    const quick = quickRoastConfig(saved, { liveModel: 'gemini-x-flash-live', lang: 'en' });
    expect(quick.demoMode).toBe(true);
    expect(quick.voice.engine).toBe('live');
    expect(quick.voice.liveModel).toBe('gemini-x-flash-live');
    expect(quick.camera.facing).toBe('user');
    expect(quick.remarks.persona).toBe('comedian');
    expect(quick.remarks.intervalSeconds).toBe(QUICK_ROAST_INTERVAL);
    expect(quick.remarks.language).toBe('en');
    // Nothing a Live demo would ask a key for.
    expect(canStart(quick)).toBe(true);
    // And the saved settings are not touched.
    expect(saved.demoMode).toBe(false);
  });

  it('falls back to the default Live model when the status named none', () => {
    const quick = quickRoastConfig(normalizeConfig({}, FLAVOURS.roaster), { liveModel: '', lang: 'pl' });
    expect(quick.voice.liveModel).toBe(DEFAULT_LIVE_MODEL);
  });
});
