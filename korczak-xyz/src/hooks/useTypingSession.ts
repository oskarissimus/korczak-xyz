import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activeTypingMs, computeAccuracy, computeWpm } from '../utils/typing/metrics';
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
import { createDefaultProgress, normalizeProgress } from '../utils/typing/types';
import type { Book, TypingEvent, TypingProgress, TypingSession } from '../utils/typing/types';

export type CharStatus = 'correct' | 'incorrect' | 'current' | 'pending';

const SESSION_SAVE_DEBOUNCE_MS = 800;
const CLOUD_SAVE_DEBOUNCE_MS = 2000;
// Cloud progress: trailing save after the user stops typing, but never let more
// than this elapse during continuous typing without checkpointing to the cloud.
const CLOUD_PROGRESS_DEBOUNCE_MS = 1500;
const CLOUD_PROGRESS_MAX_WAIT_MS = 3000;
// Idle this long with no keystroke and the session auto-pauses (abandoned).
const IDLE_PAUSE_MS = 20000;
// A gap longer than this since the last keystroke ends the current session; the
// next keystroke starts a fresh one (a new sitting, not a continuation).
const SESSION_ROTATE_GAP_MS = 15 * 60 * 1000;

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
  durationMs: number;
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

  // Pause state (manual button, auto-idle, or browsing). Mirrored to a ref so
  // the input handlers can read it without re-subscribing.
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

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
  // Latest progress, read inside unload handlers without re-subscribing.
  const progressRef = useRef<TypingProgress>(progress);
  progressRef.current = progress;
  // Gate: no cloud-progress write may happen until the initial reconcile has
  // compared local vs cloud, so mount can't upload stale local over a newer cloud.
  const cloudReadyRef = useRef(false);
  // When the last cloud-progress write happened, to bound the checkpoint interval.
  const lastCloudProgressAtRef = useRef(0);

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
    // Hold off until reconcile has run, so we never clobber a newer cloud on mount.
    if (!userRef.current || !cloudReadyRef.current) return;
    const flush = () => {
      if (cloudProgressTimerRef.current) {
        clearTimeout(cloudProgressTimerRef.current);
        cloudProgressTimerRef.current = null;
      }
      lastCloudProgressAtRef.current = Date.now();
      const u = userRef.current;
      if (u) void saveCloudProgress(u.uid, p);
    };
    // Checkpoint immediately if we've gone too long without a write (covers
    // continuous typing, where a pure trailing debounce would never fire).
    if (Date.now() - lastCloudProgressAtRef.current >= CLOUD_PROGRESS_MAX_WAIT_MS) {
      flush();
      return;
    }
    // Otherwise (re)arm the trailing save; it captures the latest `p` because the
    // persist effect calls this on every progress change.
    if (cloudProgressTimerRef.current) clearTimeout(cloudProgressTimerRef.current);
    cloudProgressTimerRef.current = setTimeout(flush, CLOUD_PROGRESS_DEBOUNCE_MS);
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
    // Also push the latest progress to the cloud (best-effort) so a refresh/close
    // doesn't leave the cloud stuck behind the pending trailing debounce. Gated
    // on reconcile so we never upload stale local over a newer cloud.
    const u = userRef.current;
    if (u && cloudReadyRef.current) {
      if (cloudProgressTimerRef.current) {
        clearTimeout(cloudProgressTimerRef.current);
        cloudProgressTimerRef.current = null;
      }
      lastCloudProgressAtRef.current = Date.now();
      void saveCloudProgress(u.uid, progressRef.current);
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

  // If more than SESSION_ROTATE_GAP_MS has elapsed since the last keystroke, end
  // the current session and start a fresh one, so a long absence is recorded as a
  // separate sitting rather than folded into the old session. Called before the
  // next event is timed, so that event lands at ~t=0 in the new session.
  const maybeRotateSession = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.events.length === 0) return;
    const lastWall = s.startedAt + s.events[s.events.length - 1].t;
    if (Date.now() - lastWall <= SESSION_ROTATE_GAP_MS) return;
    flushSession();
    archiveCurrentSession();
    sessionRef.current = newSession(book.id, progressRef.current);
  }, [flushSession, book.id]);

  // Persist progress whenever it changes (localStorage always; cloud if signed in).
  useEffect(() => {
    saveProgress(progress);
    scheduleCloudProgress(progress);
  }, [progress, scheduleCloudProgress]);

  // On sign-in, reconcile local and cloud once. The fresher of the two (by
  // `lastPlayedAt`) wins: adopt cloud if it's newer, otherwise keep local and push
  // it up. A stale cloud must never clobber fresher local progress on refresh.
  const syncedUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) {
      syncedUidRef.current = null;
      cloudReadyRef.current = false;
      return;
    }
    if (syncedUidRef.current === user.uid) return;
    syncedUidRef.current = user.uid;
    cloudReadyRef.current = false;

    let cancelled = false;
    (async () => {
      try {
        const cloud = await loadCloudProgress(user.uid, book.id);
        if (cancelled) return;
        const local = loadProgress(book.id);
        if (cloud) {
          // Merge over defaults so pre-existing docs without `typedHistory` don't
          // arrive undefined.
          const normalizedCloud = normalizeProgress({ ...createDefaultProgress(book.id), ...cloud });
          const cloudTime = normalizedCloud.lastPlayedAt ?? 0;
          const localTime = local.lastPlayedAt ?? 0;
          // Tie-break equal timestamps by whichever holds more progress.
          const cloudWins =
            cloudTime > localTime ||
            (cloudTime === localTime &&
              (normalizedCloud.passageIndex > local.passageIndex ||
                (normalizedCloud.passageIndex === local.passageIndex &&
                  normalizedCloud.totalKeystrokes > local.totalKeystrokes)));
          if (cloudWins) {
            saveProgress(normalizedCloud);
            setProgress(normalizedCloud);
          } else if (isNonTrivialProgress(local)) {
            // Local is fresher — keep it and bring the cloud up to date.
            await saveCloudProgress(user.uid, local);
          }
        } else {
          // Fresh cloud: migrate whatever is stored locally, once.
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
      } finally {
        // Cloud-progress writes are unblocked once we've compared the two sides.
        // Stamp the checkpoint clock so the next keystroke doesn't redundantly
        // re-upload what reconcile just settled.
        if (!cancelled) {
          lastCloudProgressAtRef.current = Date.now();
          cloudReadyRef.current = true;
        }
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
      maybeRotateSession(); // a long absence starts a new session
      if (isPausedRef.current) setIsPaused(false); // typing resumes the session
      setProgress((prev) => {
        if (prev.passageIndex >= passages.length) return prev;
        const current = passages[prev.passageIndex];
        const pos = prev.typed.length;
        if (pos > current.length) return prev;

        const lastPlayedAt = Date.now();

        if (pos === current.length) {
          // The trailing newline (Enter) slot. Like any other slot, any key
          // advances the caret: Enter is correct, anything else records a red
          // mistake there — then we move on to the next section.
          const correct = ch === '\n';
          pushEvent({ t: now(), kind: 'char', data: ch, correct });
          const totalKeystrokes = prev.totalKeystrokes + 1;
          const correctKeystrokes = prev.correctKeystrokes + (correct ? 1 : 0);
          // Section complete: advance, retaining what was typed (including this
          // terminal char, so a wrong Enter shows red on the finished section).
          // Assign by index (not push) so it lands at the right slot even when
          // resuming deep in a book with a sparse/empty history.
          const wpm = sessionRef.current ? computeWpm(sessionRef.current.events) : 0;
          const typedHistory = prev.typedHistory.slice();
          typedHistory[prev.passageIndex] = prev.typed + ch;
          return {
            ...prev,
            passageIndex: prev.passageIndex + 1,
            typed: '',
            typedHistory,
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
    [passages, now, pushEvent, maybeRotateSession]
  );

  const handleBackspace = useCallback(() => {
    maybeRotateSession(); // a long absence starts a new session
    if (isPausedRef.current) setIsPaused(false); // typing resumes the session
    setProgress((prev) => {
      if (prev.typed.length > 0) {
        pushEvent({ t: now(), kind: 'backspace' });
        return { ...prev, typed: prev.typed.slice(0, -1), lastPlayedAt: Date.now() };
      }
      // At the start of a section: backspace crosses into the previous one.
      if (prev.passageIndex === 0) return prev;
      const prevIndex = prev.passageIndex - 1;
      // Restore what was typed there (falls back to the source text for legacy
      // progress), dropping the stored terminal newline char so the caret lands
      // on that section's newline slot. Its body errors reappear.
      const stored = prev.typedHistory[prevIndex];
      const restored =
        stored != null ? stored.slice(0, passages[prevIndex].length) : passages[prevIndex];
      pushEvent({ t: now(), kind: 'backspace' });
      return {
        ...prev,
        passageIndex: prevIndex,
        typed: restored,
        typedHistory: prev.typedHistory.slice(0, prevIndex),
        completedPassages: Math.max(0, prev.completedPassages - 1),
        lastPlayedAt: Date.now(),
      };
    });
  }, [passages, now, pushEvent, maybeRotateSession]);

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
  const durationMs = sessionRef.current ? activeTypingMs(sessionRef.current.events) : 0;

  const charStatuses = useMemo<CharStatus[]>(() => {
    // One extra slot past the passage for the trailing newline (Enter) the user
    // must type to advance; compare against `passage + '\n'`.
    const expected = passage + '\n';
    const statuses: CharStatus[] = [];
    for (let i = 0; i < expected.length; i++) {
      if (i < typed.length) {
        statuses.push(typed[i] === expected[i] ? 'correct' : 'incorrect');
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
    durationMs,
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
