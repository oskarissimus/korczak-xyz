import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeAccuracy, computeWpm } from '../utils/typing/metrics';
import {
  archiveCurrentSession,
  exportLogToJSON,
  importLogFromJSON,
  isNonTrivialProgress,
  loadAllSessions,
  loadProgress,
  resetProgress as resetProgressStorage,
  saveCurrentSession,
  saveProgress,
} from '../utils/typing/storage';
import { loadCloudProgress, saveCloudProgress, saveCloudSession } from '../utils/typing/cloudStorage';
import type { AuthUser } from './useAuth';
import { createDefaultProgress } from '../utils/typing/types';
import type { Book, TypingEvent, TypingProgress, TypingSession } from '../utils/typing/types';

export type CharStatus = 'correct' | 'incorrect' | 'current' | 'pending';

const SESSION_SAVE_DEBOUNCE_MS = 800;
const CLOUD_SAVE_DEBOUNCE_MS = 2000;
// Idle this long with no keystroke and the session auto-pauses (abandoned).
const IDLE_PAUSE_MS = 20000;

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
  isPaused: boolean;
  pause: () => void;
  resume: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  focusInput: () => void;
  resetProgress: () => void;
  exportLog: () => void;
  importLog: (json: string) => { success: boolean; sessionCount: number; error?: string };
}

