import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The runner of the RPG's generation jobs: it claims a queued job once, asks the models in order
 * moving on as the browser would, writes what it has as it goes, and a world it bears starts its
 * hub's jobs. Firestore is an in-memory map; the providers are a fake fetch.
 */

const store = new Map<string, Record<string, any>>();

function setPath(target: Record<string, any>, path: string, value: unknown) {
  const parts = path.split('.');
  let at = target;
  for (const p of parts.slice(0, -1)) at = at[p] ??= {};
  if ((value as { __delete?: boolean } | null)?.__delete) delete at[parts.at(-1)!];
  else at[parts.at(-1)!] = value;
}

function ref(path: string): any {
  return {
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    update: async (fields: Record<string, unknown>) => {
      const next = structuredClone(store.get(path) ?? {});
      for (const [k, v] of Object.entries(fields)) setPath(next, k, v);
      store.set(path, next);
    },
    create: async (data: Record<string, unknown>) => {
      if (store.has(path)) throw new Error('ALREADY_EXISTS');
      store.set(path, data);
    },
  };
}

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => ({ __delete: true }) },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
vi.mock('../runtime', () => ({
  db: {
    doc: ref,
    runTransaction: async (fn: (tx: any) => unknown) => fn({ get: (r: any) => r.get(), update: (r: any, f: Record<string, unknown>) => r.update(f) }),
  },
}));

import { runJob } from './jobs';
import { falJobId, hubScope, llmJobId, reuse, type LlmSpec } from '../../../korczak-xyz/src/utils/rpg/jobs';
import { CARD_ERROR } from '../../../korczak-xyz/src/utils/rpg/meshShape';
import { crossed, makeGlb } from '../../../korczak-xyz/src/utils/rpg/meshShape.fixtures';
import { parseWorlds } from '../../../korczak-xyz/src/utils/rpg/genesis';

const UID = 'u1';
const path = (id: string) => `users/${UID}/rpgJobs/${id}`;

function sse(...chunks: unknown[]): Response {
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join(''), { status: 200 });
}

function queue(spec: Record<string, unknown>, id: string) {
  store.set(path(id), { spec, status: 'queued', createdAt: Date.now(), heartbeat: null, finishedAt: null, error: null });
}

const genesisCtx = { lang: 'en', seeds: ['salt', 'bells', 'Ferry'], avoid: [], exotic: 40 };
const worldAnswer = JSON.stringify({
  worlds: [
    {
      name: 'Bellmarsh',
      typicality: 40,
      pitch: 'Salt flats where bells call the tide.',
      tone: 'wry',
      tech: 'bronze',
      climate: 'dry',
      people: 'salt rakers',
      architecture: 'white domes',
      threats: 'tide wraiths',
      player: 'a bell warden',
      address: 'warden',
      hub: 'Ringing Ford',
      words: ['toll'],
      landmark: 'a white domed bell tower',
      kit: { house: 'a white dome hut', tree: 'a salt-crusted thorn tree' },
      look: { sky: '#88aacc', fog: '#ccddee', time: 'day', weather: 'clear', flora: 'dead', water: 'none', growth: 'sparse' },
    },
  ],
});

