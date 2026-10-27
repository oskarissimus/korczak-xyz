import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/sentry', () => ({ recordMeasurement: vi.fn() }));

import { devRequests, questTotals, resetDevlog } from './devlog';
import { classicWorld, type WorldBible } from './genesis';
import {
  ensureHubModels,
  FAL_IMAGE_MODEL,
  FAL_MESH_MODEL,
  FOREST_SLOTS,
  generateHubModel,
  generateLandmark,
  HUB_SLOTS,
  hubModelPrompt,
  hubSlots,
  imageCost,
  landmarkPrompt,
  type HubSlot,
  type LandmarkModel,
} from './landmark3d';

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

  it('asks for a picture again after fal.ai’s 429, and times the mesh’s wait in the queue apart', async () => {
    const calls: string[] = [];
    const ok = falFetch(calls);
    let refusals = 2;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith('https://fal.run/') && refusals-- > 0
        ? json({ detail: 'concurrent_requests_limit' }, 429)
        : ok(input, init),
    ) as unknown as typeof fetch;
    const slept: number[] = [];
    const model = await generateLandmark('k', world(), { fetchImpl, sleep: async (ms) => void slept.push(ms) });
    expect(model.glb).toBe('https://fal.media/model.glb');
    expect(slept.slice(0, 2)).toEqual([1000, 2000]);
    expect(model.queuedMs).toBeGreaterThanOrEqual(0);
    expect(devRequests().map((e) => e.status)).toEqual(['ok', 'ok']);
  });

  it('puts a refused step in the console as an error, stops the world’s other pieces, and does not ask again this session', async () => {
    const calls: string[] = [];
    const fetchImpl = falFetch(calls, { url: 'https://fal.run/', status: 403 }) as typeof fetch;
    const w = world({ id: 'w-refused' });
    const errors: HubSlot[] = [];
    const started = ensureHubModels('k', w, () => {}, (slot) => errors.push(slot), { ...now, fetchImpl });
    expect(started).toEqual(HUB_SLOTS);
    await vi.waitFor(() => expect(errors).toHaveLength(HUB_SLOTS.length));
    // Every picture went at once before the first refusal came back; no mesh was asked for.
    expect(calls.length).toBeLessThanOrEqual(HUB_SLOTS.length);
    expect(calls.some((c) => c.startsWith('https://queue.fal.run/'))).toBe(false);
    expect(devRequests()[0]).toMatchObject({ kind: 'fal', status: 'error', label: 'landmark' });
    expect(questTotals().falCost).toBe(0);
    expect(ensureHubModels('k', w, () => {}, () => {}, { ...now, fetchImpl })).toEqual([]);
  });

  it('makes only what the world lacks, each piece once, and hands each over as it arrives', async () => {
    const calls: string[] = [];
    const fetchImpl = falFetch(calls) as typeof fetch;
    const kept: LandmarkModel = { glb: 'g', image: 'i', prompt: 'p', costUsd: 0.023, ms: 1, at: 1 };
    const w = world({ id: 'w-twice', landmarkModel: kept, kitModels: { house: kept } });
    const got: HubSlot[] = [];
    const first = ensureHubModels('k', w, (slot) => got.push(slot), undefined, { ...now, fetchImpl });
    expect(first).toEqual(HUB_SLOTS.filter((s) => s !== 'landmark' && s !== 'house'));
    expect(ensureHubModels('k', w, () => {}, undefined, { ...now, fetchImpl })).toEqual([]);
    await vi.waitFor(() => expect(got).toHaveLength(first.length));
    // Asked again with the world as it was, before its state took the models: nothing is made twice.
    expect(ensureHubModels('k', w, () => {}, undefined, { ...now, fetchImpl })).toEqual([]);
    expect(calls.filter((c) => c.endsWith(FAL_MESH_MODEL))).toHaveLength(first.length);
    expect(questTotals().falModels).toBe(first.length);
    expect(questTotals().falCost).toBeCloseTo(0.023 * first.length);
  });

  it('describes every piece for the image model from the world’s kit, or from its bible without one', () => {
    const w = world({ kit: { house: 'a hut of whale ribs under a sailcloth roof' } });
    expect(hubModelPrompt(w, 'house')).toContain('whale ribs');
    expect(hubModelPrompt(w, 'house')).toContain('entrance facing the viewer');
    expect(hubModelPrompt(w, 'hall')).toContain(classicWorld('en').hub);
    expect(hubModelPrompt(w, 'lamp')).toContain('no thin or spindly parts');
    expect(hubModelPrompt(w, 'tree')).toContain('foliage');
    const bare = world({ look: { ...classicWorld('en').look, flora: 'none' } });
    expect(hubSlots(bare)).not.toContain('tree');
    expect(hubSlots(bare)).toContain('lamp');
  });

  it('grows the forest from the world’s tree, a young and an old one after the hub, and none where nothing grows', () => {
    const w = world({ kit: { tree: 'a black pine whose needles glow faintly at the tips.' } });
    expect(hubSlots(w).slice(-3)).toEqual(['goods', 'tree2', 'tree3']);
    expect(FOREST_SLOTS).toEqual(['tree', 'tree2', 'tree3']);
    expect(hubModelPrompt(w, 'tree2')).toContain('a black pine whose needles glow faintly at the tips, a young one of the same kind');
    expect(hubModelPrompt(w, 'tree3')).toContain('an old one of the same kind');
    expect(hubModelPrompt(w, 'tree3')).toContain('foliage');
    const bare = world({ look: { ...classicWorld('en').look, flora: 'none' } });
    expect(hubSlots(bare)).not.toContain('tree2');
    expect(hubSlots(bare)).not.toContain('tree3');
  });

  it('simplifies a piece further than the landmark', async () => {
    const bodies: string[] = [];
    const inner = falFetch([]);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith(FAL_MESH_MODEL)) bodies.push(String(init?.body));
      return inner(input);
    }) as typeof fetch;
    await generateHubModel('k', world(), 'goods', { ...now, fetchImpl });
    await generateLandmark('k', world(), { ...now, fetchImpl });
    expect(bodies.map((b) => JSON.parse(b).mesh_simplify)).toEqual([0.98, 0.95]);
    expect(devRequests().map((r) => r.label)).toEqual(['goods', 'goods', 'landmark', 'landmark']);
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
