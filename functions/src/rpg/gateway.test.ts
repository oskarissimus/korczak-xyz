import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The RPG's gateway: who pays, what passes, what it cost. Firestore is an in-memory map, the
 * provider a stubbed `fetch`, the request and the response the few pieces of Express it uses.
 */

const store = new Map<string, Record<string, unknown>>();
const written: { path: string; data: Record<string, unknown> }[] = [];

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => ({ __now: true }) },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === 'good') return { uid: 'u1' };
      if (token === 'keyless') return { uid: 'u2' };
      throw new Error('bad token');
    },
  }),
}));
vi.mock('../runtime', () => ({
  db: {
    doc: (path: string) => ({ path, get: async () => ({ data: () => store.get(path) }) }),
    batch: () => {
      const writes: { path: string; data: Record<string, unknown> }[] = [];
      return {
        set: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ path: ref.path, data }),
        commit: async () => written.push(...writes),
      };
    },
  },
}));
vi.mock('../sentry', () => ({ reportError: vi.fn(), flushSentry: vi.fn(async () => {}) }));

import { gatewayPathOf, handleRpgApi, ledgerWrites } from './gateway';

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  chunks: string[];
  headersSent: boolean;
  writableEnded: boolean;
  writableFinished: boolean;
  status(n: number): FakeRes;
  set(k: string, v: string): FakeRes;
  json(v: unknown): void;
  send(v: unknown): void;
  write(v: unknown): boolean;
  end(): void;
  flushHeaders(): void;
  on(): FakeRes;
  body(): string;
}

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    chunks: [],
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
    status(n) {
      res.statusCode = n;
      return res;
    },
    set(k, v) {
      res.headers[k.toLowerCase()] = v;
      return res;
    },
    json(v) {
      res.chunks.push(JSON.stringify(v));
      res.end();
    },
    send(v) {
      res.chunks.push(Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
      res.end();
    },
    write(v) {
      res.headersSent = true;
      res.chunks.push(Buffer.isBuffer(v) ? v.toString('utf8') : String(v));
      return true;
    },
    end() {
      res.headersSent = true;
      res.writableEnded = true;
      res.writableFinished = true;
    },
    flushHeaders() {
      res.headersSent = true;
    },
    on() {
      return res;
    },
    body: () => res.chunks.join(''),
  };
  return res;
}

