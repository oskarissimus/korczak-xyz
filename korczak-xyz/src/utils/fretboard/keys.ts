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
 *
 * Under German notation the letters mean something else, so the map is per-notation rather than
 * a set of naturals plus a rule. `H` answers B natural, and `B` — unshifted — answers A♯,
 * because in that notation `B` *is* the black key. Which also closes the hole from the other
 * side: shift on `B` is nothing, since what it would reach for is already what `B` answers.
 * A single shared set of natural letters is what would silently desync here, so there isn't one.
 */

import { PITCH_CLASSES } from './notes';
import type { Notation, NoteName } from './notes';

const NOTE_NAMES = new Set<string>(PITCH_CLASSES.map((p) => p.name));

/** Letter → the natural it answers, per notation. Absent letters answer nothing. */
const NATURAL_KEYS: Record<Notation, Record<string, NoteName>> = {
  international: { A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G' },
  german: { A: 'A', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'B' },
};

/** The note a keypress answers on a `name` card, or null if it answers nothing. */
export function noteFromKey(key: string, shift: boolean, notation: Notation): NoteName | null {
  const letter = key.toUpperCase();

  // `B` in German notation is the accidental itself, so it answers with or without shift —
  // and there is nothing above it to reach for.
  if (notation === 'german' && letter === 'B') return shift ? null : 'A#';

  const natural = NATURAL_KEYS[notation][letter];
  if (!natural) return null;
  if (!shift) return natural;
  const sharp = `${natural}#`;
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
