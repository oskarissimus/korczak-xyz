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
import type { Lang } from './quest';

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
