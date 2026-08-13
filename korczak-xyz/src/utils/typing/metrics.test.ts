import { describe, expect, it } from 'vitest';
import { activeGapMs, bookTimeFromSessions } from './metrics';
import type { TypingEvent, TypingSession } from './types';

const BOOK = 'krasnoludek';

// A sitting whose keystrokes land at the given offsets from its start.
function session(
  id: string,
  bookId: string,
  offsets: number[],
  kind: TypingEvent['kind'] = 'char'
): TypingSession {
  return {
    id,
    bookId,
    startedAt: 1_000_000,
    endedAt: 1_000_000 + (offsets.at(-1) ?? 0),
    startPassageIndex: 0,
    startCharIndex: 0,
    events: offsets.map((t) => ({ t, kind, data: 'a', correct: true })),
  };
}

describe('activeGapMs', () => {
  it('credits nothing to the first keystroke of a stretch', () => {
    expect(activeGapMs(null, 5_000)).toBe(0);
  });

  it('credits an ordinary gap in full', () => {
    expect(activeGapMs(1_000, 1_250)).toBe(250);
  });

  it('caps an idle stretch', () => {
    expect(activeGapMs(0, 20 * 60 * 1000)).toBe(3_000);
  });

  // Clocks can step backwards (NTP, a suspended laptop). A negative gap must not subtract
  // from a total that is only ever meant to grow.
  it('never returns a negative gap', () => {
    expect(activeGapMs(5_000, 4_000)).toBe(0);
  });
});

describe('bookTimeFromSessions', () => {
  it('sums the gaps inside a sitting', () => {
    const sessions = [session('a', BOOK, [0, 200, 500, 900])];
    expect(bookTimeFromSessions(sessions, BOOK)).toEqual({
      totalTimeMs: 900,
      timedKeystrokes: 4,
    });
  });

  /*
   * The whole point of summing per sitting. These two sittings are an hour apart; measured
   * across the join, the second would open with an hour-long gap and report the reader as
   * having typed through the night.
   */
  it('never counts the time between two sittings', () => {
    const morning = session('a', BOOK, [0, 300, 600]);
    const evening: TypingSession = {
      ...session('b', BOOK, [0, 400, 800]),
      startedAt: morning.startedAt + 12 * 60 * 60 * 1000,
    };
    expect(bookTimeFromSessions([morning, evening], BOOK)).toEqual({
      totalTimeMs: 600 + 800,
      timedKeystrokes: 6,
    });
  });

  it('caps an idle stretch inside a sitting, as the live counter does', () => {
    // A five-minute stare between two keystrokes is worth the 3s cap, not five minutes.
    const sessions = [session('a', BOOK, [0, 300_000])];
    expect(bookTimeFromSessions(sessions, BOOK).totalTimeMs).toBe(3_000);
  });

  it("ignores another book's sittings", () => {
    const sessions = [session('a', BOOK, [0, 500]), session('b', 'opowiesc-wigilijna', [0, 900])];
    expect(bookTimeFromSessions(sessions, BOOK)).toEqual({
      totalTimeMs: 500,
      timedKeystrokes: 2,
    });
  });

  it('counts characters and not backspaces, matching what the live counter banks', () => {
    const typed = session('a', BOOK, [0, 100, 200]);
    typed.events.push({ t: 300, kind: 'backspace' });
    expect(bookTimeFromSessions([typed], BOOK).timedKeystrokes).toBe(3);
  });

  it('is zero when the book has no sittings', () => {
    expect(bookTimeFromSessions([], BOOK)).toEqual({ totalTimeMs: 0, timedKeystrokes: 0 });
  });
});
