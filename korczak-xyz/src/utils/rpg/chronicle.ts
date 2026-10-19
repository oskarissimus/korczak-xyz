/*
 * The chronicle: every quest the hunter has finished and how they chose, which every later quest
 * is written against (`beatPrompt`'s "the world remembers"). This is what makes a decision outlive
 * its quest.
 *
 * Kept in this browser's localStorage, one list per world (`genesis.ts`): a world is in one language,
 * so a Polish chronicle is never quoted into an English prompt, and one world's deeds never into
 * another's. The classic world's id is its language, which is what every chronicle was kept under
 * before there were worlds. Capped at `KEEP` quests so the prompt stays short. Not synced to the account yet; a chronicle that follows the reader between devices is a
 * Firestore document for later.
 */

import type { ChronicleEntry } from './quest';

const KEY = 'rpg-chronicle';
export const KEEP = 8;

type Stored = Record<string, ChronicleEntry[]>;

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
    /* a full or blocked storage forgets the chronicle; the game plays on */
  }
}

export function loadChronicle(worldId: string): ChronicleEntry[] {
  const entries = read()[worldId];
  return Array.isArray(entries) ? entries.filter((e) => e && typeof e.title === 'string' && Array.isArray(e.steps)) : [];
}

export function addToChronicle(worldId: string, entry: ChronicleEntry): ChronicleEntry[] {
  const stored = read();
  const next = [...loadChronicle(worldId), entry].slice(-KEEP);
  write({ ...stored, [worldId]: next });
  return next;
}

export function clearChronicle(worldId: string) {
  const stored = read();
  delete stored[worldId];
  write(stored);
}
