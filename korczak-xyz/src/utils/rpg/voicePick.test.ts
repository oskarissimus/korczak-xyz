import { describe, expect, it } from 'vitest';

import { asAge, findVoice, pickVoice, sharedVoicesUrl, type SharedVoice } from './voicePick';

const model = 'eleven_flash_v2_5';
const pl = (id: string, extra: Partial<SharedVoice> = {}): SharedVoice => ({
  voice_id: id,
  rate: 1,
  fiat_rate: null,
  verified_languages: [{ language: 'pl', model_id: model }],
  ...extra,
});

describe('voicePick', () => {
  it('reads the ages a model writes', () => {
    expect(asAge('middle-aged')).toBe('middle_aged');
    expect(asAge('Old')).toBe('old');
    expect(asAge('elderly')).toBe('old');
    expect(asAge('ancient')).toBeUndefined();
  });

  it('gives a name the same voice every time, at the ordinary rate only', () => {
    const list = [pl('aaaaaaaaaa'), pl('bbbbbbbbbb'), pl('cccccccccc', { rate: 2 }), pl('dddddddddd', { fiat_rate: 0.1 })];
    const who = { name: 'Radomir', gender: 'male' as const };
    const first = pickVoice(list, who, 'pl', model);
    expect(['aaaaaaaaaa', 'bbbbbbbbbb']).toContain(first);
    expect(pickVoice(list, who, 'pl', model)).toBe(first);
    expect(pickVoice([pl('eeeeeeeeee', { verified_languages: [{ language: 'en', model_id: model }] })], who, 'pl', model)).toBeNull();
  });

  it('falls back from gender and age to gender alone', async () => {
    const asked: string[] = [];
    const voice = await findVoice({ name: 'Jagna', gender: 'female', age: 'old' }, 'pl', model, async (url) => {
      asked.push(url);
      return url.includes('&age=') ? [] : [pl('ffffffffff')];
    });
    expect(voice).toBe('ffffffffff');
    expect(asked).toEqual([sharedVoicesUrl('pl', 'female', 'old'), sharedVoicesUrl('pl', 'female')]);
  });
});
