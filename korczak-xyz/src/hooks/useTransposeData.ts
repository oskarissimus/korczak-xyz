/*
 * Everything the transposition trainer knows, and how it gets to and from the account.
 *
 * The shape of the sync is described in `src/utils/srs/replay.ts`: sittings are immutable
 * documents, merging them is a union, and the deck is refolded from the result. That leaves this
 * hook with no conflicts to resolve — only an upload queue, a pull, and the bookkeeping that says
 * which sittings have made it.
 *
 * Answers are written to their own small key as they happen and folded into the deck when the
 * sitting ends. A tab closed mid-sitting therefore loses nothing: the next load finds the orphaned
 * answers and finishes the sitting on its behalf.
 *
 * The same shape as `useFretboardData`, and deliberately not shared with it. What the two have in
 * common is already factored out — the scheduler, the replay, the storage discipline, the Firestore
 * layer — and what is left is the wiring between one app's scope and one app's cards. Abstracting
 * that would mean parameterising the hook over the settings type, the library and the scope
 * function, which is more machinery than the fifty lines it would save.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, log } from '../lib/logger';
import {
  loadCloudSettings,
  pullSessions,
  pushSession,
  saveCloudSettings,
} from '../utils/transpose/cloud';
import { cardsInScope, ensureCards, scopeIds } from '../utils/transpose/deck';
import type { LibraryIndex } from '../utils/transpose/library';
import { emptyCache, reconcileDeck, recordLocal } from '../utils/srs/replay';
import { buildSessionRecord, countBuckets, snapshotMastery } from '../utils/transpose/stats';
import {
  addSession,
  appendEvents,
  clearCurrent,
  loadCurrent,
  loadDeckCache,
  loadEvents,
  loadMastery,
  loadPulledAt,
  loadSessions,
  loadSettings,
  loadUnsynced,
  sanitizeSettings,
  saveCurrent,
  saveDeckCache,
  saveEvents,
  saveMastery,
  savePulledAt,
  saveSessions,
  saveSettings,
  saveUnsynced,
} from '../utils/transpose/storage';
import type { Notation } from '../utils/transpose/theory';
import type {
  Deck,
  DeckCache,
  MasterySnapshot,
  ReviewEvent,
  SessionRecord,
  Settings,
} from '../utils/transpose/types';
import { DEFAULT_SETTINGS } from '../utils/transpose/types';
import type { AuthUser } from './useAuth';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  pending: number; // sittings not yet on the account
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface TransposeState {
  ready: boolean;
  deck: Deck;
  settings: Settings;
  events: ReviewEvent[];
  sessions: SessionRecord[];
  mastery: MasterySnapshot[];
}

export interface TransposeData extends TransposeState {
  sync: SyncState;
  updateSettings: (next: Settings) => void;
  /** Persist one answer as it is given, so a closed tab cannot lose it. */
  recordAnswer: (sessionId: string, startedAt: number, event: ReviewEvent) => void;
  /** Fold a finished sitting into the deck, file it, and send it to the account. */
  finishSession: (
    sessionId: string,
    startedAt: number,
    events: ReviewEvent[],
    newIntroduced: number
  ) => SessionRecord | null;
  retrySync: () => void;
}

const EMPTY: TransposeState = {
  ready: false,
  deck: {},
  settings: DEFAULT_SETTINGS,
  events: [],
  sessions: [],
  mastery: [],
};

/**
 * Close out a sitting: fold its answers into the deck, file the record, snapshot the day.
 *
 * Shared by the normal end-of-session path and the recovery path, because a sitting abandoned by a
 * closed tab has to be finished exactly the same way — half of it in the deck and none of it in the
 * history is the state this function exists to make unreachable.
 */
