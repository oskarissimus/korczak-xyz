/*
 * The chronicle: every quest the hunter has finished and how they chose, which every later quest
 * is written against (`beatPrompt`'s "the world remembers"). This is what makes a decision outlive
 * its quest.
 *
 * Kept in this browser's localStorage, one list per game language (a Polish chronicle quoted into
 * an English prompt would leak Polish into the story), capped at `KEEP` quests so the prompt stays
 * short. Not synced to the account yet; a chronicle that follows the reader between devices is a
 * Firestore document for later.
 */

import type { ChronicleEntry, Lang } from './quest';

const KEY = 'rpg-chronicle';
export const KEEP = 8;

type Stored = Partial<Record<Lang, ChronicleEntry[]>>;

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

export function loadChronicle(lang: Lang): ChronicleEntry[] {
  const entries = read()[lang];
  return Array.isArray(entries) ? entries.filter((e) => e && typeof e.title === 'string' && Array.isArray(e.steps)) : [];
}

export function addToChronicle(lang: Lang, entry: ChronicleEntry): ChronicleEntry[] {
  const stored = read();
  const next = [...loadChronicle(lang), entry].slice(-KEEP);
  write({ ...stored, [lang]: next });
  return next;
}

export function clearChronicle(lang: Lang) {
  const stored = read();
  delete stored[lang];
  write(stored);
}