export function useTypingSession(user: AuthUser | null, book: Book): TypingSessionApi {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [progress, setProgress] = useState<TypingProgress>(() => loadProgress(book.id));
  // Latest committed progress, read from the input handlers without re-subscribing.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  // Pause state (manual button, auto-idle, or browsing). Mirrored to a ref so
  // the input handlers can read it without re-subscribing.
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

  // A wrong key pressed while parked on the section-ending newline slot flashes
  // the ↵ red (it dings accuracy but does not advance). Cleared on any progress.
  const [boundaryError, setBoundaryError] = useState(false);
  const boundaryErrorRef = useRef(false);
  boundaryErrorRef.current = boundaryError;

  // The live session log lives in a ref: it mutates on every keystroke and we
  // don't want to re-render for it. It is persisted (debounced) to localStorage.
  const sessionRef = useRef<TypingSession | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-pause countdown, reset on every keystroke.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest user, read inside debounced callbacks without re-subscribing.
  const userRef = useRef<AuthUser | null>(user);
  userRef.current = user;
  const cloudSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When signed in, mirror the live session to the cloud (debounced/coalesced).
  const scheduleCloudSession = useCallback(() => {
    if (!userRef.current || cloudSessionTimerRef.current) return;
    cloudSessionTimerRef.current = setTimeout(() => {
      cloudSessionTimerRef.current = null;
      const u = userRef.current;
      if (u && sessionRef.current) void saveCloudSession(u.uid, sessionRef.current);
    }, CLOUD_SAVE_DEBOUNCE_MS);
  }, []);

  const scheduleCloudProgress = useCallback((p: TypingProgress) => {
    if (!userRef.current) return;
    if (cloudProgressTimerRef.current) clearTimeout(cloudProgressTimerRef.current);
    cloudProgressTimerRef.current = setTimeout(() => {
      cloudProgressTimerRef.current = null;
      const u = userRef.current;
      if (u) void saveCloudProgress(u.uid, p);
    }, CLOUD_SAVE_DEBOUNCE_MS);
  }, []);

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
    if (sessionRef.current) {
      saveCurrentSession(sessionRef.current);
      const u = userRef.current;
      if (u) void saveCloudSession(u.uid, sessionRef.current);
    }
  }, []);

  const scheduleSessionSave = useCallback(() => {
    scheduleCloudSession();
    if (saveTimerRef.current) return; // already scheduled
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      if (sessionRef.current) saveCurrentSession(sessionRef.current);
    }, SESSION_SAVE_DEBOUNCE_MS);
  }, [scheduleCloudSession]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const pauseSession = useCallback(() => {
    if (isPausedRef.current) return; // already paused; keep it idempotent
    clearIdleTimer();
    setIsPaused(true);
    flushSession();
    // Note: the input keeps focus while paused so the next keystroke can
    // auto-resume the session (see handleChar / handleBackspace).
  }, [clearIdleTimer, flushSession]);

  const pause = useCallback(() => pauseSession(), [pauseSession]);

  const resume = useCallback(() => {
    setIsPaused(false);
    inputRef.current?.focus();
  }, []);

  // Restart the auto-pause countdown after activity.
  const bumpIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      pauseSession();
    }, IDLE_PAUSE_MS);
  }, [clearIdleTimer, pauseSession]);

  const pushEvent = useCallback(
    (event: TypingEvent) => {
      if (!sessionRef.current) return;
      sessionRef.current.events.push(event);
      scheduleSessionSave();
      bumpIdleTimer();
    },
    [scheduleSessionSave, bumpIdleTimer]
  );

  // Persist progress whenever it changes (localStorage always; cloud if signed in).
  useEffect(() => {
    saveProgress(progress);
    scheduleCloudProgress(progress);
  }, [progress, scheduleCloudProgress]);

  // On sign-in, reconcile local and cloud once. If the cloud already has
  // progress, adopt it; otherwise upload local progress + logs (a fresh cloud).
  const syncedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) {
      syncedUidRef.current = null;
      return;
    }
    if (syncedUidRef.current === user.uid) return;
    syncedUidRef.current = user.uid;

    let cancelled = false;
    (async () => {
      try {
        const cloud = await loadCloudProgress(user.uid, book.id);
        if (cancelled) return;
        if (cloud) {
          // Cloud is the source of truth on this device from now on. Merge over
          // defaults so pre-existing docs without `typedHistory` don't arrive undefined.
          const normalized = { ...createDefaultProgress(book.id), ...cloud };
          saveProgress(normalized);
          setProgress(normalized);
        } else {
          // Fresh cloud: migrate whatever is stored locally, once.
          const local = loadProgress(book.id);
          if (isNonTrivialProgress(local)) {
            await saveCloudProgress(user.uid, local);
            for (const s of loadAllSessions()) {
              if (cancelled) return;
              await saveCloudSession(user.uid, s);
            }
          }
        }
      } catch {
        // Network/permission errors: keep working locally.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, book.id]);

  // Clear cloud debounce and idle timers on unmount.
  useEffect(() => {
    return () => {
      if (cloudSessionTimerRef.current) clearTimeout(cloudSessionTimerRef.current);
      if (cloudProgressTimerRef.current) clearTimeout(cloudProgressTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

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
      if (isPausedRef.current) setIsPaused(false); // typing resumes the session
      // Flash the ↵ red when a non-Enter key lands on the newline slot; clear it
      // once the user makes any real progress. Derived from committed progress.
      const lp = progressRef.current;
      if (lp.passageIndex < passages.length) {
        const atNewline = lp.typed.length === passages[lp.passageIndex].length;
        if (atNewline && ch !== '\n') setBoundaryError(true);
        else if (boundaryErrorRef.current) setBoundaryError(false);
      }
      setProgress((prev) => {
        if (prev.passageIndex >= passages.length) return prev;
        const current = passages[prev.passageIndex];
        const pos = prev.typed.length;
        if (pos > current.length) return prev;

        const lastPlayedAt = Date.now();

        if (pos === current.length) {
          // Caret is on the trailing newline slot: only Enter advances.
          const correct = ch === '\n';
          pushEvent({ t: now(), kind: 'char', data: ch, correct });
          const totalKeystrokes = prev.totalKeystrokes + 1;
          const correctKeystrokes = prev.correctKeystrokes + (correct ? 1 : 0);
          if (!correct) {
            // Wrong key on the newline slot: count the mistake but stay put.
            return { ...prev, totalKeystrokes, correctKeystrokes, lastPlayedAt };
          }
          // Section complete: advance, retaining what was typed so its errors persist.
          const wpm = sessionRef.current ? computeWpm(sessionRef.current.events) : 0;
          return {
            ...prev,
            passageIndex: prev.passageIndex + 1,
            typed: '',
            typedHistory: [...prev.typedHistory, prev.typed],
            completedPassages: prev.completedPassages + 1,
            totalKeystrokes,
            correctKeystrokes,
            bestWpm: Math.max(prev.bestWpm, wpm),
            lastPlayedAt,
          };
        }

        // Normal character slot.
        const expected = current[pos];
        const correct = ch === expected;
        pushEvent({ t: now(), kind: 'char', data: ch, correct });
        const totalKeystrokes = prev.totalKeystrokes + 1;
        const correctKeystrokes = prev.correctKeystrokes + (correct ? 1 : 0);
        // Typing the last real char just parks the caret on the newline slot; it
        // does NOT auto-advance — the user must press Enter (see above).
        return { ...prev, typed: prev.typed + ch, totalKeystrokes, correctKeystrokes, lastPlayedAt };
      });
    },
    [passages, now, pushEvent]
  );

  const handleBackspace = useCallback(() => {
    if (isPausedRef.current) setIsPaused(false); // typing resumes the session
    if (boundaryErrorRef.current) setBoundaryError(false);
    setProgress((prev) => {
      if (prev.typed.length > 0) {
        pushEvent({ t: now(), kind: 'backspace' });
        return { ...prev, typed: prev.typed.slice(0, -1) };
      }
      // At the start of a section: backspace crosses into the previous one.
      if (prev.passageIndex === 0) return prev;
      const prevIndex = prev.passageIndex - 1;
      // Restore exactly what was typed there (falls back to the source text for
      // legacy progress that predates typedHistory), so its errors reappear and
      // the caret lands on that section's trailing newline slot.
      const restored = prev.typedHistory[prevIndex] ?? passages[prevIndex];
      pushEvent({ t: now(), kind: 'backspace' });
      return {
        ...prev,
        passageIndex: prevIndex,
        typed: restored,
        typedHistory: prev.typedHistory.slice(0, prevIndex),
        completedPassages: Math.max(0, prev.completedPassages - 1),
      };
    });
  }, [passages, now, pushEvent]);

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
      } else if (e.key === 'Enter') {
        // A `type="text"` input never emits a usable insertLineBreak, so the
        // section-ending newline is captured here and fed in as a normal char.
        e.preventDefault();
        handleChar('\n');
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
    setBoundaryError(false);
    focusInput();
  }, [book.id, flushSession, focusInput]);

  const exportLog = useCallback(() => {
    flushSession();
    const json = exportLogToJSON(book.id);
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
    // One extra slot past the passage for the trailing newline (Enter) the user
    // must type to advance; compare against `passage + '\n'`.
    const expected = passage + '\n';
    const statuses: CharStatus[] = [];
    for (let i = 0; i < expected.length; i++) {
      if (i < typed.length) {
        statuses.push(typed[i] === expected[i] ? 'correct' : 'incorrect');
      } else if (i === typed.length) {
        // The caret slot; if it's the newline slot and the user just mis-hit it,
        // show it red instead of the plain caret.
        statuses.push(boundaryError && i === passage.length ? 'incorrect' : 'current');
      } else {
        statuses.push('pending');
      }
    }
    return statuses;
  }, [passage, typed, boundaryError]);

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
    isPaused,
    pause,
    resume,
    inputRef,
    focusInput,
    resetProgress,
    exportLog,
    importLog,
  };
}
