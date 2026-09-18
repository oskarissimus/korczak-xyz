import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchElevenLabsVoices, pickVoice, speechTimeoutMs, type DeviceVoice } from './speech';

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
