import { afterEach, describe, expect, it, vi } from 'vitest';

import { GOOGLE_MODELS, generateQuest } from './storyteller';

const quest = {
  title: 'Ring',
  npcName: 'Marta',
  greeting: 'Hunter.',
  pitch: 'The ring is in the ruins.',
  objectiveText: 'Find the relics',
  place: { name: 'Old Keep', direction: 'north', biome: 'ruins' },
  kind: 'collect',
  targetName: 'relic',
  count: 2,
};

function answer(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}

function refusal(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('generateQuest', () => {
  it('plays the hand-written quest without asking anybody when there is no key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateQuest({ google: null, openai: null }, 'en');
    expect(attempt.outcome).toBe('no-key');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('moves past a model the key cannot use, and one out of quota', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(refusal(404, 'models/x is not found'))
      .mockResolvedValueOnce(refusal(429, 'Resource has been exhausted'))
      .mockResolvedValueOnce(answer('```json\n' + JSON.stringify(quest) + '\n```'));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateQuest({ google: 'k', openai: null }, 'en');
    expect(attempt.outcome).toBe('generated');
    expect(attempt.model).toBe(GOOGLE_MODELS[2]);
    expect(attempt.tries.map((t) => t.status)).toEqual([404, 429, 200]);
  });

  it('stops at a rejected key and says why', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refusal(400, 'API key not valid. Please pass a valid API key.')));
    const attempt = await generateQuest({ google: 'k', openai: null }, 'pl');
    expect(attempt.outcome).toBe('failed');
    expect(attempt.tries).toHaveLength(1);
    expect(attempt.error).toContain('API key not valid');
  });

  it('asks the next model when an answer is not a playable quest', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer('Once upon a time…'))
      .mockResolvedValueOnce(answer(JSON.stringify(quest)));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateQuest({ google: 'k', openai: null }, 'en');
    expect(attempt.outcome).toBe('generated');
    expect(attempt.raw).toContain('"Ring"');
  });
});