function req(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): any {
  const body = init.body === undefined ? undefined : Buffer.from(JSON.stringify(init.body));
  return {
    url,
    method: init.method ?? 'POST',
    headers: { origin: 'https://korczak.xyz', 'content-type': 'application/json', ...(init.headers ?? {}) },
    rawBody: body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store.clear();
  written.length = 0;
  store.set('users/u1/keys/config', { apiKeys: { google: 'AIza-account', fal: 'fal-account', elevenLabs: 'el-account' } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const STREAM =
  'data: {"candidates":[{"content":{"parts":[{"text":"{}"}]}}],"modelVersion":"gemini-3.8-flash"}\r\n\r\n' +
  'data: {"usageMetadata":{"promptTokenCount":1000,"candidatesTokenCount":1000,"thoughtsTokenCount":0},"modelVersion":"gemini-3.8-flash"}\r\n\r\n';

describe('rpgApi', () => {
  it('puts the account’s key on a signed-in reader’s request, streams the answer through and prices it', async () => {
    fetchMock.mockResolvedValueOnce(new Response(STREAM, { headers: { 'content-type': 'text/event-stream' } }));
    const res = fakeRes();
    await handleRpgApi(
      req('/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=leak', {
        headers: { authorization: 'Bearer good', 'x-rpg-world': 'w-1', 'x-rpg-quest': 'q-1' },
        body: { contents: [] },
      }),
      res as any,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(init.headers['x-goog-api-key']).toBe('AIza-account');
    expect(res.statusCode).toBe(200);
    expect(res.body()).toContain('"text":"{}"');
    // 1000 in at $0.75/M + 1000 out at $3.75/M.
    expect(res.body()).toContain(': rpg-cost {"usd":0.0045');
    expect(res.body()).not.toContain('AIza-account');
    const paths = written.map((w) => w.path);
    expect(paths).toEqual(expect.arrayContaining(['rpgLedger/u1', 'rpgLedger/u1/worlds/w-1', 'rpgLedger/u1/quests/q-1']));
    expect(paths.some((p) => p.startsWith('rpgLedger/u1/days/'))).toBe(true);
    expect((written[0].data.usd as { __inc: number }).__inc).toBeCloseTo(0.0045);
  });

  it('uses a signed-out reader’s own key for that one request, and writes no ledger', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }));
    const res = fakeRes();
    await handleRpgApi(
      req('/api.elevenlabs.io/v1/text-to-speech/v1?output_format=mp3_44100_128', {
        headers: { 'x-rpg-key': 'el-own' },
        body: { text: 'x'.repeat(200), model_id: 'eleven_flash_v2_5' },
      }),
      res as any,
    );
    expect(fetchMock.mock.calls[0][1].headers['xi-api-key']).toBe('el-own');
    expect(Number(res.headers['x-rpg-cost-usd'])).toBeGreaterThan(0);
    expect(written).toEqual([]);
  });

  it('passes a provider’s refusal on with its own status and words', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"User is locked. Reason: TOP_UP."}', { status: 403, headers: { 'content-type': 'application/json' } }));
    const res = fakeRes();
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { headers: { authorization: 'Bearer good' }, body: { prompt: 'x' } }), res as any);
    expect(res.statusCode).toBe(403);
    expect(res.body()).toContain('TOP_UP');
    expect(written).toEqual([]);
  });

  it('refuses with a funds reason when nobody pays, without asking the provider', async () => {
    store.set('users/u2/keys/config', { apiKeys: {} });
    const res = fakeRes();
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { headers: { authorization: 'Bearer keyless' }, body: {} }), res as any);
    expect(res.statusCode).toBe(402);
    expect(res.body()).toContain('rpg-credits');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses what the game never sends, another origin and a bad token', async () => {
    let res = fakeRes();
    await handleRpgApi(req('/api.elevenlabs.io/v1/user/subscription', { method: 'GET', headers: { authorization: 'Bearer good' } }), res as any);
    expect(res.statusCode).toBe(404);
    res = fakeRes();
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { headers: { origin: 'https://evil.example', 'x-rpg-key': 'k' } }), res as any);
    expect(res.statusCode).toBe(403);
    res = fakeRes();
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { headers: { authorization: 'Bearer bad' } }), res as any);
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prices a fal.ai job when it is submitted, and the status polls cost nothing', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"status_url":"s","response_url":"r"}', { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{"status":"IN_QUEUE"}', { headers: { 'content-type': 'application/json' } }));
    let res = fakeRes();
    await handleRpgApi(req('/queue.fal.run/fal-ai/trellis', { headers: { authorization: 'Bearer good' }, body: { image_url: 'x' } }), res as any);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Key fal-account');
    expect(res.headers['x-rpg-cost-usd']).toBe('0.020000');
    const after = written.length;
    res = fakeRes();
    await handleRpgApi(req('/queue.fal.run/fal-ai/trellis/requests/abc/status', { method: 'GET', headers: { authorization: 'Bearer good' } }), res as any);
    expect(res.headers['x-rpg-cost-usd']).toBeUndefined();
    expect(written.length).toBe(after);
  });
});

describe('gatewayPathOf', () => {
  it('drops the function’s name and any key in the query', () => {
    expect(gatewayPathOf('/rpgApi/fal.run/fal-ai/x?key=1&alt=sse')).toEqual({ path: '/fal.run/fal-ai/x', query: 'alt=sse' });
    expect(gatewayPathOf('/fal.run/fal-ai/x')).toEqual({ path: '/fal.run/fal-ai/x', query: '' });
  });
});

describe('ledgerWrites', () => {
  it('writes nothing for a free or unpriced call', () => {
    const base = { provider: 'google' as const, model: 'gemma-4', kind: 'account' as const, world: null, quest: null };
    expect(ledgerWrites('u1', { ...base, usd: 0 }, '2026-10-31')).toEqual([]);
    expect(ledgerWrites('u1', { ...base, usd: null }, '2026-10-31')).toEqual([]);
  });
});
