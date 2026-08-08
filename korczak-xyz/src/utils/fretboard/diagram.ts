/*
 * The front of a flashcard: a neck diagram with exactly one dot on it.
 *
 * Deliberately the same ASCII grammar as the songbook's chord shapes
 * (`src/utils/chordDiagram.ts`) — same 4-character row prefix, same `---+` cells, so the fret
 * numbers land on the same columns and the two read as one notation. It is not the same
 * function because a chord and a note disagree about every string but one: a chord marks the
 * five it does not use (`✕`/`○`), a note card must leave them blank, or the card answers a
 * question it did not ask.
 *
 * The window is five frets wide rather than the whole neck. Thirteen frets is 56 characters,
 * which no phone renders without either shrinking the glyphs past reading or scrolling the
 * answer off-screen — and the fret numbers are printed either way, so a window asks exactly
 * the same question.
 */

import { MAX_FRET, STRING_COUNT, STRING_LABELS } from './notes';

export const WINDOW_SPAN = 5;

export interface FretWindow {
  lo: number;
  hi: number;
}

/**
 * Which frets to draw for a card on `fret`.
 *
 * Deterministic, so a card looks the same every time it comes round: the dot keeps its place
 * in the frame and the position is learnt as a shape, not re-read as a fresh puzzle. The
 * target sits third from the left wherever the neck allows it, and the window is clamped into
 * the neck at both ends. Fret 0 has no cell of its own — the dot goes on the nut — so it
 * simply borrows the window that starts the neck.
 */
export function fretWindow(fret: number, span = WINDOW_SPAN, maxFret = MAX_FRET): FretWindow {
  const highestStart = Math.max(1, maxFret - span + 1);
  const lo = Math.min(Math.max(fret - 2, 1), highestStart);
  return { lo, hi: lo + span - 1 };
}

export interface DiagramOptions {
  span?: number;
  maxFret?: number;
  // Whether to print the string letters down the left edge. On is how every chord chart is
  // drawn, and reading up from a known open string is how the neck is actually navigated.
  // Off is the harder deck: the row's identity has to be held in your head.
  stringLabels?: boolean;
}

/**
 * Render the card front as lines of text.
 *
 * The dot is `●` — the one character the renderer treats as ink, which is what lets the
 * component paint it without knowing anything else about the layout.
 */
export function renderNoteDiagram(
  stringIndex: number,
  fret: number,
  options: DiagramOptions = {}
): string[] {
  const { span = WINDOW_SPAN, maxFret = MAX_FRET, stringLabels = true } = options;
  const window = fretWindow(fret, span, maxFret);
  const numCols = window.hi - window.lo + 1;

  // Row prefix is `X y ` — letter, space, nut marker, space — so the first `+` lands on
  // column 8 and every fret number can be right-aligned to a multiple of 4 after it.
  const header = Array.from({ length: numCols }).reduce<string>((acc, _, i) => {
    const label = String(window.lo + i);
    const targetCol = 8 + i * 4;
    return acc.padEnd(targetCol - label.length) + label;
  }, '');

  const lines = [header];

  for (let row = 0; row < STRING_COUNT; row++) {
    // Drawn high string first, the way a chart is read.
    const string = STRING_COUNT - 1 - row;
    const isTarget = string === stringIndex;
    const letter = stringLabels ? STRING_LABELS[string] : ' ';
    const nut = isTarget && fret === 0 ? '●' : ' ';

    let body = '';
    for (let i = 0; i < numCols; i++) {
      body += '---' + (isTarget && window.lo + i === fret ? '●' : '+');
    }
    body += '---';

    lines.push(`${letter} ${nut} ${body}`);
  }

  return lines;
}
