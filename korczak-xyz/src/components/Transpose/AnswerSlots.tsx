/*
 * The row the answer is built in, and the row the question is read from.
 *
 * One component for both, because they are the same object at two moments: a chord in a fixed
 * position in a progression. Reading `A D E` on the front of a card and building `C F G` under it
 * should look like the same thing, since the whole point of the card is that one becomes the other.
 *
 * **The slots on a `transpose` card are unlabelled.** Printing `I IV V` under them would hand over
 * the degree route — and that route is one of the two ways to answer the card, the other being to
 * count three semitones onto each chord. A `degrees` card labels them, because there the numerals
 * *are* the question.
 *
 * A filled slot prints the chord as the card's key spells it. That is where the spelling is taught:
 * you tap a pitch class off a pad that offers both, and the slot answers with the one the key wants
 * — `Gb` in D♭ major, `F#` in B.
 */

import { chordLabel, keySpelling } from '../../utils/transpose/theory';
import type { Key, Notation, PitchClass, Quality } from '../../utils/transpose/theory';

export interface Slot {
  /** The pitch class in the slot, or null while it is still empty. */
  pc: PitchClass | null;
  /** Fixed by the pattern, which is why only the root is ever tapped. */
  quality: Quality;
  /** The Roman numeral, shown only where it is the question rather than the answer. */
  numeral?: string;
  /** Once graded: whether this slot holds the right chord. */
  state?: 'right' | 'wrong';
}

interface AnswerSlotsProps {
  slots: Slot[];
  /** Which key spells these chords. */
  spellIn: Key;
  notation: Notation;
  /** Which slot the next tap fills — outlined, so it is obvious where a tap will land. */
  activeIndex?: number;
  /** Tapping a filled slot takes it back. Absent on the question row, which is not editable. */
  onClear?: (index: number) => void;
  /** The question row is smaller and flat; the answer row is a set of sunken fields. */
  variant: 'question' | 'answer';
}

export default function AnswerSlots({
  slots,
  spellIn,
  notation,
  activeIndex,
  onClear,
  variant,
}: AnswerSlotsProps) {
  const spelling = keySpelling(spellIn);

  return (
    <ol className={`tp-slots tp-slots--${variant}`}>
      {slots.map((slot, i) => {
        const label = slot.pc == null ? '' : chordLabel(slot.pc, slot.quality, notation, spelling);
        const classes = [
          'tp-slot',
          slot.pc == null ? 'tp-slot--empty' : 'tp-slot--filled',
          i === activeIndex ? 'tp-slot--active' : '',
          slot.state ? `tp-slot--${slot.state}` : '',
        ]
          .filter(Boolean)
          .join(' ');

        const content = (
          <>
            <span className="tp-slot-chord">{label || ' '}</span>
            {slot.numeral && <span className="tp-slot-numeral">{slot.numeral}</span>}
          </>
        );

        return (
          <li key={i} className={classes}>
            {onClear && slot.pc != null ? (
              // A filled slot is how you take a chord back — the slot itself, rather than a
              // separate undo control, because that is where the mistake is.
              <button type="button" className="tp-slot-btn" onClick={() => onClear(i)}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}
