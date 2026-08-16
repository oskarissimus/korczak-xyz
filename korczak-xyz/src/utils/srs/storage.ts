/*
 * LocalStorage for a spaced-repetition trainer.
 *
 * A trainer shares one ~5 MB origin budget with the typing trainer, the solitaire game, the
 * songbook and every other trainer, and the typing trainer has already demonstrated what happens
 * when a write fails unnoticed: the page carries on playing while the stored copy stays frozen.
 * So writes go through `writeKey`, which reports rather than swallows, and when the store is full
 * it gives up the oldest answers rather than anything that cannot be recomputed.
 *
 * What can and cannot be given up:
 *
 *   - The **event log** is the record, but the cloud holds all of it and the deck has already
 *     absorbed it. Losing the local tail costs history in the offline stats, nothing else.
 *   - The **deck cache** is derived, but derived from events that may since have been pruned.
 *     It is the one thing here that is not reconstructible offline, so it is never evicted.
 *
 * A factory rather than a module of functions, because the two trainers keep separate decks under
 * separate key prefixes and must not be able to evict each other's log. Everything below is per
 * instance: the key names, the failing-key set, and which log the eviction reaches for.
 */

import { isQuotaError, storageBytes } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import { emptyCache } from './replay';
import type { DeckCache, MasterySnapshot, ReviewEvent, SessionRecord } from './types';

/** How many answers to keep locally. Roughly a season of daily practice; the cloud keeps all. */
export const EVENT_CAP = 2000;
/** How many sittings to keep in the local history table. */
export const SESSION_CAP = 300;

/**
 * The live sitting, written after every answer.
 *
 * Its own key, holding only this sitting's answers, because the alternative is re-serialising
 * the whole log every few seconds — a quarter of a megabyte per answer, for a handful of new
 * bytes. Folded into the deck and the log when the sitting ends, or on the next page load if
 * the tab closed first, which is what stops a closed tab losing the practice it recorded.
 */
export interface CurrentSitting {
  sessionId: string;
  startedAt: number;
  events: ReviewEvent[];
}

export interface SrsStorage {
  loadDeckCache(): DeckCache;
  saveDeckCache(cache: DeckCache): void;
  loadEvents(): ReviewEvent[];
  saveEvents(events: ReviewEvent[]): void;
  appendEvents(events: ReviewEvent[]): ReviewEvent[];
  loadCurrent(): CurrentSitting | null;
  saveCurrent(sitting: CurrentSitting): void;
  clearCurrent(): void;
  loadSessions(): SessionRecord[];
  saveSessions(sessions: SessionRecord[]): void;
  addSession(session: SessionRecord): void;
  loadMastery(): MasterySnapshot[];
  saveMastery(history: MasterySnapshot[]): void;
  loadUnsynced(): string[];
  saveUnsynced(ids: string[]): void;
  loadPulledAt(): number;
  savePulledAt(at: number): void;
  /** Read and write anything else the app keeps under its own prefix — its settings, mostly. */
  readJSON<T>(name: string, fallback: T): T;
  writeJSON(name: string, value: unknown): boolean;
  clearAll(): void;
}

/**
 * @param prefix the localStorage key prefix, e.g. `fretboard` for `fretboard-deck`.
 * @param logPrefix what a storage failure is reported under, e.g. `fretboard.storage.write.failed`.
 */
