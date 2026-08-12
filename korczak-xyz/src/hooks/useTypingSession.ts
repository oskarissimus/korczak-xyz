import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClientId } from '../lib/clientId';
import { describeError, log } from '../lib/logger';
import { activeGapMs, computeAccuracy, computeWpm } from '../utils/typing/metrics';
import { charsCovered, estimateRemainingMs, typeableChars } from '../utils/typing/estimate';
import {
  archiveCurrentSession,
  exportLogToJSON,
  importLogFromJSON,
  loadAllSessions,
  loadProgress,
  removeArchivedSessions,
  resetProgress as resetProgressStorage,
  saveCurrentSession,
  saveProgress,
  storageBytes,
} from '../utils/typing/storage';
import { loadBookmark } from '../utils/typing/syncBookmark';
import { saveCloudSession } from '../utils/typing/cloudStorage';
import { downloadJSON } from '../utils/typing/download';
import { bumpRevision } from '../utils/typing/reconcile';
import {
  ProgressSyncEngine,
  summarize,
  type SyncConflict,
  type SyncState,
} from '../utils/typing/syncEngine';
import type { AuthUser } from './useAuth';
import type { Book, TypingEvent, TypingProgress, TypingSession } from '../utils/typing/types';

export type CharStatus = 'correct' | 'incorrect' | 'current' | 'pending';

const SESSION_SAVE_DEBOUNCE_MS = 800;
const CLOUD_SAVE_DEBOUNCE_MS = 2000;
// Progress carries `typedHistory` - the whole book as typed so far - so persisting it is a
// couple of hundred kilobytes of serialize-and-write. Doing that per keystroke is both a
// main-thread cost and the quickest way to exhaust a storage budget with no headroom left.
const PROGRESS_SAVE_DEBOUNCE_MS = 500;
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
  durationMs: number; // this sitting's stopwatch
  timeSpentMs: number; // lifetime active typing time on this book
  remainingMs: number | null; // null until there is a pace to measure, and once finished
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
  // Cloud sync, for the status indicator and the conflict dialog.
  sync: SyncState;
  conflict: SyncConflict | null;
  resolveConflict: (choice: 'local' | 'cloud') => void;
  retrySync: () => void;
}

const NO_SYNC: SyncState = {
  status: 'disabled',
  lastSyncedAt: null,
  lastFailedAt: null,
  error: null,
  pendingWork: false,
  conflict: null,
};

