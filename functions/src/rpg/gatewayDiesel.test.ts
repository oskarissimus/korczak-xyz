import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Diesel through the gateway: a signed-in reader with no key of their own, on one of the game's
 * requests, is paid with the server's key out of their tank — reserved first, settled after.
 * The tank itself (`wallet.ts`) is mocked here; its transaction is tested in `wallet.test.ts`.
 */

const store = new Map<string, Record<string, unknown>>();
const written: { path: string; data: Record<string, unknown> }[] = [];
const reserve = vi.fn();
const settle = vi.fn(async () => {});
const topUp = vi.fn(async () => 3);

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => ({ __now: true }), delete: () => ({ __del: true }) },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token === 'keyless' ? 'u2' : 'u1' }) }),
}));
vi.mock('../runtime', () => ({
  RPG_BUCKET: 'korczak-xyz-501720-rpg',
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
vi.mock('./wallet', () => ({
  reserveDiesel: (...a: unknown[]) => reserve(...a),
  settleDiesel: (...a: unknown[]) => settle(...(a as [])),
  topUpDiesel: (...a: unknown[]) => topUp(...a),
  walletStatus: async () => ({ balanceUsd: 1, grantUsd: 1, server: { google: true, elevenLabs: true, fal: true, openai: false } }),
}));
vi.mock('./assets', () => ({
  assetContext: async () => null,
  serveReused: async () => false,
  serveReusedQueue: async () => false,
  handleSelfRig: vi.fn(),
  keepAudio: vi.fn(),
  keepJson: async () => null,
}));
vi.mock('./admin', () => ({
  AdminRefusal: class extends Error {},
  handleAdmin: vi.fn(),
  isAdminUid: async (uid: string) => uid === 'u1',
  readServerKeys: async () => ({ google: 'AIza-server', elevenLabs: 'el-server', fal: 'fal-server', openai: null }),
}));

import { forgetCachedKeys, handleRpgApi } from './gateway';

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
  forgetCachedKeys();
  store.clear();
  written.length = 0;
  reserve.mockReset();
  settle.mockClear();
  store.set('users/u2/keys/config', { apiKeys: {} });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const STREAM =
  'data: {"candidates":[{"content":{"parts":[{"text":"{}"}]}}],"modelVersion":"gemini-3.8-flash"}\r\n\r\n' +
  'data: {"usageMetadata":{"promptTokenCount":1000,"candidatesTokenCount":1000,"thoughtsTokenCount":0},"modelVersion":"gemini-3.8-flash"}\r\n\r\n';
const BEAT = '/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse';
const GAME = { authorization: 'Bearer keyless', 'x-rpg-keep': '1' };

describe('diesel', () => {
  it('pays a keyless reader’s beat with the server key, reserving the worst case and settling what it cost', async () => {
    reserve.mockResolvedValueOnce({ ok: true, balanceUsd: 0.9 });
    fetchMock.mockResolvedValueOnce(new Response(STREAM, { headers: { 'content-type': 'text/event-stream' } }));
    const res = fakeRes();
    await handleRpgApi(req(BEAT, { headers: GAME, body: { contents: [{ parts: [{ text: 'x'.repeat(4000) }] }] } }), res as any);
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('AIza-server');
    const [uid, reserved, free] = reserve.mock.calls[0];
    expect(uid).toBe('u2');
    expect(free).toBe(false);
    // The whole output budget at Flash's $3.75/M is the bulk of it.
    expect(reserved).toBeGreaterThan(0.06);
    expect(settle).toHaveBeenCalledWith('u2', reserved, expect.closeTo(0.0045, 6));
    expect(res.body()).not.toContain('AIza-server');
    expect(written.find((w) => w.path.startsWith('rpgLedger/u2/days/'))?.data.byPayer).toEqual({ diesel: { __inc: expect.closeTo(0.0045, 6) } });
  });

  it('refuses an empty tank in words the game reads as diesel, without asking the provider', async () => {
    reserve.mockResolvedValueOnce({ ok: false, balanceUsd: 0.01 });
    const res = fakeRes();
    await handleRpgApi(req(BEAT, { headers: GAME, body: { contents: [] } }), res as any);
    expect(res.statusCode).toBe(402);
    expect(res.body()).toContain('rpg-credits');
    expect(res.body()).toContain('no-diesel');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it('gives the whole reservation back when the provider refuses', async () => {
    reserve.mockResolvedValueOnce({ ok: true, balanceUsd: 0.5 });
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"quota"}}', { status: 429, headers: { 'content-type': 'application/json' } }));
    const res = fakeRes();
    await handleRpgApi(req(BEAT, { headers: GAME, body: { contents: [] } }), res as any);
    expect(res.statusCode).toBe(429);
    expect(settle).toHaveBeenCalledWith('u2', expect.any(Number), 0);
  });

  it('prices a fal.ai job exactly up front, and lets its status polls through for nothing', async () => {
    reserve.mockResolvedValue({ ok: true, balanceUsd: 0.5 });
    fetchMock
      .mockResolvedValueOnce(new Response('{"request_id":"abc"}', { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{"status":"IN_QUEUE"}', { headers: { 'content-type': 'application/json' } }));
    await handleRpgApi(req('/queue.fal.run/fal-ai/trellis', { headers: GAME, body: { image_url: 'x' } }), fakeRes() as any);
    expect(reserve.mock.calls[0][1]).toBeCloseTo(0.02);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Key fal-server');
    await handleRpgApi(req('/queue.fal.run/fal-ai/trellis/requests/abc/status', { method: 'GET', headers: GAME }), fakeRes() as any);
    expect(reserve.mock.calls[1].slice(1)).toEqual([0, true]);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Key fal-server');
  });

  it('pays nothing for another app’s request, a key the server lacks, or a signed-out page', async () => {
    let res = fakeRes();
    await handleRpgApi(req(BEAT, { headers: { authorization: 'Bearer keyless' }, body: {} }), res as any);
    expect(res.statusCode).toBe(402);
    expect(res.body()).not.toContain('no-diesel');
    res = fakeRes();
    await handleRpgApi(req('/api.openai.com/v1/chat/completions', { headers: GAME, body: { model: 'gpt-4.1' } }), res as any);
    expect(res.statusCode).toBe(402);
    res = fakeRes();
    await handleRpgApi(req(BEAT, { headers: { 'x-rpg-keep': '1' }, body: {} }), res as any);
    expect(res.statusCode).toBe(402);
    expect(reserve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never spends diesel when the account has its own key', async () => {
    store.set('users/u1/keys/config', { apiKeys: { google: 'AIza-own' } });
    fetchMock.mockResolvedValueOnce(new Response(STREAM, { headers: { 'content-type': 'text/event-stream' } }));
    await handleRpgApi(req(BEAT, { headers: { authorization: 'Bearer good', 'x-rpg-keep': '1' }, body: {} }), fakeRes() as any);
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('AIza-own');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('pours an admin’s canister for free, and refuses anyone else', async () => {
    let res = fakeRes();
    await handleRpgApi(req('/wallet/refuel', { headers: { authorization: 'Bearer good' }, body: { canister: 'barrel' } }), res as any);
    expect(res.statusCode).toBe(200);
    expect(topUp).toHaveBeenCalledWith('u1', 4.5);
    res = fakeRes();
    await handleRpgApi(req('/wallet/refuel', { headers: { authorization: 'Bearer keyless' }, body: { canister: 'barrel' } }), res as any);
    expect(res.statusCode).toBe(403);
    res = fakeRes();
    await handleRpgApi(req('/wallet/refuel', { headers: { authorization: 'Bearer good' }, body: { canister: 'truck' } }), res as any);
    expect(res.statusCode).toBe(400);
    expect(topUp).toHaveBeenCalledTimes(1);
  });
});
