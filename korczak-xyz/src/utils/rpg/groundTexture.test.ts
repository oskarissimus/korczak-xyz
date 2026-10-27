import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/sentry', () => ({ recordMeasurement: vi.fn() }));

import { devRequests, questTotals, resetDevlog } from './devlog';
import { classicWorld, type GroundTexture, type WorldBible } from './genesis';
import { ensureGroundTexture, GROUND_SIZE, groundPrompt } from './groundTexture';
import { FAL_IMAGE_MODEL, imageCost } from './landmark3d';

const world = (over: Partial<WorldBible> = {}): WorldBible => ({ ...classicWorld('en'), id: 'g1', createdAt: 1, ...over });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('groundTexture', () => {
  beforeEach(() => resetDevlog());

  it('paints the world’s own terrain, or what an older world’s look says lies on it', () => {
    expect(groundPrompt(world({ terrain: 'cracked red clay with pebbles.' }))).toContain(
      'seen from directly above: cracked red clay with pebbles.',
    );
    const snow = groundPrompt(world({ look: { ...classicWorld('en').look, weather: 'snow' } }));
    expect(snow).toContain('fresh snow');
    expect(snow).toContain(classicWorld('en').look.ground);
    const barren = groundPrompt(world({ look: { ...classicWorld('en').look, growth: 'barren' } }));
    expect(barren).toContain('bare dry earth');
  });

  it('costs one megapixel at the largest size that still is one', () => {
    expect(GROUND_SIZE % 16).toBe(0);
    expect(imageCost(GROUND_SIZE, GROUND_SIZE)).toBe(0.003);
  });

  it('paints once, prices it in the console as fal.ai, and does not ask again', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`https://fal.run/${FAL_IMAGE_MODEL}`);
      bodies.push(String(init?.body));
      return json({ images: [{ url: 'https://fal.media/ground.jpg' }] });
    }) as unknown as typeof fetch;
    const got: GroundTexture[] = [];
    const w = world({ id: 'g-once', terrain: 'wet black mud' });
    expect(ensureGroundTexture('k', w, (t) => got.push(t), undefined, { fetchImpl })).toBe(true);
    expect(ensureGroundTexture('k', w, () => {}, undefined, { fetchImpl })).toBe(false);
    await vi.waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]).toMatchObject({ image: 'https://fal.media/ground.jpg', costUsd: 0.003 });
    expect(JSON.parse(bodies[0]).image_size).toEqual({ width: GROUND_SIZE, height: GROUND_SIZE });
    expect(ensureGroundTexture('k', w, () => {}, undefined, { fetchImpl })).toBe(false);
    expect(ensureGroundTexture('k', world({ id: 'g-kept', groundTexture: got[0] }), () => {}, undefined, { fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(devRequests()[0]).toMatchObject({ kind: 'fal', label: 'ground', status: 'ok' });
    expect(questTotals()).toMatchObject({ falCost: 0.003, falTextures: 1, falModels: 0 });
  });

  it('does not ask again this session for a world whose painting failed', async () => {
    const fetchImpl = vi.fn(async () => json({ detail: 'no balance' }, 402)) as unknown as typeof fetch;
    const errors: unknown[] = [];
    const w = world({ id: 'g-failed' });
    ensureGroundTexture('k', w, () => {}, (e) => errors.push(e), { fetchImpl });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(ensureGroundTexture('k', w, () => {}, undefined, { fetchImpl })).toBe(false);
    expect(questTotals().falCost).toBe(0);
  });
});
