import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BeatContext } from './quest';
import { GOOGLE_MODELS, generateBeat } from './storyteller';

const beat = {
  title: 'Ring',
  npc: { name: 'Marta', gender: 'female' },
  place: { name: 'Old Keep', direction: 'north', biome: 'ruins' },
  targetName: 'relic',
  objectiveText: 'Find the relics',
  greeting: 'Hunter.',
  situation: 'The ring is in the ruins, and so is my husband’s killer.',
  decisions: [
    { label: 'I hunt him down.', reply: 'Go.', consequence: 'The hunter went after the killer.' },
    { label: 'I ask the priest.', reply: 'He knows.', consequence: 'The hunter went to the temple.' },
  ],
};

const ctx: BeatContext = {
  lang: 'en',
  index: 1,
  seed: 'an old debt',
  job: { kind: 'collect', count: 2 },
  plan: [{ kind: 'slay', count: 1 }, { kind: 'talk', count: 0 }],
  title: 'Ring',
  history: [],
  chronicle: [],
  places: [],
  characters: [],
};

function answer(text: string) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}

function refusal(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('generateBeat', () => {
  it('asks nobody when there is no key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: null, openai: null }, ctx);
    expect(attempt.outcome).toBe('no-key');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('moves past a model the key cannot use, and one out of quota', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(refusal(404, 'models/x is not found'))
      .mockResolvedValueOnce(refusal(429, 'Resource has been exhausted'))
      .mockResolvedValueOnce(answer('```json\n' + JSON.stringify(beat) + '\n```'));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: 'k', openai: null }, ctx);
    expect(attempt.outcome).toBe('generated');
    expect(attempt.model).toBe(GOOGLE_MODELS[2]);
    expect(attempt.tries.map((t) => t.status)).toEqual([404, 429, 200]);
    expect(attempt.beat?.job).toMatchObject({ kind: 'collect', count: 2, targetName: 'relic' });
    expect(attempt.beat?.decisions.map((d) => d.next?.kind)).toEqual(['slay', 'talk']);
  });

  it('stops at a rejected key and says why', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refusal(400, 'API key not valid. Please pass a valid API key.')));
    const attempt = await generateBeat({ google: 'k', openai: null }, ctx);
    expect(attempt.outcome).toBe('failed');
    expect(attempt.tries).toHaveLength(1);
    expect(attempt.error).toContain('API key not valid');
  });

  it('asks the next model when an answer is not a playable beat', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer('Once upon a time…'))
      .mockResolvedValueOnce(answer(JSON.stringify(beat)));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: 'k', openai: null }, ctx);
    expect(attempt.outcome).toBe('generated');
    expect(attempt.raw).toContain('"Ring"');
  });
});
