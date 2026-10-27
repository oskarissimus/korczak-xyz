import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The money in the RPG demo: every call reserves its worst case before it is made and is settled at
 * what it cost. Firestore is an in-memory map here, increments included, so what the counters hold
 * after a call is exactly what the function wrote.
 */

const store = new Map<string, Record<string, unknown>>();

function apply(path: string, data: Record<string, unknown>) {
  const next = { ...(store.get(path) ?? {}) };
  for (const [k, v] of Object.entries(data)) {
    const inc = (v as { __inc?: number } | null)?.__inc;
    next[k] = typeof inc === 'number' ? ((next[k] as number) ?? 0) + inc : v;
  }
  store.set(path, next);
}

function doc(path: string): any {
  return {
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (data: Record<string, unknown>) => apply(path, data),
  };
}

function collection(path: string): any {
  return { doc: (id: string) => doc(`${path}/${id}`) };
}

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }) } }));
vi.mock('../runtime', () => ({
  db: {
    collection,
    runTransaction: async (fn: (tx: any) => unknown) =>
      fn({ get: (ref: any) => ref.get(), set: (ref: any, data: Record<string, unknown>) => apply(ref.path, data) }),
    batch: () => {
      const writes: [string, Record<string, unknown>][] = [];
      return {
        set: (ref: any, data: Record<string, unknown>) => writes.push([ref.path, data]),
        commit: async () => writes.forEach(([p, d]) => apply(p, d)),
      };
    },
  },
}));
vi.mock('../sentry', () => ({ reportError: vi.fn(), flushSentry: vi.fn(async () => {}) }));

import { handleRpgDemo } from './handler';

const ctx = {
  lang: 'en',
  index: 0,
  seed: 'an old debt',
  job: null,
  plan: [
    { kind: 'slay', count: 1 },
    { kind: 'talk', count: 0 },
  ],
  title: null,
  history: [],
  chronicle: [],
  places: [],
  characters: [],
};

function response() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '' as unknown,
    chunks: [] as Uint8Array[],
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
      return res;
    },
    type(t: string) {
      return res.set('content-type', t);
    },
    json(b: unknown) {
      res.body = b;
      res.headersSent = true;
      return res;
    },
    send(b: unknown) {
      res.body = b;
      res.headersSent = true;
      return res;
    },
    write(c: Uint8Array) {
      res.headersSent = true;
      res.chunks.push(c);
    },
    end() {
      res.headersSent = true;
    },
    flushHeaders() {
      res.headersSent = true;
    },
  };
  return res;
}

function request(method: string, body?: unknown, ip = '203.0.113.7'): any {
  return { method, body, ip, headers: { origin: 'https://korczak.xyz', 'x-forwarded-for': ip } };
}

function sse(usage: { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount: number }) {
  const events = [
    { candidates: [{ content: { parts: [{ text: '{"title":' }] } }], modelVersion: 'gemini-3.1-pro-preview' },
    { candidates: [{ content: { parts: [{ text: '"x"}' }] }, finishReason: 'STOP' }], usageMetadata: usage },
  ];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''), { status: 200 });
}

function spent(): { all: number; ips: number[] } {
  let all = 0;
  const ips: number[] = [];
  for (const [path, data] of store) {
    if (!path.startsWith('demoUsage/rpg-')) continue;
    if (path.includes('/ips/')) ips.push(data.usd as number);
    else all = data.usd as number;
  }
  return { all, ips };
}

