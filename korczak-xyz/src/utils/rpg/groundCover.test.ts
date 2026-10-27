import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/sentry', () => ({ recordMeasurement: vi.fn() }));

import { devRequests, questTotals, resetDevlog, worldSpend } from './devlog';
import { classicWorld, type GroundTexture, type WorldBible } from './genesis';
import { COVER_KINDS, COVER_SIZE, coverPrompt, ensureGroundCover, hasCover } from './groundCover';

const world = (over: Partial<WorldBible> = {}): WorldBible => ({ ...classicWorld('en'), id: 'c1', createdAt: 1, ...over });
const look = (over: Partial<WorldBible['look']>) => ({ ...classicWorld('en').look, ...over });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('groundCover', () => {
  beforeEach(() => resetDevlog());

  it('paints what the world says grows, or what an older world’s look says', () => {
    const own = coverPrompt(world({ cover: 'glowing blue moss and tiny mushrooms.' }), COVER_KINDS[0]);
    expect(own).toContain('What grows here: glowing blue moss and tiny mushrooms.');
    expect(own).toContain('plain pure white background');
    const snow = coverPrompt(world({ look: look({ weather: 'snow' }) }), COVER_KINDS[1]);
    expect(snow).toContain('through snow');
    expect(snow).toContain(classicWorld('en').look.foliage);
  });

  it('paints nothing for bare ground', () => {
    expect(hasCover(world({ cover: 'none' }))).toBe(false);
    expect(hasCover(world({ look: look({ growth: 'barren' }) }))).toBe(false);
    expect(hasCover(world({ look: look({ water: 'flooded' }) }))).toBe(false);
    expect(hasCover(world({ cover: 'dry thistles' }))).toBe(true);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(ensureGroundCover('k', world({ id: 'c-bare', cover: 'None.' }), () => {}, undefined, { fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('paints each kind once, all at once, prices them as fal.ai textures, and keeps the ones that came', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).image_size).toEqual({ width: COVER_SIZE, height: COVER_SIZE });
      return ++n === 2 ? json({ detail: 'oops' }, 500) : json({ images: [{ url: `https://fal.media/cover${n}.jpg` }] });
    }) as unknown as typeof fetch;
    const got: GroundTexture[][] = [];
    const w = world({ id: 'c-once', cover: 'dry thistles' });
    expect(ensureGroundCover('k', w, (s) => got.push(s), undefined, { fetchImpl })).toBe(true);
    expect(ensureGroundCover('k', w, () => {}, undefined, { fetchImpl })).toBe(false);
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0].map((s) => s.image)).toEqual(['https://fal.media/cover1.jpg', 'https://fal.media/cover3.jpg']);
    expect(fetchImpl).toHaveBeenCalledTimes(COVER_KINDS.length);
    expect(ensureGroundCover('k', w, () => {}, undefined, { fetchImpl })).toBe(false);
    expect(devRequests().every((r) => r.kind === 'fal' && r.label === 'cover')).toBe(true);
    expect(questTotals()).toMatchObject({ falTextures: 2 });
    expect(worldSpend({ ...w, coverSprites: got[0] })).toMatchObject({ falTextures: 2, falCost: 0.006 });
  });

  it('does not ask again this session for a world whose every picture failed', async () => {
    const fetchImpl = vi.fn(async () => json({ detail: 'no balance' }, 402)) as unknown as typeof fetch;
    const errors: unknown[] = [];
    const w = world({ id: 'c-failed' });
    ensureGroundCover('k', w, () => {}, (e) => errors.push(e), { fetchImpl });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(ensureGroundCover('k', w, () => {}, undefined, { fetchImpl })).toBe(false);
  });
});
