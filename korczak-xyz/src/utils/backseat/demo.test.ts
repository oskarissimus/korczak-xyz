/*
 * The demo's browser half, which is the only call in this app that leaves for a server of ours.
 *
 * What is pinned here is what the function depends on and what the ride loop depends on: that the
 * request carries a persona and a frame and NOT a prompt, a model or a key; that a refusal is
 * fatal, because a cap is a cap for the rest of the day and the loop's three-strikes rule would
 * otherwise spend two more rounds discovering it; and that asking whether the demo is open never
 * throws, because a function that is down and a demo that is switched off mean the same thing to
 * the setup sheet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoError, askDemo, demoUrl, fetchDemoStatus } from './demo';
import type { Frame } from './types';

const frame: Frame = {
  dataUrl: 'data:image/jpeg;base64,AAAA',
  base64: 'AAAA',
  mimeType: 'image/jpeg',
  width: 512,
  height: 288,
};

const ask = {
  app: 'roaster' as const,
  persona: 'comedian' as const,
  intensity: 'normal' as const,
  lang: 'en' as const,
  recent: ['that shirt again'],
  frame,
};

function reply(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

/* The function's address comes from the build (`demoUrl`), and a test must not depend on which
   .env file happened to be loaded. */
beforeEach(() => {
  vi.stubEnv('PUBLIC_BACKSEAT_DEMO_URL', 'https://demo.test/roastDemo');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('demoUrl', () => {
  it('derives the function from the project when nothing overrides it', () => {
    vi.stubEnv('PUBLIC_BACKSEAT_DEMO_URL', '');
    vi.stubEnv('PUBLIC_FIREBASE_PROJECT_ID', 'korczak-xyz-501720');
    expect(demoUrl()).toBe(
      'https://europe-central2-korczak-xyz-501720.cloudfunctions.net/roastDemo',
    );
  });

  /* A fork or a local checkout with no project configured has no demo, which is an answer rather
     than an exception on the setup sheet. */
  it('is null with no project and no override', () => {
    vi.stubEnv('PUBLIC_BACKSEAT_DEMO_URL', '');
    vi.stubEnv('PUBLIC_FIREBASE_PROJECT_ID', '');
    expect(demoUrl()).toBeNull();
  });
});

describe('askDemo', () => {
  it('sends the frame and the closed-list settings, and no prompt, model or key', async () => {
    const fetchMock = reply({ text: 'Nice lamp.', angle: 'a hotel review', remaining: { ip: 9, app: 300 } });
    vi.stubGlobal('fetch', fetchMock);

    const answer = await askDemo(ask);

    expect(answer.text).toBe('Nice lamp.');
    expect(answer.angle).toBe('a hotel review');
    expect(answer.remaining.ip).toBe(9);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      app: 'roaster',
      persona: 'comedian',
      intensity: 'normal',
      lang: 'en',
      recent: ['that shirt again'],
      image: 'AAAA',
      mimeType: 'image/jpeg',
    });
    // The prompt is the function's to build; a request that could name one would be a free,
    // unauthenticated Gemini proxy with somebody else's name on the bill.
    expect(Object.keys(body)).not.toContain('system');
    expect(Object.keys(body)).not.toContain('model');
    expect(Object.keys(body)).not.toContain('apiKey');
  });

  it('turns every refusal into a fatal error with its own sentence', async () => {
    for (const [status, reason] of [
      [429, 'ip-cap'],
      [429, 'app-cap'],
      [503, 'disabled'],
      [503, 'no-key'],
      [503, 'app-off'],
      [502, 'provider'],
    ] as const) {
      vi.stubGlobal('fetch', reply({ reason }, status));
      const error = await askDemo(ask).catch((e) => e);
      expect(error).toBeInstanceOf(DemoError);
      expect((error as DemoError).reason).toBe(reason);
      // Unlike a provider's own 429, this will not come right on the next round.
      expect((error as DemoError).fatal).toBe(true);
      expect((error as DemoError).message).not.toBe('');
    }
  });

  it('has a sentence for a reason it has never heard of', async () => {
    vi.stubGlobal('fetch', reply({ reason: 'something-new' }, 500));
    const error = await askDemo(ask).catch((e) => e);
    expect((error as DemoError).message).not.toBe('');
  });
});

describe('fetchDemoStatus', () => {
  it('reads what is left and the floor under the interval', async () => {
    vi.stubGlobal(
      'fetch',
      reply({
        available: true,
        reason: null,
        remaining: { ip: 15, app: 400 },
        perIpDaily: 15,
        perAppDaily: 400,
        minIntervalSeconds: 12,
        model: 'gemini-2.5-flash-lite',
      }),
    );

    const status = await fetchDemoStatus('backseat');
    expect(status?.available).toBe(true);
    expect(status?.remaining).toEqual({ ip: 15, app: 400 });
    expect(status?.minIntervalSeconds).toBe(12);
    expect(status?.model).toBe('gemini-2.5-flash-lite');
  });

  it('never throws: a dead function, a refusal and a network failure are all "no demo"', async () => {
    vi.stubGlobal('fetch', reply({}, 500));
    expect(await fetchDemoStatus('roaster')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchDemoStatus('roaster')).toBeNull();

    // A body that is not the shape we asked for degrades to a closed demo rather than to
    // `undefined` somewhere the sheet reads as a number.
    vi.stubGlobal('fetch', reply('not an object'));
    expect(await fetchDemoStatus('roaster')).toBeNull();
  });
});
