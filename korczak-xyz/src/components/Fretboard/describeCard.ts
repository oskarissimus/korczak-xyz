/*
 * Naming a neck card in prose, for the "worth another look" list at the end of a sitting.
 *
 * Its own module because the sitting summary is now the merged app's and shared with the chord
 * cards, while this is the fretboard's own grammar — and it needs the fretboard's own translation
 * table, which is what kept it out of the shared component.
 */

import {
  asksEveryPlace,
  cardNoteLabel,
  cardNotation,
  isPositionKey,
  parseCardId,
  stringLabel,
} from '../../utils/fretboard/notes';
import type { Notation } from '../../utils/fretboard/notes';
import { fill, type Translation } from './translations';

/**
 * `A — D string, fret 7`: the note first, because that is what the card was about.
 *
 * Named as the card named it — under the spelling it asked and in the notation it asked in — so the
 * `find` cards on one black key are up to four separate lines. Missing `D♭` and missing `C♯` are
 * different things to go back and look at, and so are missing `C♯` and missing `Cis`.
 *
 * `display` only decides the string letter on a card that reads the same in both notations, where
 * there is nothing to take it from.
 */
export function describeCard(cardId: string, t: Translation, display: Notation): string {
  const key = parseCardId(cardId);
  if (!key) return cardId;
  // A `pitch` card names no place — several answer it — so the pitch and its octave are the line;
  // a select-all card wanted all of them, which is a different thing to go back and look at.
  if (!isPositionKey(key)) {
    return `${cardNoteLabel(key)} — ${asksEveryPlace(key) ? t.everywhereShort : t.anywhereShort}`;
  }
  const string = stringLabel(key.stringIndex, cardNotation(key, display));
  const where =
    key.fret === 0
      ? fill(t.a11yPositionOpen, { string })
      : fill(t.a11yPosition, { string, fret: key.fret });
  return `${cardNoteLabel(key)} — ${where}`;
}
