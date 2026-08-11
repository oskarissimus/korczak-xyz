/*
 * The neck as a grid: the answer surface for a `find` card, and the heatmap on the stats page.
 *
 * Not the ASCII diagram. That notation is read, and reading is what a `name` card asks for; a
 * `find` card is answered by pointing at a place on the instrument, and a place has to be big
 * enough to hit with a thumb. Same palette, same string order, so the two still read as the
 * same neck.
 *
 * On a `find` card only the asked string is live, and that is what makes 22px-wide cells workable
 * on a phone — vertical aim does not matter when five of the six rows cannot be pressed. A `pitch`
 * card asks for a note anywhere, so every string in the scope is live and vertical aim starts
 * mattering; the rows are 40px tall, which is a whole touch target, and the horizontal precision
 * the narrow cells demand is the same either way.
 *
 * Fret 0 has no column of its own. An open string is not stopped anywhere, so a box labelled
 * `0` sitting where the first fret's box sits reads as a fret — and the answer to "F on the D
 * string" then looks like it could be that box. The nut is where the string is named, so the
 * string-name column *is* the open position: it carries the label and, on the asked string,
 * takes the tap. That is also the grammar `diagram.ts` already uses, where an open string is
 * marked on the nut and the numbered cells start at 1.
 */

import type { ReactNode } from 'react';
import { STRING_COUNT, stringLabel } from '../../utils/fretboard/notes';
import type { Notation, Position } from '../../utils/fretboard/notes';
import type { PositionStat } from '../../utils/fretboard/stats';

interface NeckLayoutProps {
  maxFret: number;
  stringLabels?: boolean;
  notation: Notation;
  /** `openLabel` is the string's name, and is given only for the nut cell (fret 0). */
  renderCell: (stringIndex: number, fret: number, openLabel: string | null) => ReactNode;
  className?: string;
  label?: string;
}

function NeckLayout({
  maxFret,
  stringLabels = true,
  notation,
  renderCell,
  className = '',
  label,
}: NeckLayoutProps) {
  const frets = Array.from({ length: maxFret }, (_, i) => i + 1);
  // Strings high to low, the way every chart is drawn.
  const rows = Array.from({ length: STRING_COUNT }, (_, i) => STRING_COUNT - 1 - i);

  return (
    <div className={`fb-neck ${className}`.trim()} role="group" aria-label={label}>
      <div
        className="fb-neck-grid"
        style={{ gridTemplateColumns: `repeat(${frets.length + 1}, minmax(0, 1fr))` }}
      >
        {/* Nothing is printed over the nut: the string names under it say what it is. */}
        <span className="fb-neck-corner" aria-hidden="true" />
        {frets.map((fret) => (
          <span key={`h${fret}`} className="fb-neck-fretno" aria-hidden="true">
            {fret}
          </span>
        ))}
        {rows.map((stringIndex) => (
          <div key={stringIndex} className="fb-neck-row" style={{ display: 'contents' }}>
            {renderCell(stringIndex, 0, stringLabels ? stringLabel(stringIndex, notation) : null)}
            {frets.map((fret) => renderCell(stringIndex, fret, null))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- answering a `find` or `pitch` card --------------------------------------------------------

const samePosition = (a: Position, b: Position) =>
  a.stringIndex === b.stringIndex && a.fret === b.fret;

interface NeckPickerProps {
  maxFret: number;
  /** The strings that can be pressed: the asked one on a `find` card, the scope on a `pitch` one. */
  liveStrings: readonly number[];
  stringLabels: boolean;
  notation: Notation;
  disabled: boolean;
  chosen: Position | null;
  /** Every place that answers the card — null until it has been answered. */
  answers: readonly Position[] | null;
  onPick: (stringIndex: number, fret: number) => void;
  label: string;
  /** Names the whole place, not just the fret: on a `pitch` card the string is part of the answer. */
  cellLabel: (stringIndex: number, fret: number) => string;
}

export function NeckPicker({
  maxFret,
  liveStrings,
  stringLabels,
  notation,
  disabled,
  chosen,
  answers,
  onPick,
  label,
  cellLabel,
}: NeckPickerProps) {
  return (
    <NeckLayout
      maxFret={maxFret}
      stringLabels={stringLabels}
      notation={notation}
      className="fb-neck--picker"
      label={label}
      renderCell={(stringIndex, fret, openLabel) => {
        const here = { stringIndex, fret };
        const live = liveStrings.includes(stringIndex);
        const isAnswer = answers != null && answers.some((p) => samePosition(p, here));
        const isMistake =
          answers != null && chosen != null && samePosition(chosen, here) && !isAnswer;
        const classes = [
          'fb-neck-cell',
          fret === 0 ? 'fb-neck-cell--open' : '',
          live ? 'fb-neck-cell--live' : 'fb-neck-cell--muted',
          isAnswer ? 'fb-neck-cell--right' : '',
          isMistake ? 'fb-neck-cell--wrong' : '',
        ]
          .filter(Boolean)
          .join(' ');

        // The nut cell shows the string's name until the card is answered, at which point the
        // verdict is what the row is for. That costs one label — on a `pitch` card, where the
        // prompt names no string, it is the label of a row you have just marked and are looking
        // straight at, and the five others are still there to read the neck by.
        const mark = isAnswer ? '●' : isMistake ? '✕' : '';
        const content = mark ? (
          <span className="fb-neck-mark" aria-hidden="true">
            {mark}
          </span>
        ) : openLabel ? (
          <span className="fb-neck-open" aria-hidden="true">
            {openLabel}
          </span>
        ) : null;

        if (!live) {
          return (
            <span key={`${stringIndex}-${fret}`} className={classes} aria-hidden="true">
              {content}
            </span>
          );
        }
        return (
          <button
            key={`${stringIndex}-${fret}`}
            type="button"
            className={classes}
            disabled={disabled}
            onClick={() => onPick(stringIndex, fret)}
            aria-label={cellLabel(stringIndex, fret)}
          >
            {content}
          </button>
        );
      }}
    />
  );
}

// --- the heatmap ------------------------------------------------------------------------------

interface NeckHeatmapProps {
  maxFret: number;
  squares: PositionStat[];
  describe: (square: PositionStat) => string;
  label: string;
  notation: Notation;
}

export function NeckHeatmap({ maxFret, squares, describe, label, notation }: NeckHeatmapProps) {
  const bySquare = new Map(squares.map((s) => [`${s.stringIndex}-${s.fret}`, s]));
  return (
    <NeckLayout
      maxFret={maxFret}
      notation={notation}
      className="fb-neck--heat"
      label={label}
      renderCell={(stringIndex, fret, openLabel) => {
        const square = bySquare.get(`${stringIndex}-${fret}`);
        const bucket = square?.bucket ?? 'new';
        const open = fret === 0 ? ' fb-neck-cell--open' : '';
        return (
          <span
            key={`${stringIndex}-${fret}`}
            className={`fb-neck-cell fb-neck-cell--heat${open} fb-heat-${bucket}`}
            title={square ? describe(square) : undefined}
          >
            {openLabel ? (
              <span className="fb-neck-open" aria-hidden="true">
                {openLabel}
              </span>
            ) : null}
          </span>
        );
      }}
    />
  );
}
