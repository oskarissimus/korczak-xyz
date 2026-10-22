/*
 * The worlds this browser has been given (`genesis.ts`): the one being played, per game language,
 * and a short memory of the earlier ones, which the next genesis is told to be unlike.
 *
 * A world is in one language — its names, its people's words — so each language has its own, as the
 * chronicle always had. "New world" replaces the current one and starts over: its chronicle is kept
 * under its own id (`chronicle.ts`), so an old world's deeds never leak into a new one's prompts.
 *
 * In localStorage like the chronicle and the autosave; not on the account yet.
 */

import type { WorldBible } from './genesis';
import { parsePlace, type PlaceSpec } from './place';
import type { Character, Lang } from './quest';

const KEY = 'rpg-worlds';
/** How many earlier worlds the next genesis is told to avoid. */
const KEEP_PAST = 8;

interface Stored {
  current?: Partial<Record<Lang, WorldBible>>;
  /** "name: pitch" of earlier worlds, newest last, every language. */
  past?: string[];
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
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* a full or blocked storage forgets the world; the game plays on */
  }
}

export function loadWorld(lang: Lang): WorldBible | null {
  const world = read().current?.[lang];
  return world && typeof world.id === 'string' && typeof world.name === 'string' && world.look ? world : null;
}

/** Makes `world` the one played in its language; the one it replaces joins the past. */
export function saveWorld(world: WorldBible): void {
  const stored = read();
  const before = stored.current?.[world.lang];
  const past = [...(stored.past ?? [])];
  if (before && before.id !== world.id && before.createdAt > 0) past.push(`${before.name}: ${before.pitch}`);
  write({ current: { ...stored.current, [world.lang]: world }, past: past.slice(-KEEP_PAST) });
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
}

function readAtlases(): Record<string, Atlas> {
  try {
    const parsed = JSON.parse(localStorage.getItem(ATLAS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadAtlas(worldId: string): Atlas {
  const atlas = readAtlases()[worldId];
  return {
    // Through the parser again: what is stored is the browser's to edit, and an older game's to have
    // written in an older shape.
    places: Array.isArray(atlas?.places)
      ? atlas.places.map((p) => parsePlace(p)).filter((p): p is PlaceSpec => p !== null)
      : [],
    people: Array.isArray(atlas?.people) ? atlas.people.filter((p) => p?.character && typeof p.character.name === 'string') : [],
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
  const people = [
    ...(before.people ?? []).filter((p) => !add.people.some((q) => q.character.name === p.character.name)),
    ...add.people,
  ].slice(-ATLAS_PEOPLE);
  const atlas = { places, people };
  // Only the worlds still being played keep theirs: the classic ones, and each language's current.
  const live = new Set<string>(['pl', 'en', ...Object.values(read().current ?? {}).map((w) => w?.id ?? '')]);
  const kept: Record<string, Atlas> = {};
  for (const id of live) if (all[id]) kept[id] = all[id];
  kept[worldId] = atlas;
  try {
    localStorage.setItem(ATLAS_KEY, JSON.stringify(kept));
  } catch {
    /* a full storage forgets the atlas; the world just grows less */
  }
  return atlas;
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
