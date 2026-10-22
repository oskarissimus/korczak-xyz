/*
 * The autosave: the quest in progress, in this browser's localStorage, written at every step that
 * changes it (a beat set up, a thing killed or picked up, a clue examined, the story heard, a
 * decision made). Owner, Oct 2026: he went back by accident just before a story ended and never
 * learnt how it ended.
 *
 * What is kept is the story, not the world: every beat so far (so their places and characters can
 * stand again), the decisions, the progress on the current job, what was examined and heard. The
 * world is rebuilt from that; the hunter starts again at the village with the marker pointing on.
 * A decision whose next beat was still being written is saved as made, and the beat is asked for
 * again on load — the model's answer from before is gone with the page.
 *
 * One quest at a time IN EACH WORLD (owner, Oct 2026: "browse the earlier worlds and the games in
 * them, and load such a saved game"): `rpg-saves`, by world id, so leaving a world for a new one no
 * longer throws its quest away. A save is cleared when its quest ends (it is in the chronicle then)
 * or a new one starts in that world. The single `rpg-save` of before is read once into the map.
 * Every change is stamped for the account copy (`sync.ts`, `cloud.ts`).
 */

import type { Beat, Lang, StepRecord } from './quest';
import { saveUnit, touch } from './sync';
import type { TranscriptLine } from './transcript';

const OLD_KEY = 'rpg-save';
const KEY = 'rpg-saves';
const VERSION = 1;

export interface SavedGame {
  version: number;
  at: number;
  lang: Lang;
  seed: string;
  /** The hand-written quest, because the opening could not be generated. */
  static: boolean;
  /** Every beat set up so far, the current one last. */
  beats: Beat[];
  progress: number;
  history: StepRecord[];
  /** What each character last said. */
  lastLines: [string, string][];
  /** The current beat's examined clues, by index. */
  seen: number[];
  heard: boolean;
  /** The current beat's witness has been talked to; absent in older saves. */
  witnessHeard?: boolean;
  /** The current beat's small-talk questions asked, by index; absent in older saves. */
  askedTalk?: number[];
  /** The current beat's decision, by index, once made. */
  decision: number | null;
  /** Time played on this quest so far; absent in saves from before it was kept. */
  playMs?: number;
  /** Every line said so far, for the developer console; absent in older saves. */
  transcript?: TranscriptLine[];
  /** The world it is played in (`genesis.ts`); absent in saves from before there were worlds. */
  worldId?: string;
}

function valid(saved: unknown): saved is SavedGame {
  const g = saved as SavedGame | null;
  return Boolean(g && g.version === VERSION && Array.isArray(g.beats) && g.beats.length > 0);
}

/** The world a save belongs to: a save from before there were worlds is the classic one's. */
export function saveWorldId(game: Pick<SavedGame, 'worldId' | 'lang'>): string {
  return game.worldId ?? game.lang;
}

function readAll(): Record<string, SavedGame> {
  let all: Record<string, SavedGame> = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') all = parsed;
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null');
    if (valid(old)) {
      const id = saveWorldId(old);
      if (!all[id] || all[id].at < old.at) all[id] = old;
      localStorage.setItem(KEY, JSON.stringify(all));
      touch(saveUnit(id));
    }
    if (old !== null) localStorage.removeItem(OLD_KEY);
  } catch {
    /* what could be read */
  }
  return all;
}

function writeAll(all: Record<string, SavedGame>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** The quest played last, in any world. */
export function loadGame(): SavedGame | null {
  const saves = Object.values(readAll()).filter(valid);
  return saves.sort((a, b) => b.at - a.at)[0] ?? null;
}

/** The quest in progress in this world, if any. */
export function loadGameFor(worldId: string): SavedGame | null {
  const game = readAll()[worldId];
  return valid(game) ? game : null;
}

/** Every world's quest in progress, by world id. */
export function allGames(): Record<string, SavedGame> {
  const all = readAll();
  return Object.fromEntries(Object.entries(all).filter(([, g]) => valid(g)));
}

export function saveGame(game: Omit<SavedGame, 'version' | 'at'>): void {
  const id = saveWorldId(game);
  const all = readAll();
  all[id] = { ...game, version: VERSION, at: Date.now() };
  // A full storage keeps no save; the game plays on.
  if (writeAll(all)) touch(saveUnit(id));
}

/** The quest in this world is over or abandoned. */
export function clearGame(worldId: string): void {
  const all = readAll();
  if (!(worldId in all)) return;
  delete all[worldId];
  writeAll(all);
  touch(saveUnit(worldId));
}

/** For the account copy: what this browser holds, and taking the account's (`cloud.ts`). */
export function writeGameFor(worldId: string, game: SavedGame | null): void {
  const all = readAll();
  if (valid(game)) all[worldId] = game;
  else delete all[worldId];
  writeAll(all);
}

/** Frees the storage of a world's save the account already has (`worldSave.ts`'s eviction). */
export function dropGameFor(worldId: string): void {
  writeGameFor(worldId, null);
}
