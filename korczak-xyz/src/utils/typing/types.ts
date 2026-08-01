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

// A char keystroke pulled off the live log for real-time display, with its time
// resolved to wall clock (unlike TypingEvent.t, which is session-relative).
export interface RecentChar {
  t: number; // epoch ms
  correct: boolean;
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
export function normalizeProgress(progress: TypingProgress): TypingProgress {
  // Progress written before the lineage fields existed arrives without them. Treat it as
  // revision 0 from an unknown writer rather than rejecting it; reconcile() has a dedicated
  // path for comparing two sides where at least one has no usable lineage.
  const withLineage: TypingProgress = {
    ...progress,
    rev: typeof progress.rev === 'number' && progress.rev >= 0 ? progress.rev : 0,
    writerId: typeof progress.writerId === 'string' ? progress.writerId : '',
    updatedAt: typeof progress.updatedAt === 'number' ? progress.updatedAt : null,
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
    lastPlayedAt: null,
    rev: 0,
    writerId: '',
    updatedAt: null,
  };
}
