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
  completedPassages: number;
  totalKeystrokes: number;
  correctKeystrokes: number;
  bestWpm: number;
  lastPlayedAt: number | null;
}

export function createDefaultProgress(bookId: string): TypingProgress {
  return {
    bookId,
    passageIndex: 0,
    typed: '',
    completedPassages: 0,
    totalKeystrokes: 0,
    correctKeystrokes: 0,
    bestWpm: 0,
    lastPlayedAt: null,
  };
}
