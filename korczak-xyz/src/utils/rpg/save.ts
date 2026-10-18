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
 * One quest at a time, cleared when it ends (it is in the chronicle then) or a new one starts.
 */

import type { Beat, Lang, StepRecord } from './quest';

const KEY = 'rpg-save';
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
  /** The current beat's decision, by index, once made. */
  decision: number | null;
}

export function loadGame(): SavedGame | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved || saved.version !== VERSION || !Array.isArray(saved.beats) || saved.beats.length === 0) return null;
    return saved as SavedGame;
  } catch {
    return null;
  }
}

export function saveGame(game: Omit<SavedGame, 'version' | 'at'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...game, version: VERSION, at: Date.now() }));
  } catch {
    /* a full or blocked storage keeps no save; the game plays on */
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
