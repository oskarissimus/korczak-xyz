import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Frame } from './types';
import {
  VisionError,
  askForRemark,
  fetchVisionModels,
  filterGoogleVisionModels,
  filterOpenAiVisionModels,
  googleGeneration,
} from './vision';

const frame: Frame = {
  dataUrl: 'data:image/jpeg;base64,AAEC',
  base64: 'AAEC',
  mimeType: 'image/jpeg',
  width: 512,
  height: 288,
};

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('askForRemark, OpenAI', () => {
  it('sends the frame as a data URL at low detail, with the key as a bearer token', async () => {
    const fetchMock = mockFetch({
      json: async () => ({ choices: [{ message: { content: 'Slow down!' } }] }),
    });

    const text = await askForRemark({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      system: 'be annoying',
      user: 'look',
      frame,
    });

    expect(text).toBe('Slow down!');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be annoying' });
    const image = body.messages[1].content[1];
    // `detail: 'low'` is a cost control, not a quality setting — see the note in vision.ts.
    expect(image.image_url).toEqual({ url: frame.dataUrl, detail: 'low' });
    // Not `max_tokens`: the o-series and gpt-5 families reject that field outright.
    expect(body.max_completion_tokens).toBeGreaterThan(0);
  });

  it('is an empty string, not a crash, when the answer has no content', async () => {
    mockFetch({ json: async () => ({ choices: [] }) });
    await expect(
      askForRemark({
        provider: 'openai',
        apiKey: 'sk',
        model: 'm',
        system: 's',
        user: 'u',
        frame,
      }),
    ).resolves.toBe('');
  });
});

