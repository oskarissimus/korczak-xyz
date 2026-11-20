/*
 * Two browsers on one account (owner, Oct 2026: "games on the phone and the computer don't sync").
 * Each device is its own localStorage; the account is a map of documents behind a fake Firestore.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => new Map<string, Record<string, unknown>>());
/** Paths whose reads the fake Firestore refuses, as rules would. */
const denied = vi.hoisted(() => new Set<string>());

vi.mock('firebase/firestore', () => {
  const key = (path: string[]) => path.join('/');
  return {
    collection: (_db: unknown, ...path: string[]) => ({ path }),
    doc: (parent: { path: string[] } | unknown, ...path: string[]) =>
      parent && typeof parent === 'object' && 'path' in (parent as object) ? { path: [...(parent as { path: string[] }).path, ...path] } : { path },
    getDoc: async (ref: { path: string[] }) => {
      if (denied.has(key(ref.path))) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
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
vi.mock('../../lib/firestoreHealth', () => ({ runCloud: (_l: string, run: () => Promise<unknown>) => run(), isRecoverableClientError: () => false }));
vi.mock('../../lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  describeError: (e: unknown) => ({ error: String(e) }),
}));

import { addToChronicle, loadChronicle } from './chronicle';
import { cleanSlate, questsInProgress, saveData, SAVE_MAX, startSync, syncNow } from './cloud';
import { profile, setProfile } from './profile';
import { CLASSIC_LOOK, type WorldBible } from './genesis';
import { clearGame, loadGame, loadGameFor, saveGame, type SavedGame } from './save';
import { addToAtlas, isTrashed, libraryWorlds, loadAtlas, loadWorld, restoreWorld, saveWorld, trashedWorlds, trashWorld } from './worldSave';

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
  denied.clear();
  devices.phone.clear();
  devices.desk.clear();
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
  // Every device here is signed in to the one account, as the game sets it (`profile.ts`).
  on('phone');
  setProfile('u');
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

describe('the trash', () => {
  it('hides a world from the library, the menu and Continue on every device, and restores it whole', async () => {
    on('phone');
    saveWorld(world('w1', 'Solniska'));
    addToAtlas('w1', { places: [place], people: [] });
    saveGame(game('w1', 'Drugi'));
    await syncNow('u');
    on('desk');
    await syncNow('u');
    expect(loadWorld('pl')?.id).toBe('w1');

    trashWorld('w1');
    expect(libraryWorlds()).toEqual([]);
    expect(loadWorld('pl')).toBeNull();
    expect(loadGame(isTrashed)).toBeNull();
    // Nothing deleted: the quest and the atlas are still here.
    expect(loadGameFor('w1')?.beats[0].title).toBe('Drugi');
    expect(loadAtlas('w1').places).toHaveLength(1);
    await syncNow('u');

    on('phone');
    await syncNow('u');
    expect(libraryWorlds()).toEqual([]);
    expect(loadWorld('pl')).toBeNull();
    expect(trashedWorlds().map((e) => e.world.name)).toEqual(['Solniska']);

    restoreWorld('w1');
    expect(libraryWorlds().map((e) => e.world.name)).toEqual(['Solniska']);
    expect(loadGame(isTrashed)?.beats[0].title).toBe('Drugi');
    await syncNow('u');
    on('desk');
    await syncNow('u');
    expect(libraryWorlds().map((e) => e.world.name)).toEqual(['Solniska']);
    expect(trashedWorlds()).toEqual([]);
  });

  it('a clean slate sweeps every device once, sets the classic history aside, and leaves a restored world alone', async () => {
    on('phone');
    saveWorld(world('w1', 'Solniska'));
    saveWorld(world('w2', 'Mgły'));
    addToChronicle('pl', { title: 'Grzechy Ojców', at: clock, steps: [], ending: 'koniec' });
    addToAtlas('pl', { places: [], people: [{ character: { name: 'Sołtys', gender: 'male', color: '#000' } as never, at: null, line: '' }] });
    await syncNow('u');
    on('desk');
    await syncNow('u');

    on('phone');
    await cleanSlate('u');
    expect(libraryWorlds()).toEqual([]);
    expect(loadWorld('pl')).toBeNull();
    expect(loadChronicle('pl')).toEqual([]);
    expect(loadAtlas('pl').people).toEqual([]);
    const classic = trashedWorlds().find((e) => e.classicOf === 'pl')!;
    expect(loadChronicle(classic.world.id).map((c) => c.title)).toEqual(['Grzechy Ojców']);
    restoreWorld('w2');
    await syncNow('u');

    on('desk');
    await syncNow('u');
    // The desk heard of the sweep and of the restore, and does not throw w2 away again.
    expect(libraryWorlds().map((e) => e.world.id)).toEqual(['w2']);
    expect(isTrashed('w1')).toBe(true);
    expect(loadChronicle('pl')).toEqual([]);

    // The classic history goes back into the classic world.
    on('phone');
    restoreWorld(classic.world.id);
    expect(loadChronicle('pl').map((c) => c.title)).toEqual(['Grzechy Ojców']);
    expect(loadAtlas('pl').people.map((p) => p.character.name)).toEqual(['Sołtys']);
    expect(trashedWorlds().some((e) => e.classicOf)).toBe(false);
  });

  it('a clean slate that cannot be read does not stop the rest of the pull', async () => {
    on('phone');
    saveWorld(world('w1', 'Solniska'));
    await syncNow('u');
    on('desk');
    denied.add('users/u/rpgState/cleanSlate');
    await syncNow('u');
    expect(loadWorld('pl')?.name).toBe('Solniska');
  });
});

describe('the guest and the account', () => {
  it("keeps the guest's worlds and the account's apart in one browser", async () => {
    on('phone');
    setProfile(null);
    saveWorld(world('wg', 'Gościniec'));
    setProfile('u');
    expect(libraryWorlds()).toEqual([]);
    saveWorld(world('wa', 'Kontowo'));
    await syncNow('u');
    expect(libraryWorlds().map((e) => e.world.name)).toEqual(['Kontowo']);
    // Nothing of the guest's went up to the account.
    expect(server.has('users/u/rpgWorlds/wg')).toBe(false);
    setProfile(null);
    expect(libraryWorlds().map((e) => e.world.name)).toEqual(['Gościniec']);
  });

  it("takes the account's worlds out of a guest store the old shared one left them in, and nothing else", async () => {
    // Before the split: one store, signed in, synced both ways.
    on('phone');
    saveWorld(world('w1', 'Solniska'));
    addToChronicle('w1', { title: 'Pierwszy', at: clock, steps: [], ending: 'koniec' });
    saveGame(game('w1', 'Drugi'));
    saveWorld(world('w3', 'Wspólny'));
    await syncNow('u');
    sharedStore(devices.phone);
    // Signed out, the old code left all of it, and the guest played a world of their own and went on
    // in one of the account's.
    setProfile(null);
    saveWorld(world('w2', 'Gościniec'));
    saveGame(game('w3', 'Po wylogowaniu'));
    expect(libraryWorlds().map((e) => e.world.id).sort()).toEqual(['w1', 'w2', 'w3']);

    setProfile('u');
    await syncNow('u');
    expect(libraryWorlds().map((e) => e.world.id).sort()).toEqual(['w1', 'w3']);
    expect(questsInProgress().w1?.title).toBe('Drugi');
    expect(server.has('users/u/rpgWorlds/w2')).toBe(false);

    setProfile(null);
    // w1 is on the account exactly as the guest had it: gone from here. w2 never reached it, and
    // w3's quest changed after, so w3 stays whole: the guest's.
    expect(libraryWorlds().map((e) => e.world.id).sort()).toEqual(['w2', 'w3']);
    expect(loadChronicle('w1')).toEqual([]);
    expect(loadGameFor('w1')).toBeNull();
    expect(loadGameFor('w3')?.beats[0].title).toBe('Po wylogowaniu');
    setProfile('u');
  });

  it('writes nothing of the account into the guest store when signed out mid-pull', async () => {
    on('desk');
    saveWorld(world('w1', 'Solniska'));
    await syncNow('u');
    devices.desk.clear();
    const pulling = syncNow('u');
    setProfile(null);
    await pulling;
    expect(libraryWorlds()).toEqual([]);
    setProfile('u');
  });

  it("sends the account what it was owed at sign-out, and nothing of the guest's after", async () => {
    on('phone');
    (globalThis as { document?: unknown }).document = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
    const stop = startSync('u', () => {});
    await new Promise((r) => setTimeout(r, 0));
    saveWorld(world('w1', 'Solniska'));
    stop();
    setProfile(null);
    saveWorld(world('wg', 'Gościniec'));
    await new Promise((r) => setTimeout(r, 0));
    expect(server.has('users/u/rpgWorlds/w1')).toBe(true);
    expect(server.has('users/u/rpgWorlds/wg')).toBe(false);
    // The guest store got no stamp of the account's push.
    expect(JSON.parse(devices.phone.get('rpg-sync') ?? '{}')['world:w1']).toBeUndefined();
    expect(JSON.parse(devices.phone.get('rpg-sync@u') ?? '{}')['world:w1'].pushed).toBeGreaterThan(0);
    expect(profile()).toBeNull();
    setProfile('u');
  });
});

/** The store as it was before the split: the account's keys were the bare ones every guest read. */
function sharedStore(store: Map<string, string>) {
  for (const [k, v] of [...store.entries()]) {
    if (!k.endsWith('@u')) continue;
    store.set(k.slice(0, -2), v);
    store.delete(k);
  }
}
