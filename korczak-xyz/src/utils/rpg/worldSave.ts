/*
 * The worlds this browser has been given (`genesis.ts`): the one being played, per game language,
 * and a short memory of the earlier ones, which the next genesis is told to be unlike.
 *
 * A world is in one language — its names, its people's words — so each language has its own, as the
 * chronicle always had. "New world" replaces the current one and starts over: its chronicle is kept
 * under its own id (`chronicle.ts`), so an old world's deeds never leak into a new one's prompts.
 *
 * THE LIBRARY: every world ever played here, newest played first (owner, Oct 2026: "browse the
 * earlier worlds and the games in them, and load such a saved game"). A world that is no longer
 * current is not gone: its bible stays in `library`, its chronicle under its id, its atlas and its
 * quest in progress too while there is room (`LOCAL_WORLDS`); picking it again makes it current.
 *
 * In localStorage, and on the account when somebody is signed in (`cloud.ts`): every write here is
 * stamped (`sync.ts`) and the pusher sends it.
 */

import { clearChronicle, loadChronicle, writeChronicle } from './chronicle';
import { addModelSpend, classicWorld, type ForestVariant, type GroundTexture, type HubPiece, type HubSizes, type LandmarkModel, type ModelSpend, type WorldBible } from './genesis';
import { parsePlace, type PlaceSpec } from './place';
import { isDead, type Character, type Lang } from './quest';
import { clearGame, dropGameFor, loadGameFor, writeGameFor } from './save';
import { forget, saveUnit, STATE_UNIT, touch, unsafeToDrop, worldUnit } from './sync';
import { rpgSet } from './storage';

const KEY = 'rpg-worlds';
/** How many earlier worlds the next genesis is told to avoid. */
const KEEP_PAST = 8;

interface Stored {
  current?: Partial<Record<Lang, WorldBible>>;
  /** "name: pitch" of earlier worlds, newest last, every language. */
  past?: string[];
  /** Every world played here, with when it was last played. */
  library?: Record<string, LibraryEntry>;
}

export interface LibraryEntry {
  world: WorldBible;
  played: number;
  /** In the trash since then (`trashWorld`): out of the library, the menu and the lab, nothing deleted. */
  deleted?: number;
  /** Taken out of the trash then, so a clean slate swept on another device does not put it back. */
  restored?: number;
  /** A copy of the classic world's chronicle, atlas and quest, set aside by a clean slate (`trashClassic`). */
  classicOf?: Lang;
  /** Such a copy put back into the classic world then: it leaves the trash too. */
  merged?: number;
}

/** The worlds whose atlas and quest in progress this browser keeps, besides the current ones. */
export const LOCAL_WORLDS = 6;
/** The worlds the library remembers at all. */
export const LIBRARY_MAX = 60;

function valid(world: WorldBible | undefined | null): world is WorldBible {
  return Boolean(world && typeof world.id === 'string' && typeof world.name === 'string' && world.look);
}

function withLibrary(stored: Stored): Record<string, LibraryEntry> {
  const library = { ...(stored.library ?? {}) };
  // Worlds from before the library: the current ones are in it from the start.
  for (const w of Object.values(stored.current ?? {})) {
    if (valid(w) && !library[w.id]) library[w.id] = { world: w, played: w.createdAt };
  }
  return library;
}

function trimmed(library: Record<string, LibraryEntry>): Record<string, LibraryEntry> {
  // The trash goes past the limit first: a full library forgets what was thrown away, not what is played.
  const entries = Object.entries(library).sort(([, a], [, b]) => Number(Boolean(a.deleted)) - Number(Boolean(b.deleted)) || b.played - a.played);
  return Object.fromEntries(entries.slice(0, LIBRARY_MAX));
}