describe('askForRemark, Google', () => {
  it('sends the base64 without its prefix, the key in the query, and the system apart', async () => {
    const fetchMock = mockFetch({
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Mind the bus.' }] } }] }),
    });

    const text = await askForRemark({
      provider: 'google',
      apiKey: 'AIza-test',
      model: 'gemini-2.5-flash',
      system: 'be annoying',
      user: 'look',
      frame,
    });

    expect(text).toBe('Mind the bus.');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(url).toContain('key=AIza-test');

    const body = JSON.parse(init.body as string);
    // Google takes the system prompt in its own field; in `contents` it becomes one more thing
    // the model may answer about.
    expect(body.systemInstruction.parts[0].text).toBe('be annoying');
    // The prefix left on is rejected with an error about the image rather than the encoding.
    expect(body.contents[0].parts[0].inline_data.data).toBe('AAEC');
    expect(body.contents[0].parts[0].inline_data.data).not.toContain('data:');
  });

  /*
   * Gemma on Google's API answers a `systemInstruction` with a 400 ("Developer instruction is not
   * enabled"), every round, so for Gemma the system prompt leads the user turn.
   */
  it('puts the system prompt in the user turn for Gemma', async () => {
    const fetchMock = mockFetch({
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Mind the bus.' }] } }] }),
    });

    await askForRemark({
      provider: 'google',
      apiKey: 'AIza-test',
      model: 'gemma-3-27b-it',
      system: 'be annoying',
      user: 'look',
      frame,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.systemInstruction).toBeUndefined();
    expect(body.contents[0].parts[1].text).toBe('be annoying\n\nlook');
    expect(body.contents[0].parts[0].inline_data.data).toBe('AAEC');
  });

  it('joins a multi-part answer rather than taking the first part', async () => {
    mockFetch({
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Mind ' }, { text: 'the bus.' }] } }] }),
    });
    await expect(
      askForRemark({ provider: 'google', apiKey: 'k', model: 'm', system: 's', user: 'u', frame }),
    ).resolves.toBe('Mind the bus.');
  });
});

/*
 * A rejected key will not start working on the next attempt, so the ride stops for it. A rate
 * limit or a blip in a tunnel is an ordinary event on a drive and costs one round.
 */
describe('VisionError', () => {
  it('quotes the provider and marks a rejected key as fatal', async () => {
    mockFetch({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Incorrect API key provided' } }),
    });

    const failure = await askForRemark({
      provider: 'openai',
      apiKey: 'sk-bad',
      model: 'm',
      system: 's',
      user: 'u',
      frame,
    }).catch((e) => e);

    expect(failure).toBeInstanceOf(VisionError);
    expect(failure.message).toBe('Incorrect API key provided');
    expect(failure.fatal).toBe(true);
  });

  it('does not treat a rate limit as fatal', async () => {
    mockFetch({ ok: false, status: 429, json: async () => ({}) });

    const failure = await askForRemark({
      provider: 'openai',
      apiKey: 'sk',
      model: 'm',
      system: 's',
      user: 'u',
      frame,
    }).catch((e) => e);

    expect(failure.status).toBe(429);
    expect(failure.fatal).toBe(false);
    expect(failure.message).toContain('Rate limited');
  });
});

/*
 * A chat model that cannot take an image fails at the first snapshot with an error about content
 * parts, which reads as a bug in this app rather than as the wrong model being selected.
 */
describe('the model lists', () => {
  it('keeps the OpenAI families that can see, and drops the ones that share a prefix', () => {
    const models = filterOpenAiVisionModels([
      'gpt-4o-mini',
      'gpt-4o-audio-preview',
      'gpt-4.1',
      'gpt-3.5-turbo',
      'text-embedding-3-small',
      'gpt-4o-realtime-preview',
      'dall-e-3',
      'o4-mini',
    ]);

    expect(models).toEqual(['gpt-4.1', 'gpt-4o-mini', 'o4-mini']);
  });

  it('keeps the Gemini models that answer generateContent', () => {
    const models = filterGoogleVisionModels([
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/text-bison-001', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
    ]);

    expect(models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('lists the default first, then Gemini, then the Gemma models that take an image', () => {
    const models = filterGoogleVisionModels(
      [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemma-3-1b-it',
        'gemma-3-4b-it',
        'gemma-3-27b-it',
        'gemma-3n-e4b-it',
        'gemma-3-12b-it',
      ].map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })),
    );

    expect(models).toEqual([
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemma-3-27b-it',
      'gemma-3-12b-it',
      'gemma-3-4b-it',
    ]);
  });

  it('says a key is required before spending a request finding out', async () => {
    const fetchMock = mockFetch({});
    const result = await fetchVisionModels('openai', '   ');
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /*
   * A network failure and a rejected key are kept apart on purpose. Reporting "invalid key" for a
   * phone that lost signal is how somebody comes to re-paste a key that was fine.
   */
  it('keeps a network failure apart from a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    const network = await fetchVisionModels('openai', 'sk');
    expect(network).toEqual({ success: false, models: [], error: 'Failed to fetch' });

    mockFetch({ ok: false, status: 401, json: async () => ({}) });
    const rejected = await fetchVisionModels('openai', 'sk-bad');
    expect(rejected.error).toBe('Invalid OpenAI API key');
  });

  /* Google answers a bad key with 400 as readily as 401. */
  it('reads Google’s 400 as a bad key', async () => {
    mockFetch({ ok: false, status: 400, json: async () => ({}) });
    const result = await fetchVisionModels('google', 'AIza-bad');
    expect(result.error).toBe('Invalid Google API key');
  });
});

/*
 * Thinking counts against the output cap: gemini-pro-latest spent the 120 tokens thinking and the
 * ride spoke "Boże," and nothing more.
 */
describe('googleGeneration', () => {
  it('turns thinking off on Flash and keeps the tight cap', () => {
    expect(googleGeneration('gemini-2.5-flash-lite')).toMatchObject({
      maxOutputTokens: 120,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it('gives a model that cannot stop thinking room to finish the sentence', () => {
    expect(googleGeneration('gemini-pro-latest')).toMatchObject({
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect(googleGeneration('gemini-2.5-pro').maxOutputTokens).toBe(2048);
    expect(googleGeneration('gemma-3-27b-it')).not.toHaveProperty('thinkingConfig');
  });
});
