/*
 * The answer to a `name` card: twelve buttons, one per pitch class.
 *
 * Twelve rather than "type the note" because the answer has to be one tap on a phone and
 * because a text field would need to accept `A#`, `a#`, `A♯` and `Bb` and then argue about
 * which of them you meant. Each button carries both spellings, so the deck teaches that
 * `A♯` and `B♭` are the same fret rather than quietly picking a side.
 */

import { PITCH_CLASSES } from '../../utils/fretboard/notes';
import type { NoteName } from '../../utils/fretboard/notes';

interface NotePadProps {
  onPick: (note: NoteName) => void;
  disabled: boolean;
  /** Once answered: which button was pressed and which one was right. */
  chosen: NoteName | null;
  answer: NoteName | null;
}

export default function NotePad({ onPick, disabled, chosen, answer }: NotePadProps) {
  return (
    <div className="fb-pad">
      {PITCH_CLASSES.map(({ name, label }) => {
        const isAnswer = answer != null && name === answer;
        const isMistake = chosen != null && name === chosen && name !== answer;
        return (
          <button
            key={name}
            type="button"
            className={`fb-pad-key${isAnswer ? ' fb-pad-key--right' : ''}${
              isMistake ? ' fb-pad-key--wrong' : ''
            }`}
            onClick={() => onPick(name)}
            disabled={disabled}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
