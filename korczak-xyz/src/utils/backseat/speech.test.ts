import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ELEVENLABS_MAX_SPEED,
  ELEVENLABS_MIN_SPEED,
  fetchElevenLabsVoices,
  pickVoice,
  speechTimeoutMs,
  splitSpeed,
  type DeviceVoice,
} from './speech';

const voices: DeviceVoice[] = [
  { uri: 'urn:moz-tts:osx:com.apple.speech.synthesis.voice.daniel', name: 'Daniel', lang: 'en-GB' },
  { uri: 'urn:moz-tts:osx:com.apple.speech.synthesis.voice.zosia', name: 'Zosia', lang: 'pl-PL' },
  { uri: 'urn:moz-tts:osx:com.apple.speech.synthesis.voice.alex', name: 'Alex', lang: 'en-US' },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * A saved `voiceURI` outlives the voice it names: voices come and go with OS updates and with the
 * language packs somebody has downloaded. Left unresolved, the synthesiser falls back to whatever
 * it likes, which reads Polish in English phonetics.
 */
describe('pickVoice', () => {
  it('takes the chosen voice when it is still installed', () => {
    expect(pickVoice(voices, voices[1].uri, 'pl-PL')?.name).toBe('Zosia');
  });

  it('falls back to the language when the chosen voice has gone', () => {
    expect(pickVoice(voices, 'urn:gone', 'pl-PL')?.name).toBe('Zosia');
    expect(pickVoice(voices, '', 'en-GB')?.name).toBe('Daniel');
  });

  it('matches on the language rather than the region', () => {
    // en-AU has no voice here; an English one is much better than a Polish one.
    expect(pickVoice(voices, '', 'en-AU')?.lang).toMatch(/^en/);
  });

  it('is null when there is nothing to choose from, or nothing in that language', () => {
    expect(pickVoice([], 'anything', 'en-GB')).toBeNull();
    expect(pickVoice(voices, '', 'de-DE')).toBeNull();
  });
});

/*
 * `onend` does not always fire — a cancelled or interrupted utterance can leave the promise
 * pending for ever, and a ride whose speaker never reports finishing goes silent for the rest of
 * the journey with nothing in any log.
 */
describe('speechTimeoutMs', () => {
  it('grows with the length of the line', () => {
    expect(speechTimeoutMs('Hi.', 1)).toBeLessThan(speechTimeoutMs('word '.repeat(25), 1));
  });

  it('allows more time for a slower voice', () => {
    expect(speechTimeoutMs('word '.repeat(25), 0.5)).toBeGreaterThan(
      speechTimeoutMs('word '.repeat(25), 2),
    );
  });

  it('stays within bounds a ride can live with', () => {
    expect(speechTimeoutMs('', 1)).toBeGreaterThanOrEqual(4000);
    expect(speechTimeoutMs('x'.repeat(10000), 0.5)).toBeLessThanOrEqual(30000);
  });
});

/*
 * The app's rate slider runs 0.5–2, because that is what a speech synthesiser takes. ElevenLabs
 * answers 422 to anything outside 0.7–1.2 — and it does so BEFORE generating any audio, so an
 * out-of-range rate lost the whole remark rather than merely speaking it at the wrong speed. That
 * is half of why the ElevenLabs voice was silent while the device voice was fine.
 */
describe('splitSpeed', () => {
  it('leaves the audio untouched for a rate they accept', () => {
    expect(splitSpeed(1)).toEqual({ speed: 1, playbackRate: 1 });

    const slow = splitSpeed(0.8);
    expect(slow.speed).toBeCloseTo(0.8);
    expect(slow.playbackRate).toBeCloseTo(1);
  });

  it('never asks them for a speed outside their range', () => {
    for (const rate of [0.5, 0.6, 0.7, 1, 1.2, 1.5, 2]) {
      const { speed } = splitSpeed(rate);
      expect(speed).toBeGreaterThanOrEqual(ELEVENLABS_MIN_SPEED);
      expect(speed).toBeLessThanOrEqual(ELEVENLABS_MAX_SPEED);
    }
  });

  it('makes up the difference with playbackRate, so the net rate is what was asked for', () => {
    for (const rate of [0.5, 0.6, 1.5, 2]) {
      const { speed, playbackRate } = splitSpeed(rate);
      expect(speed * playbackRate).toBeCloseTo(rate);
    }
  });

  it('falls back to 1 for a rate that is not a number', () => {
    expect(splitSpeed(Number.NaN)).toEqual({ speed: 1, playbackRate: 1 });
    expect(splitSpeed(undefined as unknown as number)).toEqual({ speed: 1, playbackRate: 1 });
  });
});

describe('fetchElevenLabsVoices', () => {
  it('asks with the key in their own header and sorts what comes back', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        voices: [
          { voice_id: 'v2', name: 'Zosia' },
          { voice_id: 'v1', name: 'Adam' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchElevenLabsVoices('el-key');

    expect(result.success).toBe(true);
    expect(result.voices.map((v) => v.name)).toEqual(['Adam', 'Zosia']);
    // Not a bearer token: ElevenLabs takes its key in `xi-api-key` and answers 401 otherwise.
    expect(fetchMock.mock.calls[0][1].headers['xi-api-key']).toBe('el-key');
  });

  it('says a key is required before spending a request finding out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchElevenLabsVoices('  ')).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a network failure apart from a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    expect((await fetchElevenLabsVoices('k')).error).toBe('Failed to fetch');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
    expect((await fetchElevenLabsVoices('k')).error).toBe('Invalid ElevenLabs API key');
  });
});
