/*
 * Keyboard answers.
 *
 * Pure functions rather than logic inside the key handler, for the same reason `comboKeys.ts`
 * exists on the typing trainer: there is no jsdom in this project, so anything that lives in an
 * event handler is not a reachable state in a test.
 *
 * The mapping is the obvious one — a letter answers that natural, shift answers its sharp —
 * with one deliberate hole. There is no E♯ or B♯ button on the pad, because those names are not
 * how anyone asks for F and C, so shift on those two letters does nothing rather than
 * answering something the player did not mean.
 */

import { PITCH_CLASSES } from './notes';
import type { NoteName } from './notes';

const NATURALS = new Set<string>(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
const NOTE_NAMES = new Set<string>(PITCH_CLASSES.map((p) => p.name));

/** The note a keypress answers on a `name` card, or null if it answers nothing. */
export function noteFromKey(key: string, shift: boolean): NoteName | null {
  const letter = key.toUpperCase();
  if (!NATURALS.has(letter)) return null;
  if (!shift) return letter as NoteName;
  const sharp = `${letter}#`;
  return NOTE_NAMES.has(sharp) ? (sharp as NoteName) : null;
}

/** The fret a keypress answers on a `find` card. Frets past 9 are a tap; there is no key. */
export function fretFromKey(key: string, maxFret: number): number | null {
  if (!/^\d$/.test(key)) return null;
  const fret = Number(key);
  return fret <= maxFret ? fret : null;
}

/** Whether a keypress means "carry on" on a card that has already been answered. */
export function isAdvanceKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}
