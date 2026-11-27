import { describe, expect, it } from 'vitest';

import { tokenCost } from './cost';
import { questLitres } from './diesel';
import {
  GEMINI_TTS_MODEL,
  GEMINI_VOICES,
  clipBlob,
  geminiClipOf,
  geminiSpeechRequest,
  geminiVoiceFor,
  mannerTag,
  pcmToWav,
  voiceEngineOf,
} from './geminiVoice';

describe('voiceEngineOf', () => {
  it('is Gemini unless ElevenLabs was chosen', () => {
    expect(voiceEngineOf(null)).toBe('gemini');
    expect(voiceEngineOf('nonsense')).toBe('gemini');
    expect(voiceEngineOf('elevenlabs')).toBe('elevenlabs');
  });
});

describe('geminiVoiceFor', () => {
  it('gives the hero and a nameless line the fixed voices', () => {
    expect(geminiVoiceFor('player', { name: 'X', gender: 'female' } as never)).toBe(GEMINI_VOICES.player);
    expect(geminiVoiceFor('female')).toBe(GEMINI_VOICES.female);
  });

  it('keeps a character in one voice, by gender and age', () => {
    const who = { name: 'Weronika', gender: 'female', age: 'old' } as never;
    expect(geminiVoiceFor('female', who)).toBe(geminiVoiceFor('female', who));
    expect(['Gacrux', 'Sulafat']).toContain(geminiVoiceFor('female', who));
    expect(['Puck', 'Fenrir', 'Sadachbia', 'Achird']).toContain(
      geminiVoiceFor('male', {
        name: 'Tiago',
        gender: 'male',
        age: 'young',
      } as never),
    );
  });
});

describe('mannerTag', () => {
  it('turns the Emotion of a voice description into a tag', () => {
    expect(mannerTag('Native Polish. Female, 40s. Emotion: Anxious, hurried. Pace: fast.')).toBe('[anxious, hurried] ');
    expect(mannerTag('Emotion: one two three four five six seven')).toBe('[one two three four five six] ');
    expect(mannerTag('Female, 40s.')).toBe('');
    expect(mannerTag(undefined)).toBe('');
  });
});

describe('geminiSpeechRequest', () => {
  it('asks generateContent for audio in the named voice', () => {
    const [url, init] = geminiSpeechRequest('k', 'Kore', 'Dzień dobry.');
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`);
    expect(init.headers['x-goog-api-key']).toBe('k');
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect(body.contents[0].parts[0].text).toBe('Dzień dobry.');
  });
});

describe('geminiClipOf', () => {
  it('reads the PCM, its rate and the usage', () => {
    const clip = geminiClipOf({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/L16;codec=pcm;rate=24000',
                  data: btoa('abcd'),
                },
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 55, candidatesTokenCount: 250 },
    });
    expect(clip.rate).toBe(24_000);
    expect([...clip.pcm]).toEqual([97, 98, 99, 100]);
    expect(clip.usage).toEqual({ input: 55, output: 250, thoughts: 0 });
  });

  it('says why there is no audio', () => {
    expect(() => geminiClipOf({ candidates: [{ finishReason: 'OTHER' }] })).toThrow(/OTHER/);
  });
});

describe('pcmToWav', () => {
  it('puts a 44-byte mono 16-bit header in front', async () => {
    const wav = pcmToWav(new Uint8Array(8), 24_000);
    const bytes = new Uint8Array(await wav.arrayBuffer());
    const v = new DataView(bytes.buffer);
    expect(bytes.length).toBe(52);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(24_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
  });
});

describe('price', () => {
  it('prices a line by its tokens, doubling on 1 Jan 2027', () => {
    const line = { input: 55, output: 250, thoughts: 0 };
    expect(tokenCost(GEMINI_TTS_MODEL, line, Date.parse('2026-11-27'))).toBeCloseTo(0.0022775, 7);
    expect(tokenCost(GEMINI_TTS_MODEL, line, Date.parse('2027-01-02'))).toBeCloseTo(0.004555, 7);
  });

  it('makes a quest with Gemini speaking cheaper than with ElevenLabs', () => {
    const parts = { voice: true, music: false, fal: false };
    const eleven = questLitres('gemini-3.8-flash', parts)!;
    const gemini = questLitres('gemini-3.8-flash', {
      ...parts,
      voiceEngine: 'gemini',
    })!;
    expect(gemini).toBeLessThan(eleven);
  });
});

describe('clipBlob', () => {
  it('wraps raw PCM and passes a WAV through as it came', async () => {
    const raw = await clipBlob({ pcm: new Uint8Array(20), rate: 24_000, usage: { input: 0, output: 0, thoughts: 0 } }).arrayBuffer();
    expect(raw.byteLength).toBe(64);
    const wav = new Uint8Array(await pcmToWav(new Uint8Array(20), 24_000).arrayBuffer());
    const again = await clipBlob({ pcm: wav, rate: 24_000, usage: { input: 0, output: 0, thoughts: 0 } }).arrayBuffer();
    expect(again.byteLength).toBe(64);
  });
});