export function createSrsStorage(prefix: string, logPrefix = prefix): SrsStorage {
  const KEYS = {
    deck: `${prefix}-deck`,
    events: `${prefix}-events`,
    sessions: `${prefix}-sessions`,
    mastery: `${prefix}-mastery`,
    current: `${prefix}-current`,
    unsynced: `${prefix}-unsynced`,
    pulledAt: `${prefix}-pulled-at`,
  } as const;

  const failingKeys = new Set<string>();

  function reportFailed(key: string, value: string, e: unknown): void {
    // One report per key. A full store fails again on the next answer, and an `error` entry makes
    // the log sink flush immediately — writing to the store that is already full.
    if (failingKeys.has(key)) return;
    failingKeys.add(key);
    log.error(`${logPrefix}.storage.write.failed`, {
      key,
      bytes: value.length,
      total: storageBytes(),
      ...describeError(e),
    });
  }

  function reportRecovered(key: string): void {
    if (!failingKeys.delete(key)) return;
    log.info(`${logPrefix}.storage.write.recovered`, { key, total: storageBytes() });
  }

  function readJSON<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  /** Surrender the older half of the local event log. Returns how many answers were dropped. */
  function evictEvents(): number {
    const events = loadEvents();
    if (events.length === 0) return 0;
    const keep = events.slice(Math.ceil(events.length / 2));
    try {
      localStorage.setItem(KEYS.events, JSON.stringify(keep));
    } catch {
      return 0; // nothing gained; the caller reports the original failure
    }
    markLogPruned();
    return events.length - keep.length;
  }

  function writeKey(key: string, value: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Evicting the log to make room for the log would be circular.
      if (isQuotaError(e) && key !== KEYS.events) {
        const dropped = evictEvents();
        if (dropped > 0) {
          log.warn(`${logPrefix}.storage.evicted`, { key, droppedEvents: dropped });
          try {
            localStorage.setItem(key, value);
            reportRecovered(key);
            return true;
          } catch (retryError) {
            reportFailed(key, value, retryError);
            return false;
          }
        }
      }
      reportFailed(key, value, e);
      return false;
    }
    reportRecovered(key);
    return true;
  }

  function loadDeckCache(): DeckCache {
    const cache = readJSON<DeckCache | null>(KEYS.deck, null);
    if (!cache || cache.version !== 1 || typeof cache.deck !== 'object' || cache.deck == null) {
      return emptyCache();
    }
    return { ...emptyCache(), ...cache };
  }

  function saveDeckCache(cache: DeckCache): void {
    writeKey(KEYS.deck, JSON.stringify(cache));
  }

  /** Note that the local log no longer holds everything the deck was folded from. */
  function markLogPruned(): void {
    const cache = loadDeckCache();
    if (!cache.logComplete) return;
    writeKey(KEYS.deck, JSON.stringify({ ...cache, logComplete: false }));
  }

  function loadEvents(): ReviewEvent[] {
    const events = readJSON<ReviewEvent[]>(KEYS.events, []);
    return Array.isArray(events) ? events : [];
  }

  /**
   * Store the log, keeping the newest `EVENT_CAP` answers.
   *
   * Trimming here rather than only under quota pressure: the log grows every day whether or not
   * the store is tight, and a cap that only applies in an emergency is a cap that is discovered
   * during one.
   */
  function saveEvents(events: ReviewEvent[]): void {
    const ordered = [...events].sort((a, b) => a.at - b.at);
    const kept = ordered.slice(-EVENT_CAP);
    if (kept.length < ordered.length) markLogPruned();
    writeKey(KEYS.events, JSON.stringify(kept));
  }

  function appendEvents(events: ReviewEvent[]): ReviewEvent[] {
    if (events.length === 0) return loadEvents();
    const merged = [...loadEvents(), ...events];
    saveEvents(merged);
    return merged.slice(-EVENT_CAP);
  }

  function loadSessions(): SessionRecord[] {
    const sessions = readJSON<SessionRecord[]>(KEYS.sessions, []);
    return Array.isArray(sessions) ? sessions : [];
  }

  function saveSessions(sessions: SessionRecord[]): void {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const ordered = [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
    writeKey(KEYS.sessions, JSON.stringify(ordered.slice(-SESSION_CAP)));
  }

  function remove(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  }

  return {
    loadDeckCache,
    saveDeckCache,
    loadEvents,
    saveEvents,
    appendEvents,

    loadCurrent() {
      const current = readJSON<CurrentSitting | null>(KEYS.current, null);
      return current && Array.isArray(current.events) ? current : null;
    },
    saveCurrent(sitting) {
      writeKey(KEYS.current, JSON.stringify(sitting));
    },
    clearCurrent() {
      remove(KEYS.current);
    },

    loadSessions,
    saveSessions,
    addSession(session) {
      saveSessions([...loadSessions(), session]);
    },

    loadMastery() {
      const history = readJSON<MasterySnapshot[]>(KEYS.mastery, []);
      return Array.isArray(history) ? history : [];
    },
    saveMastery(history) {
      writeKey(KEYS.mastery, JSON.stringify(history));
    },

    /** Sittings not yet confirmed in the cloud. Uploaded on the next opportunity. */
    loadUnsynced() {
      const ids = readJSON<string[]>(KEYS.unsynced, []);
      return Array.isArray(ids) ? ids : [];
    },
    saveUnsynced(ids) {
      writeKey(KEYS.unsynced, JSON.stringify([...new Set(ids)]));
    },

    loadPulledAt() {
      const value = readJSON<number>(KEYS.pulledAt, 0);
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    },
    savePulledAt(at) {
      writeKey(KEYS.pulledAt, JSON.stringify(at));
    },

    readJSON<T>(name: string, fallback: T): T {
      return readJSON(`${prefix}-${name}`, fallback);
    },
    writeJSON(name, value) {
      return writeKey(`${prefix}-${name}`, JSON.stringify(value));
    },

    clearAll() {
      for (const key of Object.values(KEYS)) remove(key);
      remove(`${prefix}-settings`);
    },
  };
}
