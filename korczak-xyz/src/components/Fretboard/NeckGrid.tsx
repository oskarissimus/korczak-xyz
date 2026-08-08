/*
 * The neck as a grid: the answer surface for a `find` card, and the heatmap on the stats page.
 *
 * Not the ASCII diagram. That notation is read, and reading is what a `name` card asks for; a
 * `find` card is answered by pointing at a place on the instrument, and a place has to be big
 * enough to hit with a thumb. Same palette, same string order, so the two still read as the
 * same neck.
 *
 * Only the asked string is live. That is what makes 22px-wide cells workable on a phone —
 * vertical aim does not matter when five of the six rows cannot be pressed.
 */

import type { ReactNode } from 'react';
import { STRING_COUNT, STRING_LABELS } from '../../utils/fretboard/notes';
import type { PositionStat } from '../../utils/fretboard/stats';

interface NeckLayoutProps {
  maxFret: number;
  stringLabels?: boolean;
  renderCell: (stringIndex: number, fret: number) => ReactNode;
  className?: string;
  label?: string;
}

function NeckLayout({
  maxFret,
  stringLabels = true,
  renderCell,
  className = '',
  label,
}: NeckLayoutProps) {
  const frets = Array.from({ length: maxFret + 1 }, (_, i) => i);
  // Strings high to low, the way every chart is drawn.
  const rows = Array.from({ length: STRING_COUNT }, (_, i) => STRING_COUNT - 1 - i);

  return (
    <div className={`fb-neck ${className}`.trim()} role="group" aria-label={label}>
      <div
        className="fb-neck-grid"
        style={{ gridTemplateColumns: `auto repeat(${frets.length}, minmax(0, 1fr))` }}
      >
        <span className="fb-neck-corner" aria-hidden="true" />
        {frets.map((fret) => (
          <span key={`h${fret}`} className="fb-neck-fretno" aria-hidden="true">
            {fret}
          </span>
        ))}
        {rows.map((stringIndex) => (
          <div key={stringIndex} className="fb-neck-row" style={{ display: 'contents' }}>
            <span className="fb-neck-string" aria-hidden={!stringLabels}>
              {stringLabels ? STRING_LABELS[stringIndex] : ' '}
            </span>
            {frets.map((fret) => renderCell(stringIndex, fret))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- answering a `find` card ------------------------------------------------------------------

interface NeckPickerProps {
  maxFret: number;
  activeString: number;
  stringLabels: boolean;
  disabled: boolean;
  chosenFret: number | null;
  /** Every fret that sounds the asked note — null until the card has been answered. */
  answerFrets: number[] | null;
  onPick: (fret: number) => void;
  label: string;
  fretLabel: (fret: number) => string;
}

export function NeckPicker({
  maxFret,
  activeString,
  stringLabels,
  disabled,
  chosenFret,
  answerFrets,
  onPick,
  label,
  fretLabel,
}: NeckPickerProps) {
  return (
    <NeckLayout
      maxFret={maxFret}
      stringLabels={stringLabels}
      className="fb-neck--picker"
      label={label}
      renderCell={(stringIndex, fret) => {
        const live = stringIndex === activeString;
        const isAnswer = answerFrets != null && live && answerFrets.includes(fret);
        const isMistake = answerFrets != null && live && chosenFret === fret && !isAnswer;
        const classes = [
          'fb-neck-cell',
          live ? 'fb-neck-cell--live' : 'fb-neck-cell--muted',
          isAnswer ? 'fb-neck-cell--right' : '',
          isMistake ? 'fb-neck-cell--wrong' : '',
        ]
          .filter(Boolean)
          .join(' ');

        if (!live) {
          return <span key={`${stringIndex}-${fret}`} className={classes} aria-hidden="true" />;
        }
        return (
          <button
            key={`${stringIndex}-${fret}`}
            type="button"
            className={classes}
            disabled={disabled}
            onClick={() => onPick(fret)}
            aria-label={fretLabel(fret)}
          >
            <span className="fb-neck-mark" aria-hidden="true">
              {isAnswer ? '●' : isMistake ? '✕' : ''}
            </span>
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
}

export function NeckHeatmap({ maxFret, squares, describe, label }: NeckHeatmapProps) {
  const bySquare = new Map(squares.map((s) => [`${s.stringIndex}-${s.fret}`, s]));
  return (
    <NeckLayout
      maxFret={maxFret}
      className="fb-neck--heat"
      label={label}
      renderCell={(stringIndex, fret) => {
        const square = bySquare.get(`${stringIndex}-${fret}`);
        const bucket = square?.bucket ?? 'new';
        return (
          <span
            key={`${stringIndex}-${fret}`}
            className={`fb-neck-cell fb-neck-cell--heat fb-heat-${bucket}`}
            title={square ? describe(square) : undefined}
          />
        );
      }}
    />
  );
}