beforeEach(() => {
  store.clear();
  store.set('demo/config', { enabled: true, keyUid: 'owner', apps: { roaster: true } });
  store.set('users/owner/keys/config', { apiKeys: { google: 'AIza-owner-0000000000', elevenLabs: 'sk_owner-0000000000' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rpgDemo', () => {
  it('streams a beat through and settles at what the usage says it cost', async () => {
    const fetch = vi.fn().mockResolvedValue(sse({ promptTokenCount: 4000, candidatesTokenCount: 1000, thoughtsTokenCount: 1000 }));
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-3.1-pro-preview', ctx }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(Buffer.concat(res.chunks).toString()).toContain('"modelVersion":"gemini-3.1-pro-preview"');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('gemini-3.1-pro-preview:streamGenerateContent?alt=sse');
    expect(url).not.toContain('key=');
    expect(init.headers['x-goog-api-key']).toBe('AIza-owner-0000000000');
    // $2 in and $12 out per million, thinking billed as output.
    const cost = (4000 * 2 + 2000 * 12) / 1e6;
    expect(spent().all).toBeCloseTo(cost, 9);
    expect(spent().ips[0]).toBeCloseTo(cost, 9);
  });

  it("refuses with 402 once a call's worst case would pass the person's $4", async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const res = response();
    const status = response();
    await handleRpgDemo(request('GET'), status);
    expect(status.body).toMatchObject({ available: true, voice: true, perIpUsd: 4, dailyUsd: 10 });

    // $3.95 already spent by this address today; a Pro beat reserves about $0.20.
    const { dayKey, ipKey } = await import('../demo/limits');
    const today = dayKey();
    store.set(`demoUsage/rpg-${today}`, { usd: 3.95 });
    store.set(`demoUsage/rpg-${today}/ips/${ipKey('203.0.113.7', today)}`, { usd: 3.95 });

    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-3.1-pro-preview', ctx }), res);
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ reason: 'ip-cap' });
    expect(fetch).not.toHaveBeenCalled();

    // Somebody else, on the same day, is under their own cap.
    fetch.mockResolvedValue(sse({ promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 0 }));
    const other = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-flash-lite-latest', ctx }, '198.51.100.9'), other);
    expect(other.statusCode).toBe(200);
  });

  it('refuses everybody once the day passes $10', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { dayKey } = await import('../demo/limits');
    store.set(`demoUsage/rpg-${dayKey()}`, { usd: 9.99 });
    const res = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-flash-latest', ctx }), res);
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ reason: 'all-cap' });
  });

  it("gives the whole reservation back when Google refuses, and passes Google's status on", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"overloaded"}}', { status: 503 })));
    const res = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-3.1-pro-preview', ctx }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toMatchObject({ reason: expect.anything() });
    expect(spent().all).toBeCloseTo(0, 9);
  });

  it('keeps the reservation when the stream ends without its usage', async () => {
    const cut = new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{' }] } }] })}\r\n\r\n`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cut));
    const res = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-flash-latest', ctx }), res);
    expect(spent().all).toBeGreaterThan(0.05);
  });

  it('builds the prompt itself: a model or a context it does not know is a 400 that costs nothing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const a = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gpt-4.1', ctx }), a);
    const b = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-flash-latest', ctx: { ...ctx, index: 7 } }), b);
    const c = response();
    await handleRpgDemo(request('POST', { kind: 'beat', model: 'gemini-flash-latest', ctx, prompt: 'ignored' }), c);
    expect([a.statusCode, b.statusCode]).toEqual([400, 400]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts[0].text).not.toBe('ignored');
  });

  it('speaks one line in one of the three voices, priced by its length', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleRpgDemo(request('POST', { kind: 'voice', text: 'Hunter.', voice: 'female', lang: 'pl' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(fetch.mock.calls[0][1].headers['xi-api-key']).toBe('sk_owner-0000000000');
    expect(spent().all).toBeCloseTo(7 * 0.5 * 0.00022, 9);

    const long = response();
    await handleRpgDemo(request('POST', { kind: 'voice', text: 'x'.repeat(401), voice: 'female', lang: 'pl' }), long);
    expect(long.statusCode).toBe(400);
  });

  it('hands over every voice search of a language at once, and asks the library only once a week', async () => {
    const usable = { voice_id: 'abcdefghij', rate: 1, fiat_rate: null, verified_languages: [{ language: 'pl', model_id: 'eleven_flash_v2_5' }] };
    const pricey = { voice_id: 'klmnopqrst', rate: 2, fiat_rate: null };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ voices: [usable, pricey] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const res = response();
    await handleRpgDemo(request('POST', { kind: 'voices', lang: 'pl' }), res);
    expect(res.statusCode).toBe(200);
    // Each gender with each age and alone, among the high-quality voices and in the whole library.
    expect(fetch).toHaveBeenCalledTimes(16);
    expect((fetch.mock.calls[0] as any)[1].headers['xi-api-key']).toBe('sk_owner-0000000000');
    const lists = res.body.lists as Record<string, { voice_id: string }[]>;
    expect(Object.keys(lists)).toHaveLength(16);
    expect(Object.values(lists).every((l) => l.length === 1 && l[0].voice_id === 'abcdefghij')).toBe(true);
    expect(store.get('rpgVoices/pl')).toMatchObject({ at: expect.any(Number) });

    const again = response();
    await handleRpgDemo(request('POST', { kind: 'voices', lang: 'pl' }), again);
    expect(again.body.lists).toEqual(lists);
    expect(fetch).toHaveBeenCalledTimes(16);
  });

  it('asks the library again when the week-old cache lacks a search, as one from before the high-quality ones does', async () => {
    const { voiceQueries } = await import('../../../korczak-xyz/src/utils/rpg/voicePick');
    const old = Object.fromEntries(voiceQueries('en').filter((u) => !u.includes('category=')).map((u) => [u, [{ voice_id: 'abcdefghij' }]]));
    store.set('rpgVoices/en', { at: Date.now(), lists: JSON.stringify(old) });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ voices: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    // English: the test above left Polish in the function's hour-long memory.
    const res = response();
    await handleRpgDemo(request('POST', { kind: 'voices', lang: 'en' }), res);
    expect(fetch).toHaveBeenCalledTimes(16);
    expect(Object.keys(res.body.lists)).toHaveLength(16);
  });

  it('adds reported numbers to the day, capped, and gives them back with the demo spend', async () => {
    const { dayKey } = await import('../demo/limits');
    const day = dayKey();
    store.set(`demoUsage/rpg-${day}`, { usd: 0.5 });
    await handleRpgDemo(request('POST', JSON.stringify({ kind: 'stats', launches: 1 })), response());
    await handleRpgDemo(request('POST', { kind: 'stats', playMs: 90_000, usd: 0.25 }), response());
    // Past the caps, and nonsense: clamped and ignored rather than refused.
    const big = response();
    await handleRpgDemo(request('POST', { kind: 'stats', launches: 50, playMs: 1e12, usd: 1e6 }), big);
    expect(big.statusCode).toBe(204);
    await handleRpgDemo(request('POST', { kind: 'stats', playMs: 'x', usd: -3 }), response());
    expect(store.get(`rpgStats/${day}`)).toMatchObject({ launches: 1, playMs: 90_000 + 30 * 60_000 });
    expect(store.get(`rpgStats/${day}`)!.usd).toBeCloseTo(1.25, 9);
    const status = response();
    await handleRpgDemo(request('GET'), status);
    expect(status.body.today.launches).toBe(1);
    expect(status.body.today.usd).toBeCloseTo(1.75, 9);
  });

  it('answers only the site', async () => {
    const res = response();
    await handleRpgDemo({ ...request('GET'), headers: { origin: 'https://evil.example' } }, res);
    expect(res.statusCode).toBe(403);
  });

  it('is closed when the RPG is switched off in the demo settings', async () => {
    store.set('demo/config', { enabled: true, keyUid: 'owner', apps: { rpg: false } });
    const res = response();
    await handleRpgDemo(request('GET'), res);
    expect(res.body).toMatchObject({ available: false, reason: 'app-off' });
  });
});
