/*
 * Keyboard answers.
 *
 * Pure functions rather than logic inside the key handler, for the same reason the fretboard
 * trainer's `keys.ts` is pure: there is no jsdom in this project, so anything that lives in an
 * event handler is not a reachable state in a test.
 *
 * The mapping is the fretboard's, one level up — a letter answers that natural's *chord root*,
 * shift answers its sharp — with the same deliberate hole. There is no E♯ or B♯ button on the pad,
 * so shift on those two letters does nothing rather than answering something the player did not
 * mean.
 *
 * What each letter means depends on the notation the card is asked in, so the map is
 * per-notation rather than a shared set of naturals plus a rule. In the two H-systems `H` answers
 * B natural and `B` — unshifted — answers B flat, because there `B` *is* the black key; which also
 * closes the hole from the other side, since shift on `B` would reach for what `B` already answers.
 * A single shared set of letters is what would silently desync here, so there isn't one.
 *
 * Answering a three-chord card is three keystrokes, and `Enter` commits — which is also the key
 * that carries on past a wrong answer, the only other thing this screen asks you to confirm.
 */

import type { Notation, PitchClass } from './theory';

/** Letter → the natural it answers, per system. Absent letters answer nothing. */
const NATURAL_KEYS: Record<Notation, Record<string, PitchClass>> = {
  international: { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 },
  polish: { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11 },
  german: { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11 },
};

/** Which pitch classes have a pad button of their own. All twelve do; E♯ and B♯ are not among them. */
const SHARPABLE = new Set<PitchClass>([0, 2, 5, 7, 9]); // C D F G A — the ones with a black key above

/** The pitch class a keypress picks, or null if it picks nothing. */
export function rootFromKey(key: string, shift: boolean, notation: Notation): PitchClass | null {
  const letter = key.toUpperCase();

  // `B` in the two H-systems is the black key itself, so it answers with or without shift — and
  // there is nothing above it to reach for.
  if (notation !== 'international' && letter === 'B') return shift ? null : 10;

  const natural = NATURAL_KEYS[notation][letter];
  if (natural == null) return null;
  if (!shift) return natural;
  return SHARPABLE.has(natural) ? (((natural + 1) % 12) as PitchClass) : null;
}

/** Whether a keypress commits a selection, or carries on past a card already answered. */
export function isCommitKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

/** Whether a keypress takes the last chord back off the slots. */
export function isUndoKey(key: string): boolean {
  return key === 'Backspace' || key === 'Delete';
}
