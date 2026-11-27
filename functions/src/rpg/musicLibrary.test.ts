import { beforeEach, describe, expect, it, vi } from 'vitest';

const docs = new Map<string, Record<string, unknown>>();
const admins = new Set<string>();

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }) } }));
vi.mock('../runtime', () => ({
  db: {
    collection: (c: string) => ({
      get: async () => ({
        docs: [...docs.entries()].filter(([p]) => p.startsWith(`${c}/`)).map(([p, d]) => ({ id: p.slice(c.length + 1), data: () => d })),
      }),
    }),
    doc: (path: string) => ({
      get: async () => ({ data: () => docs.get(path) }),
      set: async (d: Record<string, unknown>) => void docs.set(path, d),
      update: async (d: Record<string, unknown>) => void docs.set(path, { ...docs.get(path), ...d }),
    }),
  },
}));
vi.mock('../sentry', () => ({ reportError: vi.fn() }));
vi.mock('./admin', () => ({ readServerKeys: async () => ({ google: 'server-key' }), isAdminUid: async (uid: string) => admins.has(uid) }));
vi.mock('./dailyCap', () => ({ takeDaily: async () => true }));

import { addToLibrary, findMusic, forgetMusicLibrary } from './musicLibrary';

/** A 768-long vector pointing mostly along axis `i`, a little along `j`. */
function vec(i: number, j = i, lean = 0): number[] {
  const v = new Array(768).fill(0);
  v[i] = 1;
  v[j] += lean;
  return v;
}

/** The embedding a text gets: chosen by its first word, so a test says what is near what. */
const VECTORS: Record<string, number[]> = { folk: vec(0), marsh: vec(0, 1, 0.3), synth: vec(5) };
vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
  const text = (JSON.parse(init.body) as { content: { parts: { text: string }[] } }).content.parts[0].text;
  return new Response(JSON.stringify({ embedding: { values: VECTORS[text.split(/\W/)[0]] ?? vec(9) } }));
});

const RULES = 'Instrumental only, no vocals, no choir singing words. Background score for exploring an open-world RPG: steady and unobtrusive, sitting under spoken dialogue, no big drops, no sudden stops, no fade-out. A seamless loop that ends the way it begins.';

describe('the score library', () => {
  beforeEach(() => {
    docs.clear();
    admins.clear();
    forgetMusicLibrary();
  });

  it('adds what diesel composed and gives it to its world, but not a reader’s own key', async () => {
    await addToLibrary('u1', 'diesel', { assetId: 'a1', url: 'https://bucket/a1.mp3', prompt: `folk drones. ${RULES}`, ms: 90_000, model: 'music_v2_5', world: 'w1' });
    await addToLibrary('u2', 'account', { assetId: 'a2', url: 'https://bucket/a2.mp3', prompt: `synth pads. ${RULES}`, ms: 90_000, model: 'music_v2_5', world: 'w2' });
    expect(docs.get('rpgMusicLibrary/a1')).toMatchObject({ prompt: 'folk drones.', url: 'https://bucket/a1.mp3', uses: 1 });
    expect(docs.has('rpgMusicLibrary/a2')).toBe(false);
    expect(docs.get('rpgMusicWorlds/u1_w1')).toMatchObject({ track: 'a1' });
    admins.add('u2');
    await addToLibrary('u2', 'account', { assetId: 'a2', url: 'https://bucket/a2.mp3', prompt: `synth pads. ${RULES}`, ms: 90_000, model: 'music_v2_5', world: 'w2' });
    expect(docs.has('rpgMusicLibrary/a2')).toBe(true);
  });

  it('takes a library track over the threshold, gives it to the world, and composes under it', async () => {
    await addToLibrary('u1', 'diesel', { assetId: 'a1', url: 'https://bucket/a1.mp3', prompt: 'folk drones.', ms: 90_000, model: 'music_v2_5', world: 'w1' });
    forgetMusicLibrary();
    // cos(folk, marsh) = 1 / sqrt(1.09) ≈ 0.958, over 0.88.
    const near = await findMusic('u9', `marsh fiddles. ${RULES}`, 'w9');
    expect(near.hit).toMatchObject({ id: 'a1', assigned: false });
    expect(near.hit!.score).toBeGreaterThan(0.95);
    expect(docs.get('rpgMusicWorlds/u9_w9')).toMatchObject({ track: 'a1' });
    expect(docs.get('rpgMusicLibrary/a1')).toMatchObject({ uses: { __inc: 1 } });
    // The world keeps it without another comparison.
    expect((await findMusic('u9', 'anything at all', 'w9')).hit).toMatchObject({ id: 'a1', assigned: true });
    // Orthogonal: a miss, with the closest score said.
    const far = await findMusic('u9', `synth pads. ${RULES}`, 'w10');
    expect(far.hit).toBeNull();
    expect(far.best).toBeCloseTo(0);
    expect(docs.has('rpgMusicWorlds/u9_w10')).toBe(false);
  });

  it('reads the threshold from the config', async () => {
    await addToLibrary('u1', 'diesel', { assetId: 'a1', url: 'https://bucket/a1.mp3', prompt: 'folk drones.', ms: 90_000, model: 'music_v2_5', world: null });
    docs.set('rpgMusic/config', { threshold: 0.97 });
    forgetMusicLibrary();
    const answer = await findMusic('u9', 'marsh fiddles.', null);
    expect(answer.threshold).toBe(0.97);
    expect(answer.hit).toBeNull();
  });

  it('answers an empty library with a miss and asks nothing', async () => {
    expect(await findMusic('u9', 'folk drones.', 'w1')).toEqual({ hit: null, best: null, threshold: 0.88, size: 0 });
  });
});
