// Touch-Typing Trainer types

// A book parsed into typeable passages.
export interface Book {
  id: string; // e.g. 'krasnoludek'
  title: string;
  author: string;
  passages: string[]; // normalized, in reading order
}

// One recorded keystroke event, offset in ms from the session start.
export type TypingEventKind = 'char' | 'backspace';

export interface TypingEvent {
  t: number; // ms since session.startedAt
  kind: TypingEventKind;
  data?: string; // the character, for 'char' events
  correct?: boolean; // whether it matched the expected char at the cursor
}

// One practice sitting: an append-only event log plus where it began.
export interface TypingSession {
  id: string; // crypto.randomUUID()
  bookId: string;
  startedAt: number; // epoch ms
  endedAt: number | null;
  startPassageIndex: number;
  startCharIndex: number;
  events: TypingEvent[];
}

// Persisted progress: the resume point plus lifetime stats.
export interface TypingProgress {
  bookId: string;
  passageIndex: number; // current passage
  typed: string; // partial text typed into the current passage (for exact resume)
  typedHistory: string[]; // index-aligned with passages: exact chars typed for each completed passage (the implied trailing '\n' is NOT stored)
  completedPassages: number;
  totalKeystrokes: number;
  correctKeystrokes: number;
  bestWpm: number;
  /*
   * Lifetime time spent typing this book, and the keystrokes that time was measured over.
   *
   * `totalTimeMs` is *active* typing time - the gap before each keystroke, capped at 3s (see
   * activeGapMs) - so it is the same measurement WPM divides by and the stats page charts,
   * and walking away from the keyboard adds three seconds rather than an afternoon.
   *
   * The two are a pair and are read as a ratio: they give the reader's realised pace, which
   * is what turns "42% done" into "about 6h 40m left". `totalKeystrokes` cannot play that
   * part even though it counts the same events. It predates this clock, so every record that
   * already exists carries a large one against a `totalTimeMs` of zero - a pace of infinity,
   * for exactly the readers with the most history, and one that never washes out. A counter
   * minted alongside the clock is consistent with it from its first keystroke.
   */
  totalTimeMs: number;
  timedKeystrokes: number;
  lastPlayedAt: number | null;
  // Sync lineage. `rev` counts revisions of this book's progress on whichever device
  // produced them, and only ever increases; `writerId` names that device. Together with the
  // locally-stored bookmark of the last revision known to have come from the cloud (see
  // syncBookmark.ts), they answer the question `lastPlayedAt` never could: is the other side
  // stale, or has it genuinely branched? Wall-clock times cannot tell those apart - two
  // devices can both be "newer" than each other's last-seen state.
  rev: number;
  writerId: string;
  updatedAt: number | null; // when this revision was written (distinct from lastPlayedAt)
}

// `typedHistory` must stay index-aligned with the passages (entry j = what was
// typed for completed passage j), so its length always equals `passageIndex`.
// Any other length means the array predates this invariant — legacy progress
// with no history, or an early build that appended instead of index-assigning
// (which mis-filed entries when resuming deep in a book). Drop it in that case;
// it re-aligns from the current position on the next completed section.
function nonNegative(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeProgress(progress: TypingProgress): TypingProgress {
  // Progress written before the lineage fields existed arrives without them. Treat it as
  // revision 0 from an unknown writer rather than rejecting it; reconcile() has a dedicated
  // path for comparing two sides where at least one has no usable lineage.
  const withLineage: TypingProgress = {
    ...progress,
    rev: typeof progress.rev === 'number' && progress.rev >= 0 ? progress.rev : 0,
    writerId: typeof progress.writerId === 'string' ? progress.writerId : '',
    updatedAt: typeof progress.updatedAt === 'number' ? progress.updatedAt : null,
    // Progress written before the book clock existed arrives without it. Defaulted here as
    // well as by loadProgress's spread, because a record pulled from Firestore reaches
    // normalizeProgress without passing through that spread, and a NaN would propagate
    // through every later addition.
    totalTimeMs: nonNegative(progress.totalTimeMs),
    timedKeystrokes: nonNegative(progress.timedKeystrokes),
  };
  if (
    !Array.isArray(withLineage.typedHistory) ||
    withLineage.typedHistory.length !== withLineage.passageIndex
  ) {
    return { ...withLineage, typedHistory: [] };
  }
  return withLineage;
}

export function createDefaultProgress(bookId: string): TypingProgress {
  return {
    bookId,
    passageIndex: 0,
    typed: '',
    typedHistory: [],
    completedPassages: 0,
    totalKeystrokes: 0,
    correctKeystrokes: 0,
    bestWpm: 0,
    totalTimeMs: 0,
    timedKeystrokes: 0,
    lastPlayedAt: null,
    rev: 0,
    writerId: '',
    updatedAt: null,
  };
}