function commitSitting(
  cache: DeckCache,
  settings: Settings,
  library: LibraryIndex,
  sessionId: string,
  startedAt: number,
  events: ReviewEvent[],
  newIntroduced: number,
  endedAt: number
): { cache: DeckCache; session: SessionRecord; events: ReviewEvent[]; mastery: MasterySnapshot[] } {
  const nextCache = recordLocal(cache, events);
  const counts = countBuckets(cardsInScope(nextCache.deck, settings, library));
  const session = buildSessionRecord(
    sessionId,
    startedAt,
    endedAt,
    events,
    newIntroduced,
    counts.mature
  );

  saveDeckCache(nextCache);
  const storedEvents = appendEvents(events);
  addSession(session);
  const mastery = snapshotMastery(loadMastery(), counts, endedAt);
  saveMastery(mastery);
  saveUnsynced([...loadUnsynced(), session.id]);
  clearCurrent();

  return { cache: nextCache, session, events: storedEvents, mastery };
}

/**
 * @param defaultNotations which chord names to start someone on, before they have chosen. Comes
 *   from the page's locale — see `defaultSettings`.
 * @param library the songbook index, computed at build time and handed in as a prop. It is part of
 *   the scope (`Settings.keys`), so the deck cannot be enumerated without it.
 */
