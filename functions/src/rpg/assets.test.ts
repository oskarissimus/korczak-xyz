import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The account's kept assets, through the gateway: what a paid answer leaves in the bucket and in
 * Firestore, and the same request answered from them for nothing. Firestore and the bucket are
 * in-memory maps, the provider a stubbed `fetch`.
 */

const docs = new Map<string, Record<string, unknown>>();
const objects = new Map<string, { bytes: Buffer; options: any }>();

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => ({ __now: true }) },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === 'good') return { uid: 'u1' };
      throw new Error('bad token');
    },
  }),
}));
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: (name: string) => ({
      file: (path: string) => ({
        save: async (bytes: Buffer, options: unknown) => void objects.set(`${name}/${path}`, { bytes, options }),
        download: async () => {
          const o = objects.get(`${name}/${path}`);
          if (!o) throw new Error('no such object');
          return [o.bytes];
        },
      }),
    }),
  }),
}));
vi.mock('../runtime', () => ({
  db: {
    doc: (path: string) => ({
      path,
      get: async () => ({ data: () => docs.get(path), exists: docs.has(path) }),
      set: async (data: Record<string, unknown>) => void docs.set(path, data),
      delete: async () => void docs.delete(path),
    }),
    batch: () => ({ set: () => undefined, commit: async () => undefined }),
  },
}));
vi.mock('../sentry', () => ({ reportError: vi.fn(), flushSentry: vi.fn(async () => {}) }));

import { handleRpgApi } from './gateway';
import { requestFingerprint } from '../../../korczak-xyz/src/utils/rpg/assetStore';

function fakeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    chunks: [] as Buffer[],
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
    status(n: number) {
      res.statusCode = n;
      return res;
    },
    set(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
      return res;
    },
    type(t: string) {
      res.headers['content-type'] = t;
      return res;
    },
    json(v: unknown) {
      res.chunks.push(Buffer.from(JSON.stringify(v)));
      res.end();
    },
    send(v: unknown) {
      res.chunks.push(Buffer.isBuffer(v) ? v : Buffer.from(String(v)));
      res.end();
    },
    write(v: unknown) {
      res.headersSent = true;
      res.chunks.push(Buffer.isBuffer(v) ? v : Buffer.from(String(v)));
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
    text: () => Buffer.concat(res.chunks).toString('utf8'),
    json_: () => JSON.parse(Buffer.concat(res.chunks).toString('utf8')),
  };
  return res;
}

function req(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): any {
  const body = init.body === undefined ? undefined : Buffer.from(JSON.stringify(init.body));
  return {
    url,
    method: init.method ?? 'POST',
    headers: { origin: 'https://korczak.xyz', 'content-type': 'application/json', authorization: 'Bearer good', 'x-rpg-keep': '1', ...(init.headers ?? {}) },
    rawBody: body,
  };
}

