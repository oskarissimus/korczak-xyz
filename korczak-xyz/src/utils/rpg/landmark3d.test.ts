import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/sentry', () => ({ recordMeasurement: vi.fn() }));

import { devRequests, questTotals, resetDevlog } from './devlog';
import { classicWorld, type WorldBible } from './genesis';
import { ensureLandmark, FAL_IMAGE_MODEL, FAL_MESH_MODEL, generateLandmark, imageCost, landmarkPrompt } from './landmark3d';

const world = (over: Partial<WorldBible> = {}): WorldBible => ({
  ...classicWorld('en'),
  id: 'w1',
  createdAt: 1,
  landmark: 'a rusted lighthouse whose lantern burns green',
  ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** fal's two endpoints as they answered in Oct 2026, the queue in progress once before it is done. */
function falFetch(calls: string[], fail?: { url: string; status: number }) {
  let polls = 0;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (fail && url.startsWith(fail.url)) return json({ detail: 'nope' }, fail.status);
    if (url === `https://fal.run/${FAL_IMAGE_MODEL}`) return json({ images: [{ url: 'https://fal.media/img.jpg' }] });
    if (url === `https://queue.fal.run/${FAL_MESH_MODEL}`)
      return json({ status: 'IN_QUEUE', status_url: 'https://q/status', response_url: 'https://q/result' });
    if (url === 'https://q/status') return json({ status: polls++ ? 'COMPLETED' : 'IN_PROGRESS' });
    if (url === 'https://q/result') return json({ model_mesh: { url: 'https://fal.media/model.glb', file_size: 650_000 } });
    throw new Error(`unexpected ${url}`);
  });
}

const now = { sleep: async () => {} };

describe('landmark3d', () => {
  beforeEach(() => resetDevlog());

  it('asks for the world’s own landmark, and describes an older world’s from its hub', () => {
    expect(landmarkPrompt(world())).toContain('a rusted lighthouse whose lantern burns green');
    const old = landmarkPrompt(world({ landmark: undefined }));
    expect(old).toContain(classicWorld('en').hub);
    expect(old).toContain('white background');
  });

  it('bills the picture by the megapixel, rounded up', () => {
    expect(imageCost(512, 512)).toBe(0.003);
    expect(imageCost(1024, 1024)).toBe(0.006);
  });

  it('draws, then builds through the queue, and prices both in the console apart from the tokens', async () => {
    const calls: string[] = [];
    const model = await generateLandmark('k', world(), { ...now, fetchImpl: falFetch(calls) as typeof fetch });
    expect(model).toMatchObject({ glb: 'https://fal.media/model.glb', image: 'https://fal.media/img.jpg' });
    expect(model.costUsd).toBeCloseTo(0.023);
    expect(calls.filter((c) => c === 'https://q/status')).toHaveLength(2);
    const entries = devRequests();
    expect(entries.map((e) => [e.kind, e.model, e.status])).toEqual([
      ['fal', FAL_IMAGE_MODEL, 'ok'],
      ['fal', FAL_MESH_MODEL, 'ok'],
    ]);
    const totals = questTotals();
    expect(totals.falCost).toBeCloseTo(0.023);
    expect(totals.modelCost).toBe(0);
  });

  it('puts a refused step in the console as an error, and does not ask again this session', async () => {
    const calls: string[] = [];
    const fetchImpl = falFetch(calls, { url: 'https://fal.run/', status: 403 }) as typeof fetch;
    const w = world({ id: 'w-refused' });
    await expect(ensureLandmark('k', w, { ...now, fetchImpl })).rejects.toThrow('403');
    expect(devRequests()[0]).toMatchObject({ kind: 'fal', status: 'error' });
    expect(questTotals().falCost).toBe(0);
    expect(ensureLandmark('k', w, { ...now, fetchImpl })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('never makes a landmark the world already has, and makes one at a time', async () => {
    const calls: string[] = [];
    const fetchImpl = falFetch(calls) as typeof fetch;
    const kept = { glb: 'g', image: 'i', prompt: 'p', costUsd: 0.023, ms: 1, at: 1 };
    await expect(ensureLandmark('k', world({ landmarkModel: kept }), { fetchImpl })).resolves.toBe(kept);
    expect(calls).toHaveLength(0);
    const w = world({ id: 'w-twice' });
    const a = ensureLandmark('k', w, { ...now, fetchImpl });
    const b = ensureLandmark('k', w, { ...now, fetchImpl });
    expect(a).toBe(b);
    await a;
    expect(calls.filter((c) => c.endsWith(FAL_MESH_MODEL))).toHaveLength(1);
  });

  it('keeps a step still running when a new quest clears the console', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const inner = falFetch(calls);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes('flux')) await gate;
      return inner(input);
    }) as typeof fetch;
    const p = generateLandmark('k', world({ id: 'w-slow' }), { ...now, fetchImpl });
    resetDevlog();
    expect(devRequests()).toHaveLength(1);
    release();
    await p;
    expect(devRequests()).toHaveLength(2);
  });
});
