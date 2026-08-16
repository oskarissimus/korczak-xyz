/*
 * The answer surface: twelve buttons, one per pitch class.
 *
 * Twelve rather than twenty-four, because **the pattern fixes each slot's quality**. On a `I IV V
 * vi` card the fourth chord is minor whatever root you pick, so asking you to pick the quality as
 * well would be asking you to repeat what the card already said. Only the root is in question, and
 * a pad of twelve is one that fits across a phone.
 *
 * A button carries both spellings where they differ (`F#/Gb`), because a pitch class has no key to
 * spell it. The *slot* it fills then prints the chord as the card's key spells it — `Gb` in D♭
 * major, `F#` in B — which is where the spelling gets taught rather than graded.
 *
 * The notation is the card's, not a global setting: a card asking in the songbook's names is
 * answered on a pad that says `B` for B flat, and one asking internationally on a pad that says
 * `A#/Bb`. `onPick` hands back the pitch class, never the label — what the button says is the
 * card's business, what the answer is is not.
 */

import { pitchClassLabel } from '../../utils/transpose/theory';
import type { Notation, PitchClass } from '../../utils/transpose/theory';

interface ChordPadProps {
  onPick: (pc: PitchClass) => void;
  disabled: boolean;
  notation: Notation;
  /** Once answered: which roots were right, so the pad can show what should have been pressed. */
  answers?: PitchClass[];
  /** Once answered: which roots were pressed and should not have been. */
  mistakes?: PitchClass[];
}

const PITCH_CLASSES: PitchClass[] = Array.from({ length: 12 }, (_, i) => i);

export default function ChordPad({
  onPick,
  disabled,
  notation,
  answers = [],
  mistakes = [],
}: ChordPadProps) {
  return (
    <div className="tp-pad">
      {PITCH_CLASSES.map((pc) => {
        const isAnswer = answers.includes(pc);
        const isMistake = !isAnswer && mistakes.includes(pc);
        return (
          <button
            key={pc}
            type="button"
            className={`tp-pad-key${isAnswer ? ' tp-pad-key--right' : ''}${
              isMistake ? ' tp-pad-key--wrong' : ''
            }`}
            onClick={() => onPick(pc)}
            disabled={disabled}
          >
            {pitchClassLabel(pc, notation)}
          </button>
        );
      })}
    </div>
  );
}
