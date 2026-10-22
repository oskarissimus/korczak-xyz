/*
 * Two browsers on one account (owner, Oct 2026: "games on the phone and the computer don't sync").
 * Each device is its own localStorage; the account is a map of documents behind a fake Firestore.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('firebase/firestore', () => {
  const key = (path: string[]) => path.join('/');
  return {
    collection: (_db: unknown, ...path: string[]) => ({ path }),
    doc: (parent: { path: string[] } | unknown, ...path: string[]) =>
      parent && typeof parent === 'object' && 'path' in (parent as object) ? { path: [...(parent as { path: string[] }).path, ...path] } : { path },
    getDoc: async (ref: { path: string[] }) => {
      const data = server.get(key(ref.path));
      return { exists: () => data !== undefined, data: () => data };
    },
    getDocs: async (ref: { path: string[] }) => {
      const prefix = `${key(ref.path)}/`;
      const docs = [...server.entries()]
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(([k, data]) => ({ id: k.slice(prefix.length), data: () => data }));
      return { docs };
    },
    setDoc: async (ref: { path: string[] }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
      const k = key(ref.path);
      server.set(k, opts?.merge ? { ...(server.get(k) ?? {}), ...data } : { ...data });
    },
  };
});
vi.mock('../../lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('../../lib/firestoreHealth', () => ({ runCloud: (_l: string, run: () => Promise<unknown>) => run() }));
vi.mock('../../lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  describeError: (e: unknown) => ({ error: String(e) }),
}));

import { addToChronicle, loadChronicle } from './chronicle';
import { questsInProgress, saveData, SAVE_MAX, syncNow } from './cloud';
import { CLASSIC_LOOK, type WorldBible } from './genesis';
import { clearGame, loadGame, loadGameFor, saveGame, type SavedGame } from './save';
import { addToAtlas, libraryWorlds, loadAtlas, loadWorld, saveWorld } from './worldSave';

const devices = { phone: new Map<string, string>(), desk: new Map<string, string>() };
function on(device: keyof typeof devices) {
  const store = devices[device];
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

let clock = 1_000_000;
beforeEach(() => {
  server.clear();
  devices.phone.clear();
  devices.desk.clear();
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
});

const world = (id: string, name: string, lang: 'pl' | 'en' = 'pl'): WorldBible => ({
  id,
  lang,
  createdAt: clock,
  seeds: [],
  typicality: 50,
  name,
  pitch: `${name} pitch`,
  tone: '',
  tech: '',
  climate: '',
  people: '',
  architecture: '',
  threats: '',
  player: 'a wanderer',
  address: 'wędrowcze',
  hub: 'Hub',
  words: [],
  look: CLASSIC_LOOK,
});

const game = (worldId: string, title: string): Omit<SavedGame, 'version' | 'at'> => ({
  lang: 'pl',
  seed: 's',
  static: false,
  beats: [{ title } as SavedGame['beats'][number]],
  progress: 0,
  history: [],
  lastLines: [['Wita', 'hej']],
  seen: [],
  heard: false,
  decision: null,
  worldId,
});

const place = { name: 'Mill', direction: 'north', distance: 'far', biome: 'meadow', features: [], groundColor: '#7c9a48' } as never;

describe('the account copy', () => {
  it("brings the phone's world, atlas, chronicle and quest to the desk, and the desk's next step back", async () => {
    // The desk played an older world before; the phone played since.
    on('desk');
    saveWorld(world('w0', 'Stary świat'));
    on('phone');
    saveWorld(world('w1', 'Solniska'));
    addToAtlas('w1', { places: [place], people: [] });
    addToChronicle('w1', { title: 'Pierwszy', at: clock, steps: [], ending: 'koniec' });
    saveGame(game('w1', 'Drugi'));
    await syncNow('u');

    on('desk');
    await syncNow('u');
    expect(loadWorld('pl')?.name).toBe('Solniska');
    expect(loadAtlas('w1').places.map((p) => p.name)).toEqual(['Mill']);
    expect(loadChronicle('w1').map((c) => c.title)).toEqual(['Pierwszy']);
    expect(loadGame()?.beats[0].title).toBe('Drugi');
    // The desk's own world is not lost: it is in the library.
    expect(libraryWorlds().map((e) => e.world.name)).toEqual(['Solniska', 'Stary świat']);

    saveGame(game('w1', 'Trzeci'));
    await syncNow('u');
    on('phone');
    await syncNow('u');
    expect(loadGameFor('w1')?.beats[0].title).toBe('Trzeci');
    expect(libraryWorlds().map((e) => e.world.name)).toContain('Stary świat');
  });

  it('carries the end of a quest, so the other device does not offer it again', async () => {
    on('phone');
    saveWorld(world('w1', 'Solniska'));
    saveGame(game('w1', 'Drugi'));
    await syncNow('u');
    on('desk');
    await syncNow('u');
    expect(loadGameFor('w1')).not.toBeNull();
    clearGame('w1');
    await syncNow('u');
    on('phone');
    await syncNow('u');
    expect(loadGameFor('w1')).toBeNull();
    expect(questsInProgress().w1).toBeUndefined();
  });

  it('keeps each world its own quest, and an old single save moves into the map', () => {
    on('phone');
    devices.phone.set('rpg-save', JSON.stringify({ ...game('w9', 'Dawny'), version: 1, at: 5 }));
    saveGame(game('w1', 'Nowy'));
    expect(loadGameFor('w9')?.beats[0].title).toBe('Dawny');
    expect(loadGameFor('w1')?.beats[0].title).toBe('Nowy');
    expect(devices.phone.has('rpg-save')).toBe(false);
  });

  it('a save too big for one document loses its transcript first', () => {
    const big = { ...game('w1', 'x'), version: 1, at: 1, transcript: [{ who: 'a', text: 'y'.repeat(SAVE_MAX) }] } as unknown as SavedGame;
    const data = saveData(big)!;
    expect(data.length).toBeLessThan(SAVE_MAX);
    expect(JSON.parse(data).transcript).toEqual([]);
  });
});