beforeEach(() => {
  store.clear();
  store.set(`users/${UID}/keys/config`, { apiKeys: { google: 'g-key', fal: 'f-key' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('runJob', () => {
  it('moves past a model that is not on offer, and keeps the answer, the tries and when the winner began', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(url);
        if (url.includes('pro')) return new Response('{"error":{"message":"not found"}}', { status: 404 });
        return sse(
          { modelVersion: 'flash-001', candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] } }] },
          { candidates: [{ content: { parts: [{ text: '{"sizes":{"house":[5,7]}}' }] }, finishReason: 'STOP' }] },
          { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 } },
        );
      }),
    );
    const spec: LlmSpec = { kind: 'llm', provider: 'google', models: ['pro', 'flash'], prompt: 'p', temperature: 0.2, thinking: null, parse: 'sizes', ctx: 'null', pieces: false };
    const id = llmJobId(spec);
    queue(spec as unknown as Record<string, unknown>, id);
    await runJob(UID, id);
    const job = store.get(path(id))!;
    expect(job.status).toBe('done');
    expect(job.outcome).toBe('generated');
    expect(job.model).toBe('flash');
    expect(job.tries.map((t: any) => [t.model, t.status])).toEqual([
      ['pro', 404],
      ['flash', 200],
    ]);
    expect(job.tries[1].usage).toEqual({ input: 10, output: 20, thoughts: 5 });
    expect(job.tries[1].servedBy).toBe('flash-001');
    expect(job.at).toBe(job.tries[1].at);
    expect(job.spec.ctx).toBeUndefined();
    // The key went in a header, never the address.
    expect(asked.every((u) => !u.includes('g-key'))).toBe(true);
  });

  it('runs a job once, however many times its write is delivered', async () => {
    const fetchMock = vi.fn(async () => sse({ candidates: [{ content: { parts: [{ text: '{"sizes":{"house":[5,7]}}' }] } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const spec = { kind: 'llm', provider: 'google', models: ['flash'], prompt: 'p', temperature: 0.2, thinking: null, parse: 'sizes', ctx: 'null', pieces: false };
    queue(spec, 'j');
    await Promise.all([runJob(UID, 'j'), runJob(UID, 'j')]);
    await runJob(UID, 'j');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says when the account has no key, so the browser asks with its own", async () => {
    store.set(`users/${UID}/keys/config`, { apiKeys: {} });
    queue({ kind: 'llm', provider: 'google', models: ['flash'], prompt: 'p', temperature: 1, thinking: null, parse: 'sizes', ctx: 'null', pieces: false }, 'k');
    await runJob(UID, 'k');
    expect(store.get(path('k'))).toMatchObject({ status: 'failed', noKey: true });
  });

  it('bears a world the browser parses to the same id, and starts its hub on the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse({ candidates: [{ content: { parts: [{ text: worldAnswer }] } }] })));
    queue({ kind: 'llm', provider: 'google', models: ['flash'], prompt: 'p', temperature: 1, thinking: 'low', parse: 'world', ctx: JSON.stringify(genesisCtx), pieces: true }, 'w');
    await runJob(UID, 'w');
    const job = store.get(path('w'))!;
    expect(job.status).toBe('done');
    const [world] = parseWorlds(job.raw, genesisCtx as any, job.at);
    for (const slot of ['landmark', 'house', 'tree', 'tree2'] as const) {
      const piece = store.get(path(falJobId(hubScope(world.id, slot))));
      expect(piece?.status, slot).toBe('queued');
      expect(piece?.spec.kind).toBe('fal');
    }
  });

  it('makes a piece: the picture, then the model through the queue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const polls = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('https://fal.run/')) return Response.json({ images: [{ url: 'https://img/1.png' }] });
        if (url.startsWith('https://queue.fal.run/')) return Response.json({ status_url: 'https://q/status', response_url: 'https://q/response' });
        if (url === 'https://q/status') return Response.json({ status: polls.shift(), queue_position: 3 });
        return Response.json({ model_mesh: { url: 'https://glb/1.glb', file_size: 2048 } });
      }),
    );
    queue({ kind: 'fal', label: 'house', prompt: 'a hut', size: 512, simplify: 0.98 }, 'f');
    const done = runJob(UID, 'f');
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    const job = store.get(path('f'))!;
    expect(job.status).toBe('done');
    expect(job.result).toMatchObject({ image: 'https://img/1.png', glb: 'https://glb/1.glb' });
    expect(job.result.costUsd).toBeCloseTo(0.023);
    expect(job.fal.mesh).toMatchObject({ state: 'done', kb: 2 });
  });

  it('fails a piece TRELLIS made into crossed cards, so the next ask is a new picture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('https://fal.run/')) return Response.json({ images: [{ url: 'https://img/1.png' }] });
        if (url.startsWith('https://queue.fal.run/')) return Response.json({ status_url: 'https://q/status', response_url: 'https://q/response' });
        if (url === 'https://q/status') return Response.json({ status: 'COMPLETED' });
        if (url === 'https://glb/1.glb') return new Response(makeGlb(crossed));
        return Response.json({ model_mesh: { url: 'https://glb/1.glb', file_size: 2048 } });
      }),
    );
    queue({ kind: 'fal', label: 'tree3', prompt: 'an old oak', size: 512, simplify: 0.98 }, 'f');
    const done = runJob(UID, 'f');
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    const job = store.get(path('f'))!;
    expect(job.status).toBe('failed');
    expect(job.error).toBe(CARD_ERROR);
    expect(reuse(job, Date.now())).toBe('replace');
  });
});