export function useTypingSession(user: AuthUser | null, book: Book): TypingSessionApi {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [progress, setProgress] = useState<TypingProgress>(() => loadProgress(book.id));

  // Identifies this browser profile as the author of the revisions it writes, so two devices'
  // independent revision counters can never be mistaken for one another.
  const writerId = useMemo(() => getClientId(), []);
  // Stamp the next revision onto a progress value produced by a local edit.
  const edited = useCallback(
    (next: TypingProgress) => bumpRevision(next, writerId),
    [writerId]
  );

  // Pause state (manual button, auto-idle, or browsing). Mirrored to a ref so
  // the input handlers can read it without re-subscribing.
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

  // Live session stopwatch: real elapsed wall time while the session is active,
  // excluding paused stretches. `accumMs` holds completed active segments and
  // `segmentStart` is the wall clock at which the current running segment began
  // (null when stopped/paused). `isTiming` drives the 1s tick interval so the
  // displayed clock advances even between keystrokes.
  const durationAccumMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);
  const [isTiming, setIsTiming] = useState(false);
  const [, setDurationTick] = useState(0);

  // Wall clock of the previous character keystroke, for the book's lifetime clock on
  // `progress`. Only characters touch it: activeTypingMs measures the gaps between char
  // events and a backspace in between does not end one, so crediting backspaces here would
  // make the live total disagree with the same sitting replayed from its log. `null` means
  // the next keystroke starts a stretch and is credited nothing.
  const lastCharAtRef = useRef<number | null>(null);

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
  // Latest progress, read inside unload handlers and by the sync engine without
  // re-subscribing. The engine reads it at write time rather than being handed a snapshot,
  // so a coalesced write always carries the newest state.
  const progressRef = useRef<TypingProgress>(progress);
  progressRef.current = progress;

  const engineRef = useRef<ProgressSyncEngine | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(NO_SYNC);
  // Set to the exact object the engine asked us to adopt, so the persist effect can tell an
  // intentional pull from the kind of backwards jump it is there to catch.
  const remoteAppliedRef = useRef<TypingProgress | null>(null);

  // When signed in, mirror the live session to the cloud (debounced/coalesced).
  const scheduleCloudSession = useCallback(() => {
    if (!userRef.current || cloudSessionTimerRef.current) return;
    cloudSessionTimerRef.current = setTimeout(() => {
      cloudSessionTimerRef.current = null;
      const u = userRef.current;
      if (u && sessionRef.current) {
        void saveCloudSession(u.uid, sessionRef.current).catch((e) =>
          log.warn('sync.session.fail', { sessionId: sessionRef.current?.id, ...describeError(e) })
        );
      }
    }, CLOUD_SAVE_DEBOUNCE_MS);
  }, []);

  // Start a fresh session on mount, archiving any previous one.
  useEffect(() => {
    archiveCurrentSession();
    sessionRef.current = newSession(book.id, loadProgress(book.id));
    log.info('session.mount', { bookId: book.id, ...summarize(progressRef.current) });
    /*
     * Progress sitting behind its own bookmark cannot have been produced by typing: the
     * bookmark names a revision this same writer already reached. It means the stored copy was
     * lost or rolled back between the two writes - which is what a silently failing
     * localStorage write looks like from the next page load. `progress.revert.detected` cannot
     * catch this one; it compares consecutive in-session values, and here the damage is
     * already baked into what loaded. reconcile now refuses to push such a record, and this
     * says out loud that it happened, at `error` level so it uploads immediately.
     */
    const loaded = progressRef.current;
    const bookmark = loadBookmark(book.id);
    if (bookmark && bookmark.writerId === loaded.writerId && loaded.rev < bookmark.rev) {
      log.error('progress.stale.detected', {
        bookId: book.id,
        local: summarize(loaded),
        bookmark,
        storageBytes: storageBytes(),
      });
    }
    return () => {
      log.info('session.unmount', { bookId: book.id, ...summarize(progressRef.current) });
      flushSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persisting progress is coalesced (see PROGRESS_SAVE_DEBOUNCE_MS). Both halves read
  // `progressRef` at write time rather than closing over a snapshot, so a pending timer can
  // only ever write the newest value - never resurrect an older one.
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushProgressSave = useCallback(() => {
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    saveProgress(progressRef.current);
  }, []);

  const scheduleProgressSave = useCallback(() => {
    if (progressSaveTimerRef.current) return; // already scheduled
    progressSaveTimerRef.current = setTimeout(() => {
      progressSaveTimerRef.current = null;
      saveProgress(progressRef.current);
    }, PROGRESS_SAVE_DEBOUNCE_MS);
  }, []);

  const flushSession = useCallback(() => {
    flushProgressSave();
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (sessionRef.current) {
      saveCurrentSession(sessionRef.current);
      const u = userRef.current;
      if (u) {
        void saveCloudSession(u.uid, sessionRef.current).catch((e) =>
          log.warn('sync.session.fail', { sessionId: sessionRef.current?.id, ...describeError(e) })
        );
      }
    }
    // Push the latest progress now rather than waiting out the trailing debounce, so a
    // refresh or a client-side navigation doesn't leave the cloud a few sections behind.
    engineRef.current?.flush('session-flush');
  }, [flushProgressSave]);

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

  // Stopwatch: begin timing (no-op if already running), stop and bank the current
  // segment, or reset entirely (a fresh sitting).
  const startSegment = useCallback(() => {
    if (segmentStartRef.current == null) {
      segmentStartRef.current = Date.now();
      setIsTiming(true);
    }
  }, []);
  const stopSegment = useCallback(() => {
    // The book's clock stops here too: the stretch is over, so the first keystroke after it
    // is credited nothing rather than the cap. Whatever was typed before is already banked
    // on `progress` - this ref only decides what the *next* keystroke is worth.
    lastCharAtRef.current = null;
    if (segmentStartRef.current != null) {
      durationAccumMsRef.current += Date.now() - segmentStartRef.current;
      segmentStartRef.current = null;
      setIsTiming(false);
    }
  }, []);
  const resetStopwatch = useCallback(() => {
    durationAccumMsRef.current = 0;
    segmentStartRef.current = null;
    lastCharAtRef.current = null;
    setIsTiming(false);
  }, []);

  const pauseSession = useCallback(() => {
    if (isPausedRef.current) return; // already paused; keep it idempotent
    clearIdleTimer();
    setIsPaused(true);
    stopSegment();
    flushSession();
    // Note: the input keeps focus while paused so the next keystroke can
    // auto-resume the session (see handleChar / handleBackspace).
  }, [clearIdleTimer, flushSession, stopSegment]);

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
      startSegment(); // keystroke (re)starts the live stopwatch
      scheduleSessionSave();
      bumpIdleTimer();
    },
    [scheduleSessionSave, bumpIdleTimer, startSegment]
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
    resetStopwatch(); // a new sitting starts its clock from zero
  }, [flushSession, book.id, resetStopwatch]);

  /*
   * Persist progress whenever it changes, and check that the change made sense.
   *
   * The guard is the reason this effect is more than one line. Progress jumping backwards is
   * the symptom that started all of this, and it was previously unobservable: whatever caused
   * it, the app simply carried on from the wrong place. One decrement of `passageIndex` is
   * legal (backspacing across a section boundary); a larger drop, or losing keystrokes, is
   * not reachable by typing, so it is recorded with everything needed to explain it. Being an
   * `error` entry, it also forces an immediate upload.
   */
  const previousProgressRef = useRef<TypingProgress | null>(null);
  useEffect(() => {
    const previous = previousProgressRef.current;
    previousProgressRef.current = progress;
    const fromRemote = remoteAppliedRef.current === progress;

    if (previous && !fromRemote) {
      const wentBackwards =
        progress.passageIndex < previous.passageIndex - 1 ||
        progress.totalKeystrokes < previous.totalKeystrokes;
      if (wentBackwards) {
        log.error('progress.revert.detected', {
          bookId: book.id,
          before: summarize(previous),
          after: summarize(progress),
          sync: syncState.status,
        });
      }
    }

    // A finished section is written at once - it is the boundary a reader would notice losing,
    // and it is rare enough to cost nothing. Everything within a section rides the debounce.
    // A pull has already been written by `applyRemote`; flushing cancels any timer still
    // holding the pre-pull value so nothing is left pending against adopted progress.
    // On the first run there is nothing to persist: `progress` is what was just loaded, and
    // mount - with the archive not yet uploaded - is the worst moment to spend the write.
    if (previous) {
      if (fromRemote || progress.passageIndex !== previous.passageIndex) {
        flushProgressSave();
      } else {
        scheduleProgressSave();
      }
    }
    // A pull is already what the cloud holds; sending it straight back would be a pointless
    // round trip (and would churn the revision the two sides just agreed on).
    if (!fromRemote) engineRef.current?.notifyLocalChange();
    // `syncState` is read for the log field only; re-running on it would double-save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, book.id]);

  /*
   * The cloud sync engine, one per (account, book).
   *
   * Keyed on the uid *string*, not the user object. `useAuth` seeds its state from a cache
   * and then re-sets it from Firebase as a new object with the same uid; the previous version
   * of this effect depended on the object, so that second render tore down an in-flight
   * reconcile - and left the flag that gated every cloud write stuck off for the rest of the
   * visit. Depending on the identity that actually matters removes the race entirely.
   */
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid) {
      setSyncState(NO_SYNC);
      return;
    }
    const engine = new ProgressSyncEngine({
      uid,
      bookId: book.id,
      getLocal: () => progressRef.current,
      applyRemote: (adopted) => {
        remoteAppliedRef.current = adopted;
        progressRef.current = adopted; // synchronous, so a write racing the render sees it
        saveProgress(adopted);
        setProgress(adopted);
      },
      onState: setSyncState,
    });
    engineRef.current = engine;
    void engine.start();
    return () => {
      engine.stop();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [uid, book.id]);

  /*
   * Upload the local session archive, then let go of it.
   *
   * The archive used to be append-only for the life of the profile, and this effect re-sent
   * every entry on every mount - its guard is a ref, so a page load resets it. Sixty sittings
   * of keystroke events is most of a storage budget, and a full budget is what stopped
   * progress being saved at all. Dropping each session once its cloud copy is confirmed fixes
   * both: the archive stays small, and there is nothing left to re-upload next time.
   *
   * Pruning is gated strictly on a resolved write, so a signed-out archive is untouched and a
   * failed upload leaves its session local. The stats views already merge cloud and local
   * sessions, so nothing on screen changes.
   */
  const seededSessionsForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || seededSessionsForRef.current === uid) return;
    seededSessionsForRef.current = uid;
    const sessions = loadAllSessions();
    if (sessions.length === 0) return;
    void (async () => {
      // `loadAllSessions` includes the live session, which is still being written to. Only
      // finished sittings may be pruned.
      const liveId = sessionRef.current?.id;
      const prunable: string[] = [];
      let uploaded = 0;
      let failed = false;
      for (const s of sessions) {
        try {
          await saveCloudSession(uid, s);
          uploaded += 1;
          if (s.id !== liveId) prunable.push(s.id);
        } catch (e) {
          log.warn('sync.sessions.seed.fail', { sessionId: s.id, ...describeError(e) });
          failed = true;
          break;
        }
      }
      // Prune whatever landed even if a later one failed - those copies are confirmed.
      const before = storageBytes();
      removeArchivedSessions(prunable);
      if (failed) return;
      log.info('sync.sessions.seed.ok', {
        uploaded,
        pruned: prunable.length,
        freedBytes: before - storageBytes(),
      });
    })();
  }, [uid]);

  // Tick once a second while the stopwatch is running so the displayed clock
  // advances between keystrokes. Idle when paused/stopped (no interval churn).
  useEffect(() => {
    if (!isTiming) return;
    const id = setInterval(() => setDurationTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isTiming]);

  // Clear cloud debounce and idle timers on unmount.
  useEffect(() => {
    return () => {
      if (cloudSessionTimerRef.current) clearTimeout(cloudSessionTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // Flush when the page goes away. `visibilitychange` fires in both directions, and the
  // previous version flushed on becoming visible too - a write of whatever progress happened
  // to be in hand at the moment the user came back, which is not a state anyone asked to
  // save. `pagehide` is here because it is the event that actually fires on mobile and on
  // bfcache teardown, where `beforeunload` does not.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushSession();
    };
    const onPageHide = () => flushSession();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
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
      // What this keystroke adds to the book's lifetime clock. Measured out here rather than
      // inside the updater below: advancing the ref is a side effect, and an updater React is
      // free to call more than once for one keystroke would bank the same gap twice.
      const at = Date.now();
      const sliceMs = activeGapMs(lastCharAtRef.current, at);
      lastCharAtRef.current = at;
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
          return edited({
            ...prev,
            passageIndex: prev.passageIndex + 1,
            typed: '',
            typedHistory,
            completedPassages: prev.completedPassages + 1,
            totalKeystrokes,
            correctKeystrokes,
            bestWpm: Math.max(prev.bestWpm, wpm),
            totalTimeMs: prev.totalTimeMs + sliceMs,
            timedKeystrokes: prev.timedKeystrokes + 1,
            lastPlayedAt,
          });
        }

        // Normal character slot.
        const expected = current[pos];
        const correct = ch === expected;
        pushEvent({ t: now(), kind: 'char', data: ch, correct });
        const totalKeystrokes = prev.totalKeystrokes + 1;
        const correctKeystrokes = prev.correctKeystrokes + (correct ? 1 : 0);
        // Typing the last real char just parks the caret on the newline slot; it
        // does NOT auto-advance — the user must press Enter (see above).
        return edited({
          ...prev,
          typed: prev.typed + ch,
          totalKeystrokes,
          correctKeystrokes,
          totalTimeMs: prev.totalTimeMs + sliceMs,
          timedKeystrokes: prev.timedKeystrokes + 1,
          lastPlayedAt,
        });
      });
    },
    [passages, now, pushEvent, maybeRotateSession, edited]
  );

  const handleBackspace = useCallback(() => {
    maybeRotateSession(); // a long absence starts a new session
    if (isPausedRef.current) setIsPaused(false); // typing resumes the session
    setProgress((prev) => {
      if (prev.typed.length > 0) {
        pushEvent({ t: now(), kind: 'backspace' });
        return edited({ ...prev, typed: prev.typed.slice(0, -1), lastPlayedAt: Date.now() });
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
      return edited({
        ...prev,
        passageIndex: prevIndex,
        typed: restored,
        typedHistory: prev.typedHistory.slice(0, prevIndex),
        completedPassages: Math.max(0, prev.completedPassages - 1),
        lastPlayedAt: Date.now(),
      });
    });
  }, [passages, now, pushEvent, maybeRotateSession, edited]);

  // While a sync conflict is open, the passage on screen is one of two candidate states and
  // may be about to be replaced. Keystrokes are dropped rather than added to a branch the
  // user is in the middle of deciding to discard.
  const inputBlockedRef = useRef(false);
  inputBlockedRef.current = syncState.conflict != null;

  // Input capture: characters via `beforeinput` (composed diacritics arrive as a
  // single insertText), Backspace via `keydown` (fires even on an empty input).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent;
      e.preventDefault(); // keep the hidden input empty
      if (inputBlockedRef.current) return;
      if (ie.inputType === 'insertText' || ie.inputType === 'insertFromPaste') {
        const data = ie.data ?? '';
        for (const ch of data) handleChar(ch);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (inputBlockedRef.current) {
        e.preventDefault();
        return;
      }
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
    // Carries the revision counter forward (see storage.resetProgress), so the empty book is
    // a newer revision than what the cloud holds rather than something reconcile would
    // dutifully undo on the next load.
    const fresh = resetProgressStorage(book.id, writerId);
    log.info('progress.reset', { bookId: book.id, ...summarize(fresh) });
    sessionRef.current = newSession(book.id, fresh);
    resetStopwatch();
    setProgress(fresh);
    engineRef.current?.flush('reset');
    focusInput();
  }, [book.id, flushSession, focusInput, resetStopwatch, writerId]);

  const exportLog = useCallback(() => {
    flushSession();
    downloadJSON(`typing-log-${book.id}-${Date.now()}.json`, exportLogToJSON(book.id));
  }, [book.id, flushSession]);

  const importLog = useCallback((json: string) => importLogFromJSON(json), []);

  const resolveConflict = useCallback((choice: 'local' | 'cloud') => {
    void engineRef.current?.resolveConflict(choice);
  }, []);

  const retrySync = useCallback(() => {
    engineRef.current?.retry();
  }, []);

  // Derived, recomputed each render (i.e. each keystroke) from the live log.
  const wpm = sessionRef.current ? computeWpm(sessionRef.current.events) : 0;
  const accuracy = sessionRef.current ? computeAccuracy(sessionRef.current.events) : 100;
  // Live elapsed time: banked segments plus the currently-running one. Recomputed
  // each render; the 1s tick effect above forces those renders while timing.
  const durationMs =
    durationAccumMsRef.current +
    (segmentStartRef.current != null ? Date.now() - segmentStartRef.current : 0);

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

  /*
   * The book's own clock, and what is left of the book at the pace it records.
   *
   * Neither needs a ticking interval, unlike `durationMs` above: active typing time only
   * advances on a keystroke, and a keystroke has already re-rendered this hook. A clock that
   * sat still while the reader sat still would be wrong for the sitting stopwatch and is
   * exactly right here.
   */
  const timeSpentMs = progress.totalTimeMs;
  // The book's length is a property of the book, so it is measured once per book rather than
  // once per keystroke - this is a scan of every section, and the longest book here has
  // around two thousand of them.
  const bookChars = useMemo(() => typeableChars(passages), [passages]);
  const remainingMs = useMemo(
    () =>
      estimateRemainingMs({
        remainingChars: bookChars - charsCovered(passages, progress),
        totalTimeMs: progress.totalTimeMs,
        timedKeystrokes: progress.timedKeystrokes,
      }),
    [bookChars, passages, progress]
  );

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
    timeSpentMs,
    remainingMs,
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
    sync: syncState,
    conflict: syncState.conflict,
    resolveConflict,
    retrySync,
  };
}