const FAL_IMAGE = 'https://v3.fal.media/files/abc/picture.png';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  docs.clear();
  objects.clear();
  docs.set('users/u1/keys/config', { apiKeys: { google: 'AIza-account', fal: 'fal-account', elevenLabs: 'el-account' } });
  fetchMock = vi.fn(async (url: string) => {
    if (url === FAL_IMAGE) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    if (url.endsWith('.glb')) return new Response(new Uint8Array([103, 108, 84, 70]), { headers: { 'content-type': 'model/gltf-binary' } });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const items = () => [...docs.entries()].filter(([k]) => k.startsWith('rpgAssets/u1/items/'));

describe('kept assets', () => {
  it('keeps a FLUX picture with its prompt, answers the bucket’s URL, and answers the same request again for nothing', async () => {
    const body = { prompt: 'a blacksmith in a strict T-pose', image_size: { width: 512, height: 512 }, num_images: 1 };
    fetchMock.mockImplementationOnce(async () => Response.json({ images: [{ url: FAL_IMAGE, width: 512 }] }));
    const first = fakeRes();
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { body, headers: { 'x-rpg-world': 'w-1' } }), first);

    const answer = first.json_();
    expect(answer.images[0].url).toMatch(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/korczak-xyz-501720-rpg\/o\/users%2Fu1%2Frpg%2F.+%2Fimages\.0\.png\?alt=media&token=/);
    expect(first.headers['x-rpg-asset']).toBeTruthy();
    const [[, item]] = items();
    expect(item).toMatchObject({ kind: 'image', provider: 'fal', model: 'fal-ai/flux/schnell', prompt: body.prompt, usd: 0.003, world: 'w-1' });
    expect((item.files as { sourceUrl: string }[])[0].sourceUrl).toBe(FAL_IMAGE);
    const stored = [...objects.keys()];
    expect(stored.some((k) => k.endsWith('/images.0.png'))).toBe(true);
    expect(stored.some((k) => k.endsWith('/meta.json'))).toBe(true);

    // The same request, its keys in another order: no call to fal, $0, the same URL.
    fetchMock.mockClear();
    const again = fakeRes();
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { body: { num_images: 1, image_size: { height: 512, width: 512 }, prompt: body.prompt } }), again);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(again.headers['x-rpg-cost-usd']).toBe('0.000000');
    expect(again.headers['x-rpg-reused']).toBe(first.headers['x-rpg-asset']);
    expect(again.json_().images[0].url).toBe(answer.images[0].url);
  });

  it('asks the provider again when the request says fresh, and the new answer is the one kept after', async () => {
    const body = { prompt: 'a herbalist' };
    fetchMock.mockImplementationOnce(async () => Response.json({ images: [{ url: FAL_IMAGE }] }));
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { body }), fakeRes());
    fetchMock.mockImplementationOnce(async () => Response.json({ images: [{ url: FAL_IMAGE }] }));
    const fresh = fakeRes();
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { body, headers: { 'x-rpg-fresh': '1' } }), fresh);
    expect(fresh.headers['x-rpg-reused']).toBeUndefined();
    expect(items()).toHaveLength(2);
    const fp = await requestFingerprint('fal.run', '/fal-ai/flux/schnell', body);
    expect(docs.get(`rpgAssets/u1/requests/${fp}`)?.assetId).toBe(fresh.headers['x-rpg-asset']);
  });

  it('keeps Meshy’s rig from the queue under what was submitted, and a second rig of the same model never reaches fal', async () => {
    const rigBody = { model_url: 'https://example.test/kowal.glb', height_meters: 1.78, enable_animation: false };
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ request_id: 'r-1', status: 'IN_QUEUE', status_url: 'https://queue.fal.run/fal-ai/meshy/requests/r-1/status', response_url: 'https://queue.fal.run/fal-ai/meshy/requests/r-1' }),
    );
    await handleRpgApi(req('/queue.fal.run/fal-ai/meshy/rigging', { body: rigBody }), fakeRes());
    expect(docs.get('rpgAssets/u1/pending/r-1')).toMatchObject({ kind: 'rig', model: 'fal-ai/meshy/rigging', usd: 0.2 });

    fetchMock.mockImplementationOnce(async () => Response.json({ rigged_character_glb: { url: 'https://v3.fal.media/files/x/rigged.glb', file_size: 4 } }));
    const result = fakeRes();
    await handleRpgApi(req('/queue.fal.run/fal-ai/meshy/requests/r-1', { method: 'GET' }), result);
    const rigged = result.json_().rigged_character_glb.url;
    expect(rigged).toMatch(/korczak-xyz-501720-rpg.+rigged_character_glb\.glb/);
    expect(docs.has('rpgAssets/u1/pending/r-1')).toBe(false);
    const [[, item]] = items();
    expect(item).toMatchObject({ kind: 'rig', usd: 0.2, falRequestId: 'r-1', params: rigBody });

    // Asked again (the lab, another device): answered complete at once, and the result is the kept one.
    fetchMock.mockClear();
    const submit = fakeRes();
    await handleRpgApi(req('/queue.fal.run/fal-ai/meshy/rigging', { body: rigBody }), submit);
    const queued = submit.json_();
    expect(queued.status).toBe('COMPLETED');
    expect(submit.headers['x-rpg-cost-usd']).toBe('0.000000');
    const status = fakeRes();
    await handleRpgApi(req(new URL(queued.status_url).pathname.replace(/^/, '/queue.fal.run'), { method: 'GET' }), status);
    expect(status.json_().status).toBe('COMPLETED');
    const kept = fakeRes();
    await handleRpgApi(req(new URL(queued.response_url).pathname.replace(/^/, '/queue.fal.run'), { method: 'GET' }), kept);
    expect(kept.json_().rigged_character_glb.url).toBe(rigged);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts a Meshy model made with its rig as the rig of that model already paid for', async () => {
    const body = { image_url: 'https://example.test/p.png', enable_rigging: true, rigging_height_meters: 1.68 };
    fetchMock.mockImplementationOnce(async () => Response.json({ request_id: 'm-1', status: 'IN_QUEUE', status_url: 's', response_url: 'r' }));
    await handleRpgApi(req('/queue.fal.run/fal-ai/meshy/v6/image-to-3d', { body }), fakeRes());
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ model_glb: { url: 'https://v3.fal.media/files/x/bare.glb' }, rigged_character_glb: { url: 'https://v3.fal.media/files/x/rigged.glb' } }),
    );
    const result = fakeRes();
    await handleRpgApi(req('/queue.fal.run/fal-ai/meshy/requests/m-1', { method: 'GET' }), result);
    const answer = result.json_();
    const fp = await requestFingerprint('queue.fal.run', '/fal-ai/meshy/rigging', { model_url: answer.model_glb.url, height_meters: 1.68, enable_animation: false });
    const alias = docs.get(`rpgAssets/u1/requests/${fp}`);
    expect(alias?.kind).toBe('rig');
    expect(JSON.parse(alias?.answer as string).rigged_character_glb.url).toBe(answer.rigged_character_glb.url);
  });

  it('keeps a spoken line with its text and serves it again from the bucket, ElevenLabs’ count at nothing', async () => {
    const body = { text: 'Witaj, wędrowcze.', model_id: 'eleven_flash_v2_5' };
    fetchMock.mockImplementationOnce(async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'audio/mpeg' } }));
    await handleRpgApi(req('/api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3_44100_128', { body }), fakeRes());
    const [[, item]] = items();
    expect(item).toMatchObject({ kind: 'voice-line', provider: 'elevenlabs', model: 'eleven_flash_v2_5', prompt: body.text });

    fetchMock.mockClear();
    const again = fakeRes();
    await handleRpgApi(req('/api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3_44100_128', { body }), again);
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...Buffer.concat(again.chunks)]).toEqual([1, 2, 3, 4]);
    expect(again.headers['character-cost']).toBe('0');

    // Another format is another file.
    fetchMock.mockImplementationOnce(async () => new Response(new Uint8Array([9]), { headers: { 'content-type': 'audio/mpeg' } }));
    await handleRpgApi(req('/api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3_22050_32', { body }), fakeRes());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps Google’s picture and names its URL in the answer', async () => {
    const body = { contents: [{ parts: [{ text: 'a guard' }] }], generationConfig: { responseModalities: ['IMAGE'] } };
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('png!').toString('base64') } }] } }], modelVersion: 'gemini-3.1-flash-lite-image' }),
    );
    const res = fakeRes();
    await handleRpgApi(req('/generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent', { body }), res);
    expect(res.json_().rpgAsset.url).toMatch(/korczak-xyz-501720-rpg.+image\.png/);
    const [[, item]] = items();
    expect(item).toMatchObject({ kind: 'image', provider: 'google', model: 'gemini-3.1-flash-lite-image', prompt: 'a guard' });
  });

  it('keeps nothing for a model’s text, nor for a signed-out reader', async () => {
    fetchMock.mockImplementationOnce(async () => Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    await handleRpgApi(req('/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', { body: { contents: [] } }), fakeRes());
    fetchMock.mockImplementationOnce(async () => Response.json({ images: [{ url: FAL_IMAGE }] }));
    await handleRpgApi(req('/fal.run/fal-ai/flux/schnell', { body: { prompt: 'x' }, headers: { authorization: '', 'x-rpg-key': 'own' } }), fakeRes());
    expect(items()).toHaveLength(0);
  });

  it('keeps a rig the browser worked out, and hands it back to another device', async () => {
    const id = 'a'.repeat(40);
    const put = fakeRes();
    const r = req(`/_assets/self-rig/${id}`, { method: 'PUT', headers: { 'x-rpg-asset-meta': '{"weights":"voxel"}' } });
    r.rawBody = Buffer.from([5, 6, 7]);
    await handleRpgApi(r, put);
    expect(put.statusCode).toBe(200);
    const get = fakeRes();
    await handleRpgApi(req(`/_assets/self-rig/${id}`, { method: 'GET' }), get);
    expect([...Buffer.concat(get.chunks)]).toEqual([5, 6, 7]);
    const [[, item]] = items();
    expect(item).toMatchObject({ kind: 'self-rig', model: 'self-rig/voxel', usd: 0 });
  });
});