function read(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(stored: Stored) {
  try {
    rpgSet(KEY, JSON.stringify(stored));
  } catch {
    /* a full or blocked storage forgets the world; the game plays on */
  }
}

export function loadWorld(lang: Lang): WorldBible | null {
  const stored = read();
  const world = stored.current?.[lang];
  return valid(world) && !stored.library?.[world.id]?.deleted ? world : null;
}

/**
 * Makes `world` the one played in its language, and the most recently played in the library; the
 * one it replaces joins the past.
 */
export function saveWorld(world: WorldBible, now = Date.now()): void {
  const stored = read();
  const before = stored.current?.[world.lang];
  const past = [...(stored.past ?? [])];
  if (before && before.id !== world.id && before.createdAt > 0) {
    const line = `${before.name}: ${before.pitch}`;
    if (!past.includes(line)) past.push(line);
  }
  const library = withLibrary(stored);
  // Played again, it is out of the trash; a mark that it was restored stays (`sweepToTrash`).
  if (world.createdAt > 0) library[world.id] = { ...(library[world.id]?.restored ? { restored: library[world.id].restored } : {}), world, played: now };
  write({ ...stored, current: { ...stored.current, [world.lang]: world }, past: past.slice(-KEEP_PAST), library: trimmed(library) });
  if (world.createdAt > 0) touch(worldUnit(world.id), now);
  touch(STATE_UNIT, now);
}

/** The world with one of its hub's models in place. */
export function withModel(world: WorldBible, slot: 'landmark' | HubPiece | ForestVariant, model: LandmarkModel): WorldBible {
  return slot === 'landmark' ? { ...world, landmarkModel: model } : { ...world, kitModels: { ...world.kitModels, [slot]: model } };
}

/**
 * Keeps one of the hub's models on the world wherever this browser holds it (the library, and the
 * current world of its language), without changing which world is current or when it was played,
 * and marks the world for the account, so no other device makes it again (`landmark3d.ts`).
 */
export function setWorldModel(id: string, slot: 'landmark' | HubPiece | ForestVariant, model: LandmarkModel, now = Date.now()): void {
  putWorld(id, (w) => withModel(w, slot, model), now);
}

/** Keeps the hub's sizes on the world the same way (`generateHubSizes`), so they are asked once. */
export function setWorldSizes(id: string, sizes: HubSizes, now = Date.now()): void {
  putWorld(id, (w) => ({ ...w, sizes }), now);
}

/** Adds a model request's cost to what the world has cost (`devlog.ts`'s `worldSpend`). */
export function addWorldSpend(id: string, spent: ModelSpend, now = Date.now()): void {
  putWorld(id, (w) => ({ ...w, spent: addModelSpend(w.spent, spent) }), now);
}

/** Keeps the world's ground texture the same way (`groundTexture.ts`), so it is painted once. */
export function setWorldGround(id: string, texture: GroundTexture, now = Date.now()): void {
  putWorld(id, (w) => ({ ...w, groundTexture: texture }), now);
}

/** The hero's model the same way (`people.ts`), so it is made once. */
export function setWorldHero(id: string, model: LandmarkModel, now = Date.now()): void {
  putWorld(id, (w) => ({ ...w, heroModel: model }), now);
}

/** The hero's weapon the same way (`weapon.ts`), so it is made once. */
export function setWorldWeapon(id: string, model: LandmarkModel, now = Date.now()): void {
  putWorld(id, (w) => ({ ...w, weaponModel: model }), now);
}

/** And what grows on it (`groundCover.ts`). */
export function setWorldCover(id: string, sprites: GroundTexture[], now = Date.now()): void {
  putWorld(id, (w) => ({ ...w, coverSprites: sprites }), now);
}

function putWorld(id: string, put: (w: WorldBible) => WorldBible, now: number): void {
  const stored = read();
  const library = withLibrary(stored);
  const entry = library[id];
  if (entry) library[id] = { ...entry, world: put(entry.world) };
  const current = { ...stored.current };
  for (const [lang, w] of Object.entries(current) as [Lang, WorldBible | undefined][]) {
    if (w?.id === id) current[lang] = put(w);
  }
  write({ ...stored, current, library });
  touch(worldUnit(id), now);
}

/** Every invented world played in this browser or on the account, the most recently played first. */
export function libraryWorlds(): LibraryEntry[] {
  return Object.values(withLibrary(read()))
    .filter((e) => valid(e.world) && e.world.createdAt > 0 && !e.deleted && !e.classicOf)
    .sort((a, b) => b.played - a.played);
}

/** The world with this id, from the library or the current ones. */
export function findWorld(id: string): WorldBible | null {
  const stored = read();
  const hit = withLibrary(stored)[id]?.world ?? Object.values(stored.current ?? {}).find((w) => w?.id === id);
  return valid(hit) ? hit : null;
}

/** The world being played in each language, by id (the classic one is its language). */
export function currentIds(): Partial<Record<Lang, string>> {
  const out: Partial<Record<Lang, string>> = {};
  const stored = read();
  for (const [lang, w] of Object.entries(stored.current ?? {})) if (valid(w) && !stored.library?.[w.id]?.deleted) out[lang as Lang] = w.id;
  return out;
}

/**
 * For the account copy (`cloud.ts`): makes these the current worlds, each found in the library;
 * a world this browser does not have yet must be put there first (`writeLibraryEntry`). False when
 * one of them is not here yet, so the next pull tries again.
 */
export function writeCurrent(ids: Partial<Record<Lang, string>>, classic: (lang: Lang) => WorldBible): boolean {
  const stored = read();
  // The account's choice whole: a language it names no world for has none here either (its world
  // went to the trash on another device).
  const current: Stored['current'] = {};
  let all = true;
  for (const [lang, id] of Object.entries(ids) as [Lang, string][]) {
    const w = id === lang ? classic(lang) : findWorld(id);
    if (w && stored.library?.[id]?.deleted) continue;
    if (w) current[lang] = w;
    else {
      all = false;
      if (stored.current?.[lang]) current[lang] = stored.current[lang];
    }
  }
  write({ ...stored, current });
  return all;
}

/** For the account copy: a world's library entry, as the account has it. */
export function writeLibraryEntry(entry: LibraryEntry): void {
  if (!valid(entry.world)) return;
  const stored = read();
  const library = withLibrary(stored);
  library[entry.world.id] = entry;
  const current = { ...stored.current };
  // The current world's bible is the same object in both places; one put in the trash elsewhere is
  // no longer anyone's current world.
  if (current[entry.world.lang]?.id === entry.world.id) {
    if (entry.deleted) delete current[entry.world.lang];
    else current[entry.world.lang] = entry.world;
  }
  write({ ...stored, current, library: trimmed(library) });
}

/** A world played again: first in the library. */
export function playedWorld(id: string, now = Date.now()): void {
  const stored = read();
  const library = withLibrary(stored);
  if (!library[id]) return;
  library[id] = { ...library[id], played: now };
  write({ ...stored, library: trimmed(library) });
  touch(worldUnit(id), now);
}

/*
 * THE TRASH (owner, 1 Nov 2026: "a soft delete of worlds, they clutter my profile and the lab; a trash
 * in the menu with the deleted worlds, but not in the main menu"). A world in the trash is its library
 * entry with `deleted` set, and nothing else changes: its atlas, chronicle and quest stay where they
 * were, here and on the account, and every asset it paid for stays in the bucket. It leaves the
 * library, the main menu's Continue, the current world of its language and the model lab, and comes
 * back whole from the trash. The flag travels in the world's own unit, so the other devices hear of it.
 */

/** Whether this world is in the trash. */
export function isTrashed(id: string): boolean {
  return Boolean(read().library?.[id]?.deleted);
}

/** What is in the trash, the most recently thrown away first. */
export function trashedWorlds(): LibraryEntry[] {
  return Object.values(read().library ?? {})
    .filter((e) => valid(e.world) && e.deleted && !e.merged)
    .sort((a, b) => (b.deleted ?? 0) - (a.deleted ?? 0));
}

/** Puts a world in the trash; if it was being played, its language has no current world any more. */
export function trashWorld(id: string, now = Date.now()): void {
  const stored = read();
  const library = withLibrary(stored);
  const entry = library[id];
  if (!entry || entry.deleted) return;
  library[id] = { ...entry, deleted: now };
  const current = { ...stored.current };
  let stateChanged = false;
  for (const [lang, w] of Object.entries(current) as [Lang, WorldBible | undefined][]) {
    if (w?.id === id) {
      delete current[lang];
      stateChanged = true;
    }
  }
  write({ ...stored, current, library: trimmed(library) });
  touch(worldUnit(id), now);
  if (stateChanged) touch(STATE_UNIT, now);
}

/**
 * Takes a world out of the trash, back into the library as it was. A copy of the classic world goes
 * back into the classic world instead: its quests join the chronicle, its people the atlas, and its
 * quest in progress returns if the classic world has none.
 */
export function restoreWorld(id: string, now = Date.now()): void {
  const stored = read();
  const library = withLibrary(stored);
  const entry = library[id];
  if (!entry?.deleted) return;
  if (entry.classicOf) {
    const lang = entry.classicOf;
    const quests = [...loadChronicle(lang), ...loadChronicle(id)].sort((a, b) => a.at - b.at);
    writeChronicle(lang, quests.filter((q, i) => quests.findIndex((o) => o.at === q.at && o.title === q.title) === i));
    const atlas = rawAtlas(id);
    if (atlas) addToAtlas(lang, cleanAtlas(atlas));
    const game = loadGameFor(id);
    if (game && !loadGameFor(lang)) {
      writeGameFor(lang, { ...game, worldId: lang });
      touch(saveUnit(lang), now);
    }
    library[id] = { ...entry, merged: now };
  } else {
    const { deleted: _gone, ...rest } = entry;
    library[id] = { ...rest, restored: now };
  }
  write({ ...read(), library: trimmed(library) });
  touch(worldUnit(id), now);
  touch(worldUnit(entry.classicOf ?? id), now);
}

/**
 * Sets the classic world's memory aside (the willowlands of each language, which has no library
 * entry to flag): its chronicle, atlas and quest in progress move to a copy in the trash under an id
 * of its own, and the classic world starts empty. Nothing is lost; `restoreWorld` puts it back. Null
 * when there was nothing to set aside.
 */
export function trashClassic(lang: Lang, now = Date.now()): string | null {
  const chronicle = loadChronicle(lang);
  const atlas = rawAtlas(lang);
  const game = loadGameFor(lang);
  const people = (atlas?.people?.length ?? 0) + (atlas?.places?.length ?? 0);
  if (!chronicle.length && !people && !game) return null;
  const id = `${lang}-old-${now.toString(36)}`;
  const stored = read();
  const library = withLibrary(stored);
  library[id] = { world: { ...classicWorld(lang), id, createdAt: now }, played: now, deleted: now, classicOf: lang };
  write({ ...stored, library: trimmed(library) });
  writeChronicle(id, chronicle);
  if (atlas) writeAtlas(id, atlas);
  if (game) {
    writeGameFor(id, { ...game, worldId: id });
    touch(saveUnit(id), now);
    clearGame(lang);
  }
  clearChronicle(lang);
  // An empty atlas rather than none: the push leaves a missing one as the account has it.
  const all = readAtlases();
  all[lang] = { places: [], people: [], dead: [] };
  writeAtlases(all);
  touch(worldUnit(id), now);
  touch(worldUnit(lang), now);
  return id;
}

/**
 * A clean slate: every world played before `before` goes to the trash, and the classic world's
 * memory is set aside, so the menu starts from nothing. A world already taken out of the trash once
 * is left alone, so a sweep that reaches a second device late does not throw it away again.
 */
export function sweepToTrash(before: number, now = Date.now()): number {
  let n = 0;
  for (const e of Object.values(withLibrary(read()))) {
    if (e.deleted || e.restored || e.classicOf || !valid(e.world) || e.world.createdAt <= 0 || e.played > before) continue;
    trashWorld(e.world.id, now);
    n += 1;
  }
  for (const lang of ['pl', 'en'] as const) if (trashClassic(lang, now)) n += 1;
  // The classic world as the current one goes too: the menu then offers a new world.
  const stored = read();
  if (Object.values(stored.current ?? {}).some((w) => w && w.createdAt === 0)) {
    const current = Object.fromEntries(Object.entries(stored.current ?? {}).filter(([, w]) => w && w.createdAt > 0));
    write({ ...stored, current });
    touch(STATE_UNIT, now);
  }
  return n;
}

/** Every world with an atlas here. */
export function atlasIds(): string[] {
  return Object.keys(readAtlases());
}

export function libraryEntry(id: string): LibraryEntry | null {
  return withLibrary(read())[id] ?? null;
}

/** The worlds to be unlike, the current ones included. */
export function pastWorlds(): string[] {
  const stored = read();
  const current = Object.values(stored.current ?? {})
    .filter((w): w is WorldBible => Boolean(w && w.createdAt > 0))
    .map((w) => `${w.name}: ${w.pitch}`);
  return [...(stored.past ?? []), ...current].slice(-KEEP_PAST);
}

/*
 * THE ATLAS: what a world has built so far (owner, Oct 2026: "after the first quest the characters
 * and locations stay, only someone new appears with a quest; we can walk the old places a bit, but
 * mostly new ones, in new places"). Every place a quest built and every person met, with the last
 * thing they said, per world, in `rpg-atlas`. A new quest in the same world starts with all of it
 * standing, and its prompt knows it all by name. A new world starts with an empty one; the old
 * world's atlas is dropped with it, since its places mean nothing anywhere else.
 */

const ATLAS_KEY = 'rpg-atlas';
/** As many places as the three rings hold apart (`freeSlot`), and a crowd that still fits a prompt. */
export const ATLAS_PLACES = 16;
export const ATLAS_PEOPLE = 24;

export interface AtlasPerson {
  character: Character;
  /** The place they stand at, by name, or null for the hub. */
  at: string | null;
  /** What they say when talked to again. */
  line: string;
}

export interface Atlas {
  places: PlaceSpec[];
  people: AtlasPerson[];
  /** Everyone dead in this world, by name (`BeatContext.dead`); absent in atlases from before it. */
  dead?: string[];
}

/** As many of the dead as a prompt is told about. */
export const ATLAS_DEAD = 40;

function readAtlases(): Record<string, Atlas> {
  try {
    const parsed = JSON.parse(localStorage.getItem(ATLAS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadAtlas(worldId: string): Atlas {
  return cleanAtlas(readAtlases()[worldId]);
}

/** This browser's atlas of a world as stored, or null, for the account copy. */
export function rawAtlas(worldId: string): Atlas | null {
  return readAtlases()[worldId] ?? null;
}

function cleanAtlas(atlas: Atlas | undefined): Atlas {
  return {
    // Through the parser again: what is stored is the browser's to edit, and an older game's to have
    // written in an older shape.
    places: Array.isArray(atlas?.places)
      ? atlas.places.map((p) => parsePlace(p)).filter((p): p is PlaceSpec => p !== null)
      : [],
    people: Array.isArray(atlas?.people) ? atlas.people.filter((p) => p?.character && typeof p.character.name === 'string') : [],
    dead: Array.isArray(atlas?.dead) ? atlas.dead.filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [],
  };
}

/**
 * Adds what a quest has built to its world's atlas: a place or a person already in it is replaced
 * (a person moves, says something newer) and moves to the end; the oldest go past the limits.
 */
export function addToAtlas(worldId: string, add: Atlas): Atlas {
  const all = readAtlases();
  const before = all[worldId] ?? { places: [], people: [] };
  const places = [...(before.places ?? []).filter((p) => !add.places.some((q) => q.name === p.name)), ...add.places].slice(-ATLAS_PLACES);
  const dead = [...(before.dead ?? []).filter((n) => !(add.dead ?? []).includes(n)), ...(add.dead ?? [])].slice(-ATLAS_DEAD);
  // The dead stand nowhere: they leave the atlas's crowd and stay only on its list.
  const people = [
    ...(before.people ?? []).filter((p) => !add.people.some((q) => q.character.name === p.character.name)),
    ...add.people,
  ]
    .filter((p) => typeof p?.character?.name !== 'string' || !isDead(p.character.name, dead))
    .slice(-ATLAS_PEOPLE);
  const atlas = { places, people, dead };
  all[worldId] = atlas;
  writeAtlases(evict(all, worldId));
  touch(worldUnit(worldId));
  return atlas;
}

/**
 * A place already in the atlas, changed where it stands (a fal.ai piece made for it): it keeps its
 * turn in the order. A place not in it yet is left for `addToAtlas` at the quest's end.
 */
export function updateAtlasPlace(worldId: string, place: PlaceSpec): void {
  const all = readAtlases();
  const atlas = all[worldId];
  if (!atlas?.places?.some((p) => p.name === place.name)) return;
  all[worldId] = { ...atlas, places: atlas.places.map((p) => (p.name === place.name ? place : p)) };
  writeAtlases(evict(all, worldId));
  touch(worldUnit(worldId));
}

/** A person already in the atlas, changed (their model made): they keep their turn in the order. */
export function updateAtlasPerson(worldId: string, character: Character): void {
  const all = readAtlases();
  const atlas = all[worldId];
  if (!atlas?.people?.some((p) => p.character.name === character.name)) return;
  all[worldId] = { ...atlas, people: atlas.people.map((p) => (p.character.name === character.name ? { ...p, character } : p)) };
  writeAtlases(evict(all, worldId));
  touch(worldUnit(worldId));
}

/** For the account copy: a world's atlas as the account has it. */
export function writeAtlas(worldId: string, atlas: Atlas | null): void {
  const all = readAtlases();
  if (atlas) all[worldId] = atlas;
  else delete all[worldId];
  writeAtlases(evict(all, worldId));
}

function writeAtlases(all: Record<string, Atlas>) {
  try {
    rpgSet(ATLAS_KEY, JSON.stringify(all));
  } catch {
    /* a full storage forgets the atlas; the world just grows less */
  }
}

/**
 * Only so many worlds keep their atlas and their quest in progress here: the classic ones, each
 * language's current one, the `LOCAL_WORLDS` played most recently, and any whose latest change the
 * account has not got yet. The rest are dropped from this browser and their stamps forgotten, so
 * picking such a world from the library takes the account's copy back (`cloud.ts`).
 */
function evict(all: Record<string, Atlas>, keep?: string): Record<string, Atlas> {
  const recent = libraryWorlds()
    .slice(0, LOCAL_WORLDS)
    .map((e) => e.world.id);
  const live = new Set<string>(['pl', 'en', ...Object.values(currentIds()), ...recent, ...(keep ? [keep] : [])]);
  const kept: Record<string, Atlas> = {};
  for (const [id, atlas] of Object.entries(all)) {
    if (live.has(id) || unsafeToDrop(worldUnit(id)) || unsafeToDrop(saveUnit(id))) kept[id] = atlas;
    else {
      dropGameFor(id);
      forget(worldUnit(id));
      forget(saveUnit(id));
    }
  }
  return kept;
}

/*
 * A GENESIS IN FLIGHT, so a page the phone threw away while it ran does not lose it (owner, Oct
 * 2026: "on the phone I tap new world, the app goes to the background, and when I come back there
 * is no world and I have to start again"). iOS reloads a backgrounded page, an installed app above
 * all, and the answer in flight goes with it. What survives is what it was asked with — the seeds
 * and the slider — so the intro offers to finish that same world rather than roll new dice.
 */

const PENDING_KEY = 'rpg-genesis';
/** Older than this, the reader has moved on and the intro offers nothing. */
const PENDING_MS = 30 * 60 * 1000;

export interface PendingGenesis {
  lang: Lang;
  seeds: string[];
  exotic: number;
  /** The seeds are the player's own words (`GenesisContext.chosen`). */
  chosen?: boolean;
  /** The player's description of the world (`GenesisContext.wish`). */
  wish?: string;
  /** The coin and the worlds to be unlike, as asked: the same prompt finds the server's job again (`jobs.ts`). */
  nth?: 1 | 2;
  avoid?: string[];
  at: number;
}

export function savePendingGenesis(pending: PendingGenesis): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* without storage a reload loses it, as before */
  }
}

export function loadPendingGenesis(lang: Lang, now = Date.now()): PendingGenesis | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null');
    const wish = typeof p?.wish === 'string' && p.wish.trim() ? p.wish : undefined;
    if (!p || p.lang !== lang || !Array.isArray(p.seeds) || (p.seeds.length === 0 && !wish)) return null;
    if (typeof p.at !== 'number' || now - p.at > PENDING_MS) return null;
    return {
      lang,
      seeds: p.seeds.filter((s: unknown) => typeof s === 'string').slice(0, 6),
      exotic: Number(p.exotic) || 0,
      chosen: p.chosen === true,
      wish,
      ...(p.nth === 1 || p.nth === 2 ? { nth: p.nth } : {}),
      ...(Array.isArray(p.avoid) ? { avoid: p.avoid.filter((a: unknown) => typeof a === 'string') } : {}),
      at: p.at,
    };
  } catch {
    return null;
  }
}

export function clearPendingGenesis(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}
