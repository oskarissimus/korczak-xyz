import { describe, expect, it } from 'vitest';

import { filterLiveModels, messageKinds, pcmRate, pcmToFloat, wantsThinkingOff } from './live';
import { canStart, DEFAULT_CONFIG, normalizeConfig, requiredKeys } from './defaults';

describe('filterLiveModels', () => {
  it('keeps the Live models a passenger can be, flash-live first', () => {
    const bidi = ['bidiGenerateContent'];
    expect(
      filterLiveModels([
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-native-audio-preview-09-2025', supportedGenerationMethods: bidi },
        { name: 'models/gemini-2.5-flash-native-audio-preview-12-2025', supportedGenerationMethods: bidi },
        { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: bidi },
        { name: 'models/gemini-3.8-live', supportedGenerationMethods: bidi },
        { name: 'models/gemini-3.8-live-extended-thinking', supportedGenerationMethods: bidi },
        { name: 'models/gemini-3.5-transcribe-live', supportedGenerationMethods: bidi },
        { name: 'models/gemini-3.5-live-translate-preview', supportedGenerationMethods: bidi },
        { name: 'models/gemini-robotics-er-2-streaming-preview', supportedGenerationMethods: bidi },
      ]),
    ).toEqual([
      'gemini-3.1-flash-live-preview',
      'gemini-3.8-live',
      'gemini-2.5-flash-native-audio-preview-12-2025',
      'gemini-2.5-flash-native-audio-preview-09-2025',
    ]);
  });

  it('asks only a flash-live model not to think', () => {
    expect(wantsThinkingOff('gemini-3.1-flash-live-preview')).toBe(true);
    expect(wantsThinkingOff('gemini-2.5-flash-native-audio-preview-09-2025')).toBe(false);
  });
});

describe('PCM', () => {
  it('reads little-endian 16-bit samples', () => {
    // 0x0000, 0x7fff, 0x8000 (-32768), 0xffff (-1)
    const bytes = String.fromCharCode(0, 0, 0xff, 0x7f, 0, 0x80, 0xff, 0xff);
    const samples = pcmToFloat(btoa(bytes));
    expect(samples.length).toBe(4);
    expect(samples[0]).toBe(0);
    expect(samples[1]).toBeCloseTo(1, 3);
    expect(samples[2]).toBe(-1);
    expect(samples[3]).toBeCloseTo(-1 / 32768, 6);
  });

  it('takes the rate from the mime type, 24 kHz when it says nothing', () => {
    expect(pcmRate('audio/pcm;rate=16000')).toBe(16000);
    expect(pcmRate('audio/pcm')).toBe(24000);
  });
});

describe('the Live engine in the settings', () => {
  it('needs only the Google key and a Live model, whatever the vision provider', () => {
    const config = normalizeConfig({
      vision: { provider: 'openai', model: '' },
      voice: { engine: 'live' },
    });
    expect(config.voice.engine).toBe('live');
    expect(requiredKeys(config)).toEqual(['google']);
    expect(canStart({ ...config, apiKeys: { ...config.apiKeys, google: 'AIza' } })).toBe(true);
    expect(config.voice.liveVoice).toBe(DEFAULT_CONFIG.voice.liveVoice);
    // The first day's default never spoke with this prompt; a config saved on it moves off once.
    expect(
      normalizeConfig({ voice: { liveModel: 'gemini-2.5-flash-native-audio-preview-09-2025' } })
        .voice.liveModel,
    ).toBe('gemini-3.1-flash-live-preview');
  });
});

describe('messageKinds', () => {
  it('names what a server message carried, for the saved timeline', () => {
    expect(
      messageKinds({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AA==' } }] },
          outputTranscription: { text: 'Hej' },
        },
      }),
    ).toEqual(['audio', 'text']);
    expect(
      messageKinds({ serverContent: { turnComplete: true }, usageMetadata: { totalTokenCount: 3 } }),
    ).toEqual(['turnComplete', 'usage']);
    expect(messageKinds({ goAway: { timeLeft: '1s' } })).toEqual(['goAway']);
    expect(messageKinds({ serverContent: { somethingNew: 1 } })).toEqual([
      'serverContent:somethingNew',
    ]);
  });
});
