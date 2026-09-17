import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, missingKeys, normalizeConfig, requiredKeys } from './defaults';

/*
 * `normalizeConfig` is fed three things it does not control: a localStorage blob written by an
 * older build, a Firestore document written by another device, and whatever `JSON.parse` made of
 * either. The tests below are the shapes that have actually turned up or plausibly will, and the
 * rule they all check is the same one: one bad field degrades to its default and never to
 * `undefined`, because `undefined` reaches the UI as `NaN` and the provider as a 400.
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
      apiKeys: { openai: 'sk-abc', elevenLabs: 'el-xyz' },
      llm: { provider: 'deepseek', model: 'deepseek-chat' },
      video: { resolution: { width: 1920, height: 1080 }, frameRate: 30, numScenes: 6, targetDuration: 45 },
      image: { provider: 'google', model: 'imagen-4', quality: 'high', aspectRatio: '16:9' },
      tts: { model: 'eleven_turbo_v2', voiceId: 'abc', speed: 1.4, concurrency: 8, plan: 'pro' },
      temperature: 0.2,
    });

    expect(config.apiKeys.openai).toBe('sk-abc');
    expect(config.llm).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
    expect(config.video.resolution).toEqual({ width: 1920, height: 1080 });
    expect(config.image.aspectRatio).toBe('16:9');
    expect(config.tts.plan).toBe('pro');
    expect(config.temperature).toBe(0.2);
  });

  /* sloper shipped the Gemini image provider under its codename before Google settled on one. */
  it('migrates the nanoBanana provider to google', () => {
    expect(normalizeConfig({ image: { provider: 'nanoBanana' } }).image.provider).toBe('google');
  });

  it('falls back on a value outside the allowed set rather than storing it', () => {
    const config = normalizeConfig({
      llm: { provider: 'anthropic' },
      image: { provider: 'midjourney', quality: 'ultra' },
      tts: { plan: 'enterprise' },
    });
    expect(config.llm.provider).toBe('openai');
    expect(config.image.provider).toBe('openai');
    expect(config.image.quality).toBe('low');
    expect(config.tts.plan).toBe('starter');
  });

  /*
   * The bounds matter twice over: once so a slider cannot render off its track, and once because
   * these numbers become ffmpeg arguments on a machine we pay for — see the same limits restated
   * in functions/src/sloper/metadata.ts, which does not trust this one.
   */
  it('clamps numbers into range and refuses non-numbers', () => {
    const wild = normalizeConfig({
      video: { resolution: { width: 99999, height: -4 }, frameRate: 240, numScenes: 0, targetDuration: 1e9 },
      tts: { speed: 9, concurrency: 400 },
      temperature: 7,
    });
    expect(wild.video.resolution.width).toBe(4096);
    expect(wild.video.resolution.height).toBe(16);
    expect(wild.video.frameRate).toBe(60);
    expect(wild.video.numScenes).toBe(1);
    expect(wild.video.targetDuration).toBe(3600);
    expect(wild.tts.speed).toBe(2);
    expect(wild.tts.concurrency).toBe(10);
    expect(wild.temperature).toBe(1);

    const junk = normalizeConfig({
      video: { frameRate: '30', numScenes: null },
      temperature: Number.NaN,
    });
    expect(junk.video.frameRate).toBe(DEFAULT_CONFIG.video.frameRate);
    expect(junk.video.numScenes).toBe(DEFAULT_CONFIG.video.numScenes);
    expect(junk.temperature).toBe(DEFAULT_CONFIG.temperature);
  });

  /* A half-pasted key arrives with whitespace, and `' '` must not read as "set". */
  it('trims a key and treats an empty one as absent', () => {
    const config = normalizeConfig({
      apiKeys: { openai: '  sk-abc  ', deepseek: '   ', google: '', elevenLabs: 42 },
    });
    expect(config.apiKeys.openai).toBe('sk-abc');
    expect(config.apiKeys.deepseek).toBeNull();
    expect(config.apiKeys.google).toBeNull();
    expect(config.apiKeys.elevenLabs).toBeNull();
  });

  it('leaves aspectRatio off entirely rather than storing an empty string', () => {
    expect(normalizeConfig({ image: { aspectRatio: '' } })).not.toHaveProperty('image.aspectRatio');
    expect('aspectRatio' in normalizeConfig({ image: { aspectRatio: '' } }).image).toBe(false);
  });
});

describe('requiredKeys', () => {
  it('asks for the narration key plus whichever providers are selected', () => {
    expect(requiredKeys(DEFAULT_CONFIG).sort()).toEqual(['elevenLabs', 'openai']);

    const split = normalizeConfig({
      llm: { provider: 'deepseek' },
      image: { provider: 'google' },
    });
    expect(requiredKeys(split).sort()).toEqual(['deepseek', 'elevenLabs', 'google']);
  });

  /* One OpenAI key covers both halves when both halves are OpenAI — it must not be asked for twice. */
  it('names the shared OpenAI key once', () => {
    expect(requiredKeys(DEFAULT_CONFIG).filter((k) => k === 'openai')).toHaveLength(1);
  });
});

describe('missingKeys', () => {
  it('is empty once everything a sitting needs is set', () => {
    const ready = normalizeConfig({
      apiKeys: { openai: 'sk-a', elevenLabs: 'el-b' },
      llm: { provider: 'openai', model: 'gpt-4o' },
      image: { provider: 'openai' },
    });
    expect(missingKeys(ready)).toEqual([]);
  });

  it('does not ask for a key the selected providers never use', () => {
    const ready = normalizeConfig({
      apiKeys: { openai: 'sk-a', elevenLabs: 'el-b' },
      image: { provider: 'openai' },
    });
    // No Google and no DeepSeek key, and neither is wanted.
    expect(missingKeys(ready)).not.toContain('google');
    expect(missingKeys(ready)).not.toContain('deepseek');
  });
});
