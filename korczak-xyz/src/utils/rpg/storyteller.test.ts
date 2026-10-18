import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BeatContext } from './quest';
import { devRequests, questTotals, resetDevlog } from './devlog';
import { GOOGLE_MODELS, generateBeat, modelChain } from './storyteller';

const beat = {
  title: 'Ring',
  npc: { name: 'Marta', gender: 'female' },
  place: { name: 'Old Keep', direction: 'north', biome: 'ruins' },
  targetName: 'relic',
  objectiveText: 'Find the relics',
  greeting: 'Hunter.',
  story: [{ ask: 'Tell me.', say: 'The ring is in the ruins, and so is my husband’s killer.' }],
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

/** A streamed answer, the way `streamGenerateContent?alt=sse` sends it: thoughts, then the text in pieces. */
function answer(text: string, modelVersion = 'gemini-3.1-pro-preview') {
  const half = Math.floor(text.length / 2);
  const events = [
    { candidates: [{ content: { parts: [{ text: 'Thinking about the ring', thought: true }] } }], modelVersion },
    { candidates: [{ content: { parts: [{ text: text.slice(0, half) }] } }], modelVersion },
    {
      candidates: [{ content: { parts: [{ text: text.slice(half) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 1000, thoughtsTokenCount: 500 },
      modelVersion,
    },
  ];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''), { status: 200 });
}

function refusal(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetDevlog();
});

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
      .mockResolvedValueOnce(refusal(404, 'models/y is not found'))
      .mockResolvedValueOnce(answer('```json\n' + JSON.stringify(beat) + '\n```'));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: 'k', openai: null }, ctx);
    expect(attempt.outcome).toBe('generated');
    expect(attempt.model).toBe(GOOGLE_MODELS[3]);
    expect(String(fetch.mock.calls[0][0])).toContain(`${GOOGLE_MODELS[0]}:streamGenerateContent?alt=sse`);
    expect(attempt.tries.map((t) => t.status)).toEqual([404, 429, 404, 200]);
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

  it('streams into the console with tokens and cost, priced by the model that answered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(answer(JSON.stringify(beat))));
    const attempt = await generateBeat({ google: 'k', openai: null }, ctx);
    expect(attempt.outcome).toBe('generated');
    const [entry] = devRequests();
    expect(entry).toMatchObject({ kind: 'model', status: 'ok', servedBy: 'gemini-3.1-pro-preview', beat: 1 });
    expect(entry.thoughts).toContain('Thinking about the ring');
    expect(entry.text).toBe(JSON.stringify(beat));
    // 5000 in at $2/M, 1500 out (thinking included) at $12/M.
    expect(entry.cost).toBeCloseTo(0.01 + 0.018, 6);
    expect(attempt.tries[0].usage).toEqual({ input: 5000, output: 1000, thoughts: 500 });
    expect(questTotals().modelCost).toBeCloseTo(0.028, 6);
  });

  it('gives up on a model that goes quiet and asks the next', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) =>
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          ),
      )
      .mockResolvedValueOnce(answer(JSON.stringify(beat), 'gemini-3-flash-preview'));
    vi.stubGlobal('fetch', fetch);
    const pending = generateBeat({ google: 'k', openai: null }, ctx);
    await vi.advanceTimersByTimeAsync(61_000);
    const attempt = await pending;
    expect(attempt.outcome).toBe('generated');
    expect(attempt.tries[0]).toMatchObject({ model: GOOGLE_MODELS[0], status: null });
    expect(attempt.tries[0].error).toContain('no answer for 60s');
    expect(attempt.model).toBe(GOOGLE_MODELS[1]);
  });

  it('reads an answer that came back whole rather than streamed', async () => {
    const whole = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(beat) }] } }] }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(whole));
    const attempt = await generateBeat({ google: 'k', openai: null }, ctx);
    expect(attempt.outcome).toBe('generated');
  });

  it('asks the chosen model first, then the usual order', () => {
    expect(modelChain('google', 'gemini-3.8-flash')).toEqual(['gemini-3.8-flash', ...GOOGLE_MODELS]);
    expect(modelChain('google', GOOGLE_MODELS[2])[0]).toBe(GOOGLE_MODELS[2]);
    expect(modelChain('google', GOOGLE_MODELS[2])).toHaveLength(GOOGLE_MODELS.length);
    expect(modelChain('google', 'gpt-4.1')).toEqual(GOOGLE_MODELS);
    expect(modelChain('google', null)).toEqual(GOOGLE_MODELS);
  });
});

describe('the demo', () => {
  it('sends the context, never a prompt, and reads the stream it passes back', async () => {
    vi.stubEnv('PUBLIC_RPG_DEMO_URL', 'https://demo.test/rpgDemo');
    const fetch = vi.fn().mockResolvedValueOnce(answer(JSON.stringify(beat)));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: null, openai: null, demo: true }, ctx);
    expect(attempt.outcome).toBe('generated');
    expect(attempt.provider).toBe('demo');
    expect(fetch.mock.calls[0][0]).toBe('https://demo.test/rpgDemo');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ kind: 'beat', model: GOOGLE_MODELS[0], ctx: { seed: 'an old debt', index: 1 } });
    expect(body.prompt).toBeUndefined();
  });

  it('moves to a cheaper model when a cap is reached, and says so when none fits', async () => {
    vi.stubEnv('PUBLIC_RPG_DEMO_URL', 'https://demo.test/rpgDemo');
    const capped = () => new Response(JSON.stringify({ reason: 'ip-cap', error: { message: 'demo: ip-cap' } }), { status: 402 });
    const fetch = vi.fn().mockImplementation(async () => capped());
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: null, openai: null, demo: true }, ctx);
    expect(attempt.outcome).toBe('failed');
    expect(attempt.refusal).toBe('ip-cap');
    expect(fetch).toHaveBeenCalledTimes(modelChain('demo', null).length);
  });

  it('stops at once when the demo is switched off', async () => {
    vi.stubEnv('PUBLIC_RPG_DEMO_URL', 'https://demo.test/rpgDemo');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reason: 'disabled' }), { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: null, openai: null, demo: true }, ctx);
    expect(attempt.refusal).toBe('disabled');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still moves on past Google's own 503, passed through", async () => {
    vi.stubEnv('PUBLIC_RPG_DEMO_URL', 'https://demo.test/rpgDemo');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(refusal(503, 'The model is overloaded'))
      .mockResolvedValueOnce(answer(JSON.stringify(beat)));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: null, openai: null, demo: true }, ctx);
    expect(attempt.outcome).toBe('generated');
    expect(attempt.refusal).toBeNull();
  });

  it('a key of the reader\'s own wins over the demo', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer(JSON.stringify(beat)));
    vi.stubGlobal('fetch', fetch);
    const attempt = await generateBeat({ google: 'k', openai: null, demo: true }, ctx);
    expect(attempt.provider).toBe('google');
    expect(String(fetch.mock.calls[0][0])).toContain('generativelanguage.googleapis.com');
  });
});
