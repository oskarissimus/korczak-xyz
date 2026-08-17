/*
 * Naming a chord card in prose, for the "worth another look" list at the end of a sitting.
 *
 * Its own module for the reason the fretboard's is: the summary is the merged app's now, and this is
 * one trainer's grammar plus one trainer's translation table.
 */

import { parseCardId } from '../../utils/transpose/cards';
import { chordLabels, keyLabel, keyOf, patternLabel } from '../../utils/transpose/theory';
import type { Notation } from '../../utils/transpose/theory';
import type { Translation } from './translations';

/**
 * `A D E → C` / `I IV V in A` / `A D E — which key?`
 *
 * Named as the card named it, in the notation the card asked in, so a `degrees` card in `A` and the
 * same one asked in German names are two lines. Missing `A D E fis` and missing `A D E f#` are
 * different things to go back and look at, which is the whole reason they are two cards.
 */
export function describeCard(cardId: string, t: Translation): string {
  const key = parseCardId(cardId);
  if (!key) return cardId;
  const notation: Notation = key.notation;

  if (key.direction === 'transpose') {
    const from = chordLabels(key.from, key.pattern, notation).join(' ');
    return `${from} → ${keyLabel(keyOf(key.to, key.pattern), notation)}`;
  }
  if (key.direction === 'degrees') {
    return `${patternLabel(key.pattern)} ${t.askDegrees} ${keyLabel(
      keyOf(key.tonic, key.pattern),
      notation
    )}`;
  }
  return `${chordLabels(key.tonic, key.pattern, notation).join(' ')} — ${t.askKey}`;
}
