import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The game's admin panel on the gateway: who may, what comes back (never a whole key), what a patch
 * writes, and that the demo spends the server's key before the paying account's.
 */

const store = new Map<string, Record<string, unknown>>();
const DELETE = { __delete: true };

/** A merge write: nested maps merged, `DELETE` removing a field. */
function merge(into: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...into };
  for (const [k, v] of Object.entries(data)) {
    if (v === DELETE) delete next[k];
    else if (v && typeof v === 'object' && !Array.isArray(v)) next[k] = merge((next[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    else next[k] = v;
  }
  return next;
}

function doc(path: string): any {
  return {
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
  };
}
function collection(path: string): any {
  return { doc: (id: string) => doc(`${path}/${id}`) };
}

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => ({}), delete: () => DELETE },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === 'admin') return { uid: 'boss' };
      if (token === 'player') return { uid: 'p1' };
      throw new Error('bad token');
    },
  }),
}));
vi.mock('../runtime', () => ({
  RPG_BUCKET: 'korczak-xyz-501720-rpg',
  db: {
    collection,
    doc,
    batch: () => {
      const writes: [string, Record<string, unknown>][] = [];
      return {
        set: (ref: any, data: Record<string, unknown>) => writes.push([ref.path, data]),
        commit: async () => writes.forEach(([p, d]) => store.set(p, merge(store.get(p) ?? {}, d))),
      };
    },
  },
}));
vi.mock('../sentry', () => ({ reportError: vi.fn(), flushSentry: vi.fn(async () => {}) }));

import { handleRpgApi } from './gateway';
import { demoKeys } from './admin';

function fakeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    chunks: [] as string[],
    headersSent: false,
    status(n: number) {
      res.statusCode = n;
      return res;
    },
    set(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
      return res;
    },
    json(v: unknown) {
      res.chunks.push(JSON.stringify(v));
      res.headersSent = true;
    },
    send(v: unknown) {
      res.chunks.push(String(v));
      res.headersSent = true;
    },
    on: () => res,
    body: () => JSON.parse(res.chunks.join('')),
  };
  return res;
}

function call(token: string | null, method = 'GET', body?: unknown) {
  const res = fakeRes();
  const req: any = {
    url: '/admin/config',
    method,
    headers: { origin: 'https://korczak.xyz', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  };
  return handleRpgApi(req, res).then(() => res);
}

beforeEach(() => {
  store.clear();
  store.set('admins/boss', {});
});

describe('/admin/config', () => {
  it('refuses the signed out and the non-admin', async () => {
    expect((await call(null)).statusCode).toBe(401);
    const res = await call('player');
    expect(res.statusCode).toBe(403);
    expect(res.body().reason).toBe('not-admin');
  });

  it('sets a key and answers only its last four characters', async () => {
    const res = await call('admin', 'POST', { keys: { google: '  AIzaSecretGoogleKey1234 ' } });
    expect(res.statusCode).toBe(200);
    expect(res.chunks.join('')).not.toContain('AIzaSecret');
    expect(res.body().keys).toEqual({ google: '1234', elevenLabs: null, fal: null, openai: null });
    expect(res.headers['cache-control']).toBe('no-store');
    expect((store.get('rpgServerKeys/config')!.apiKeys as Record<string, string>).google).toBe('AIzaSecretGoogleKey1234');
    expect(store.get('rpgServerKeys/config')!.updatedBy).toBe('boss');
  });

  it('clears one key with null and leaves the others', async () => {
    store.set('rpgServerKeys/config', { apiKeys: { google: 'g-key-aaaa', fal: 'fal-key-bbbb' } });
    const res = await call('admin', 'POST', { keys: { fal: null } });
    expect(res.body().keys).toMatchObject({ google: 'aaaa', fal: null });
  });

  it('refuses a key it does not know and a key with spaces in it', async () => {
    expect((await call('admin', 'POST', { keys: { gogle: 'x' } })).statusCode).toBe(400);
    expect((await call('admin', 'POST', { keys: { google: 'two words' } })).statusCode).toBe(400);
    expect((await call('admin', 'POST', { demo: { perIpUsd: 999 } })).statusCode).toBe(400);
    expect(store.has('rpgServerKeys/config')).toBe(false);
  });

  it('writes the demo dials into demo/config, merged with the roaster’s fields', async () => {
    store.set('demo/config', { enabled: true, keyUid: 'boss', perIpDaily: 6, apps: { roaster: true } });
    const res = await call('admin', 'POST', { demo: { on: false, perIpUsd: 2.5, dailyUsd: 20 } });
    expect(res.body().demo).toMatchObject({ on: false, perIpUsd: 2.5, dailyUsd: 20, enabled: true });
    expect(store.get('demo/config')).toMatchObject({ perIpDaily: 6, keyUid: 'boss', apps: { roaster: true, rpg: false }, rpgPerIpUsd: 2.5 });
  });
});

describe('the demo’s keys', () => {
  it('are the server’s first, then the paying account’s, one key at a time', async () => {
    store.set('users/boss/keys/config', { apiKeys: { google: 'account-google', elevenLabs: 'account-voice' } });
    expect(await demoKeys('boss')).toEqual({ google: 'account-google', elevenLabs: 'account-voice', payer: 'account' });
    store.set('rpgServerKeys/config', { apiKeys: { google: 'server-google' } });
    expect(await demoKeys('boss')).toEqual({ google: 'server-google', elevenLabs: 'account-voice', payer: 'server' });
    expect(await demoKeys('')).toEqual({ google: 'server-google', elevenLabs: null, payer: 'server' });
    store.delete('rpgServerKeys/config');
    expect((await demoKeys('')).payer).toBe('nobody');
  });
});
