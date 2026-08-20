/*
 * Naming a chord card in prose, for the "worth another look" list at the end of a sitting.
 *
 * Its own module for the reason the fretboard's is: the summary is the merged app's now, and this is
 * one trainer's grammar plus one trainer's translation table.
 */

import { answerChords, parseCardId, promptChords } from '../../utils/transpose/cards';
import type { CardKey } from '../../utils/transpose/cards';
import { chordLabel, keyLabel, keyOf, keySpelling } from '../../utils/transpose/theory';
import type { Notation } from '../../utils/transpose/theory';
import type { Translation } from './translations';

/** The chords a card shows or asks for, spelt as their key spells them. */
function labels(
  chords: { pc: number; quality: 'major' | 'minor' }[],
  tonic: number,
  key: CardKey,
  notation: Notation
): string {
  const spelling = keySpelling(keyOf(tonic, key.pattern));
  return chords.map((c) => chordLabel(c.pc, c.quality, notation, spelling)).join(' ');
}

/**
 * `A D E → C` / `I IV V in A` / `A D E — which key?`
 *
 * Named as the card named it, in the notation the card asked in **and in the order it asked**, so
 * a `degrees` card in `A` and the same one asked in German names are two lines — and so are
 * `H E F#` and `E F# H`. Missing `A D E fis` and missing `A D E f#` are different things to go
 * back and look at, which is the whole reason they are two cards; the same is true of the
 * orderings, and printing all six of them as `A D E` would make the list say one thing six times.
 *
 * Through `promptChords`/`answerChords` rather than `chordLabels` and `patternLabel` for exactly
 * that: those two are degree-order by construction and cannot see the ordering axis.
 */
export function describeCard(cardId: string, t: Translation): string {
  const key = parseCardId(cardId);
  if (!key) return cardId;
  const notation: Notation = key.notation;

  if (key.direction === 'transpose') {
    const from = labels(promptChords(key), key.from, key, notation);
    return `${from} → ${keyLabel(keyOf(key.to, key.pattern), notation)}`;
  }
  if (key.direction === 'degrees') {
    const numerals = answerChords(key)
      .map((c) => c.numeral)
      .join(' ');
    return `${numerals} ${t.askDegrees} ${keyLabel(keyOf(key.tonic, key.pattern), notation)}`;
  }
  return `${labels(promptChords(key), key.tonic, key, notation)} — ${t.askKey}`;
}
