import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOOK } from '../utils/typing/book';
import { computeAccuracy, computeWpm } from '../utils/typing/metrics';
import {
  archiveCurrentSession,
  exportLogToJSON,
  importLogFromJSON,
  loadProgress,
  resetProgress as resetProgressStorage,
  saveCurrentSession,
  saveProgress,
} from '../utils/typing/storage';
import type { Book, TypingEvent, TypingProgress, TypingSession } from '../utils/typing/types';

export type CharStatus = 'correct' | 'incorrect' | 'current' | 'pending';

const SESSION_SAVE_DEBOUNCE_MS = 800;

function newSession(bookId: string, progress: TypingProgress): TypingSession {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    bookId,
    startedAt: Date.now(),
    endedAt: null,
    startPassageIndex: progress.passageIndex,
    startCharIndex: progress.typed.length,
    events: [],
  };
}

export interface TypingSessionApi {
  book: Book;
  passage: string;
  typed: string;
  cursorIndex: number;
  charStatuses: CharStatus[];
  progress: TypingProgress;
  wpm: number;
  accuracy: number;
  progressPercent: number;
  isFinished: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  focusInput: () => void;
  resetProgress: () => void;
  skipPassage: () => void;
  exportLog: () => void;
  importLog: (json: string) => { success: boolean; sessionCount: number; error?: string };
}

export function useTypingSession(): TypingSessionApi {
  const book = BOOK;
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [progress, setProgress] = useState<TypingProgress>(() => loadProgress(book.id));

  // The live session log lives in a ref: it mutates on every keystroke and we
  // don't want to re-render for it. It is persisted (debounced) to localStorage.
  const sessionRef = useRef<TypingSession | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start a fresh session on mount, archiving any previous one.
  useEffect(() => {
    archiveCurrentSession();
    sessionRef.current = newSession(book.id, loadProgress(book.id));
    return () => {
      flushSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flushSession = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (sessionRef.current) saveCurrentSession(sessionRef.current);
  }, []);

  const scheduleSessionSave = useCallback(() => {
    if (saveTimerRef.current) return; // already scheduled
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      if (sessionRef.current) saveCurrentSession(sessionRef.current);
    }, SESSION_SAVE_DEBOUNCE_MS);
  }, []);

  const pushEvent = useCallback(
    (event: TypingEvent) => {
      if (!sessionRef.current) return;
      sessionRef.current.events.push(event);
      scheduleSessionSave();
    },
    [scheduleSessionSave]
  );

  // Persist progress whenever it changes.
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // Flush the session log if the tab is hidden or closed.
  useEffect(() => {
    const onHide = () => flushSession();
    window.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flushSession]);

  const passages = book.passages;
  const isFinished = progress.passageIndex >= passages.length;
  const passage = isFinished ? '' : passages[progress.passageIndex];
  const typed = progress.typed;

  const now = useCallback(() => {
    const start = sessionRef.current?.startedAt ?? Date.now();
    return Date.now() - start;
  }, []);

  const handleChar = useCallback(
    (ch: string) => {
      setProgress((prev) => {
        if (prev.passageIndex >= passages.length) return prev;
        const current = passages[prev.passageIndex];
        const pos = prev.typed.length;
        if (pos >= current.length) return prev;

        const expected = current[pos];
        const correct = ch === expected;
        pushEvent({ t: now(), kind: 'char', data: ch, correct });

        const nextTyped = prev.typed + ch;
        const totalKeystrokes = prev.totalKeystrokes + 1;
        const correctKeystrokes = prev.correctKeystrokes + (correct ? 1 : 0);
        const lastPlayedAt = Date.now();

        if (nextTyped.length === current.length) {
          // Passage complete: advance and record best WPM.
          const wpm = sessionRef.current ? computeWpm(sessionRef.current.events) : 0;
          return {
            ...prev,
            passageIndex: prev.passageIndex + 1,
            typed: '',
            completedPassages: prev.completedPassages + 1,
            totalKeystrokes,
            correctKeystrokes,
            bestWpm: Math.max(prev.bestWpm, wpm),
            lastPlayedAt,
          };
        }

        return { ...prev, typed: nextTyped, totalKeystrokes, correctKeystrokes, lastPlayedAt };
      });
    },
    [passages, now, pushEvent]
  );

  const handleBackspace = useCallback(() => {
    setProgress((prev) => {
      if (prev.typed.length === 0) return prev;
      pushEvent({ t: now(), kind: 'backspace' });
      return { ...prev, typed: prev.typed.slice(0, -1) };
    });
  }, [now, pushEvent]);

  // Input capture: characters via `beforeinput` (composed diacritics arrive as a
  // single insertText), Backspace via `keydown` (fires even on an empty input).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      e.preventDefault(); // keep the hidden input empty
      if (ie.inputType === 'insertText' || ie.inputType === 'insertFromPaste') {
        const data = ie.data ?? '';
        for (const ch of data) handleChar(ch);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      }
    };

    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [handleChar, handleBackspace]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Focus the input on mount so typing works immediately.
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  const resetProgress = useCallback(() => {
    flushSession();
    archiveCurrentSession();
    const fresh = resetProgressStorage(book.id);
    sessionRef.current = newSession(book.id, fresh);
    setProgress(fresh);
    focusInput();
  }, [book.id, flushSession, focusInput]);

  const skipPassage = useCallback(() => {
    setProgress((prev) => {
      if (prev.passageIndex >= passages.length) return prev;
      return { ...prev, passageIndex: prev.passageIndex + 1, typed: '' };
    });
    focusInput();
  }, [passages.length, focusInput]);

  const exportLog = useCallback(() => {
    flushSession();
    const json = exportLogToJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `typing-log-${book.id}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [book.id, flushSession]);

  const importLog = useCallback((json: string) => importLogFromJSON(json), []);

  // Derived, recomputed each render (i.e. each keystroke) from the live log.
  const wpm = sessionRef.current ? computeWpm(sessionRef.current.events) : 0;
  const accuracy = sessionRef.current ? computeAccuracy(sessionRef.current.events) : 100;

  const charStatuses = useMemo<CharStatus[]>(() => {
    const statuses: CharStatus[] = [];
    for (let i = 0; i < passage.length; i++) {
      if (i < typed.length) {
        statuses.push(typed[i] === passage[i] ? 'correct' : 'incorrect');
      } else if (i === typed.length) {
        statuses.push('current');
      } else {
        statuses.push('pending');
      }
    }
    return statuses;
  }, [passage, typed]);

  const progressPercent = passages.length === 0 ? 0 : (progress.passageIndex / passages.length) * 100;

  return {
    book,
    passage,
    typed,
    cursorIndex: typed.length,
    charStatuses,
    progress,
    wpm,
    accuracy,
    progressPercent,
    isFinished,
    inputRef,
    focusInput,
    resetProgress,
    skipPassage,
    exportLog,
    importLog,
  };
}