export function useTransposeData(
  user: AuthUser | null,
  defaultNotations: Notation[],
  library: LibraryIndex
): TransposeData {
  const [state, setState] = useState<TransposeState>(EMPTY);
  const [sync, setSync] = useState<SyncState>({
    status: 'off',
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
  });

  // The cache is not in React state: it is written on every commit and read by the next one, and a
  // stale closure over it would silently unfold a sitting.
  const cacheRef = useRef<DeckCache>(emptyCache());
  const stateRef = useRef<TransposeState>(EMPTY);
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);
  // The library is a build-time constant, but it arrives as a prop and a new object identity on
  // every render would re-run the loader. Held rather than depended on.
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const publish = useCallback((next: TransposeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // --- load ---------------------------------------------------------------------------------

  useEffect(() => {
    const settings = loadSettings(defaultNotations);
    const lib = libraryRef.current;
    let cache = loadDeckCache();
    let events = loadEvents();
    let mastery = loadMastery();

    // A sitting the tab never got to finish. Its answers are real practice; they just never
    // reached the deck.
    const orphan = loadCurrent();
    if (orphan && orphan.events.length > 0) {
      const endedAt = orphan.events.reduce((max, e) => Math.max(max, e.at), orphan.startedAt);
      const committed = commitSitting(
        cache,
        settings,
        lib,
        orphan.sessionId,
        orphan.startedAt,
        orphan.events,
        0,
        endedAt
      );
      cache = committed.cache;
      events = committed.events;
      mastery = committed.mastery;
      log.info('transpose.session.recovered', {
        sessionId: orphan.sessionId,
        answers: orphan.events.length,
      });
    }

    cache = { ...cache, deck: ensureCards(cache.deck, scopeIds(settings, lib)) };
    cacheRef.current = cache;
    saveDeckCache(cache);

    publish({
      ready: true,
      deck: cache.deck,
      settings,
      events,
      sessions: loadSessions(),
      mastery,
    });
    setSync((s) => ({ ...s, pending: loadUnsynced().length }));
    // `defaultNotations` is a module constant per locale, so this runs once.
  }, [defaultNotations, publish]);

  // --- sync ---------------------------------------------------------------------------------

  const runSync = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid || syncingRef.current || !stateRef.current.ready) return;
    syncingRef.current = true;
    setSync((s) => ({ ...s, status: 'syncing' }));

    try {
      // Push first, so a pull that comes straight back includes what this device just did and the
      // dedupe in `mergeEvents` — rather than an ordering rule — is what keeps it correct.
      const pending = loadUnsynced();
      if (pending.length > 0) {
        const sessions = loadSessions();
        const events = loadEvents();
        const done: string[] = [];
        for (const id of pending) {
          const record = sessions.find((s) => s.id === id);
          if (!record) {
            done.push(id); // pruned out of the local history; nothing left to send
            continue;
          }
          await pushSession(uid, record, events.filter((e) => e.sessionId === id));
          done.push(id);
        }
        saveUnsynced(pending.filter((id) => !done.includes(id)));
      }

      const since = loadPulledAt();
      const pull = await pullSessions(uid, since);

      if (since === 0) {
        // First contact on this device. Settings are a preference, so whichever side has one wins
        // outright — there is no work in them to lose.
        const cloudSettings = await loadCloudSettings(uid);
        if (cloudSettings) {
          // Through the same repair as a stored record, not a bare spread over the defaults: this
          // copy is used for the rest of the session, so a pattern this build cannot read has to be
          // dropped here rather than on the next page load.
          const merged = sanitizeSettings(cloudSettings, defaultNotations);
          saveSettings(merged);
          publish({ ...stateRef.current, settings: merged });
        } else {
          await saveCloudSettings(uid, stateRef.current.settings);
        }
      }

      if (pull.events.length > 0 || pull.sessions.length > 0) {
        const result = reconcileDeck(cacheRef.current, loadEvents(), pull.events, {
          completeLog: pull.complete ? true : undefined,
        });
        if (result.mode !== 'unchanged') {
          const settings = stateRef.current.settings;
          const cache = {
            ...result.cache,
            deck: ensureCards(result.cache.deck, scopeIds(settings, libraryRef.current)),
          };
          cacheRef.current = cache;
          saveDeckCache(cache);
          saveEvents(result.events);
          saveSessions([...loadSessions(), ...pull.sessions]);
          publish({
            ...stateRef.current,
            deck: cache.deck,
            events: loadEvents(),
            sessions: loadSessions(),
          });
          log.info('transpose.sync.merged', { mode: result.mode, events: result.novel.length });
        }
      }
      if (pull.newestEndedAt > since) savePulledAt(pull.newestEndedAt);

      setSync({
        status: 'idle',
        pending: loadUnsynced().length,
        lastSyncedAt: Date.now(),
        lastError: null,
      });
    } catch (e) {
      log.warn('transpose.sync.failed', describeError(e));
      setSync((s) => ({
        ...s,
        status: 'error',
        pending: loadUnsynced().length,
        lastError: String(describeError(e).message ?? 'sync failed'),
      }));
    } finally {
      syncingRef.current = false;
    }
  }, [defaultNotations, publish]);

  useEffect(() => {
    uidRef.current = user?.uid ?? null;
    if (!user) {
      setSync({ status: 'off', pending: loadUnsynced().length, lastSyncedAt: null, lastError: null });
      return;
    }
    void runSync();
  }, [user, state.ready, runSync]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => void runSync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [runSync]);

  // --- writes -------------------------------------------------------------------------------

  const updateSettings = useCallback(
    (next: Settings) => {
      saveSettings(next);
      const cache = {
        ...cacheRef.current,
        deck: ensureCards(cacheRef.current.deck, scopeIds(next, libraryRef.current)),
      };
      cacheRef.current = cache;
      saveDeckCache(cache);
      publish({ ...stateRef.current, settings: next, deck: cache.deck });
      if (uidRef.current) void saveCloudSettings(uidRef.current, next).catch(() => {});
    },
    [publish]
  );

  const recordAnswer = useCallback(
    (sessionId: string, startedAt: number, event: ReviewEvent) => {
      const current = loadCurrent();
      const events =
        current && current.sessionId === sessionId ? [...current.events, event] : [event];
      saveCurrent({ sessionId, startedAt, events });
    },
    []
  );

  const finishSession = useCallback(
    (sessionId: string, startedAt: number, events: ReviewEvent[], newIntroduced: number) => {
      if (events.length === 0) {
        clearCurrent();
        return null;
      }
      const committed = commitSitting(
        cacheRef.current,
        stateRef.current.settings,
        libraryRef.current,
        sessionId,
        startedAt,
        events,
        newIntroduced,
        Date.now()
      );
      cacheRef.current = committed.cache;
      publish({
        ...stateRef.current,
        deck: committed.cache.deck,
        events: committed.events,
        sessions: loadSessions(),
        mastery: committed.mastery,
      });
      setSync((s) => ({ ...s, pending: loadUnsynced().length }));
      void runSync();
      return committed.session;
    },
    [publish, runSync]
  );

  return {
    ...state,
    sync,
    updateSettings,
    recordAnswer,
    finishSession,
    retrySync: () => void runSync(),
  };
}
