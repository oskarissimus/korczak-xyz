/*
 * How much of a book is left, and how long that is likely to take.
 *
 * Pure: no clock and no React, so the whole thing is reachable from a test. The practice
 * screen's footer is the only caller.
 */
import type { TypingProgress } from './types';

// Below this, the pace measured so far is a handful of keystrokes and the estimate it
// produces swings by hours between sections. A few sentences in, it settles.
export const MIN_KEYSTROKES_FOR_ESTIMATE = 200;

// Every section is finished by typing its text and then Enter, so the typeable length of a
// section is one more than its text (see the newline slot in useTypingSession's handleChar).
export function typeableChars(passages: string[]): number {
  let total = 0;
  for (const passage of passages) total += passage.length + 1;
  return total;
}

// How much of that has been covered: the finished sections in full, plus what is typed into
// the current one. Mistakes advance the caret here as correct characters do, so this is a
// position in the book rather than a count of things typed correctly.
export function charsCovered(passages: string[], progress: TypingProgress): number {
  const finished = Math.min(progress.passageIndex, passages.length);
  let covered = 0;
  for (let i = 0; i < finished; i++) covered += passages[i].length + 1;
  return covered + progress.typed.length;
}

interface RemainingInput {
  remainingChars: number;
  totalTimeMs: number;
  timedKeystrokes: number;
}

/*
 * Time left, from the reader's own realised pace in this book: the characters still ahead
 * divided by the characters-per-millisecond that `totalTimeMs` and `timedKeystrokes` record
 * between them.
 *
 * `null` rather than a number whenever the answer would be invented — before there are enough
 * keystrokes to measure a pace, and once the book is finished. The caller renders nothing at
 * all in that case; a placeholder dash on the progress line would be a fourth thing to read
 * that says less than the absence does.
 *
 * The estimate runs slightly fast. A character typed twice - wrong, backspaced, retyped -
 * counts twice in `timedKeystrokes` but once in the characters remaining, so a
 * corrections-heavy reader arrives a few percent after being told they would. That is well
 * inside what the `~` in front of the number is claiming.
 */
export function estimateRemainingMs({
  remainingChars,
  totalTimeMs,
  timedKeystrokes,
}: RemainingInput): number | null {
  if (remainingChars <= 0) return null;
  if (totalTimeMs <= 0) return null;
  if (timedKeystrokes < MIN_KEYSTROKES_FOR_ESTIMATE) return null;
  const charsPerMs = timedKeystrokes / totalTimeMs;
  if (charsPerMs <= 0) return null;
  return remainingChars / charsPerMs;
}
