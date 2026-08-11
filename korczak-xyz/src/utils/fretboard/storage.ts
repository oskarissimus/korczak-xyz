/*
 * LocalStorage for the fretboard trainer.
 *
 * The trainer shares one ~5 MB origin budget with the typing trainer, the solitaire game and
 * the songbook, and the typing trainer has already demonstrated what happens when a write fails
 * unnoticed: the page carries on playing while the stored copy stays frozen. So writes go
 * through `writeKey`, which reports rather than swallows, and when the store is full it gives up
 * the oldest answers rather than anything that cannot be recomputed.
 *
 * What can and cannot be given up:
 *
 *   - The **event log** is the record, but the cloud holds all of it and the deck has already
 *     absorbed it. Losing the local tail costs history in the offline stats, nothing else.
 *   - The **deck cache** is derived, but derived from events that may since have been pruned.
 *     It is the one thing here that is not reconstructible offline, so it is never evicted.
 */

import { isQuotaError, storageBytes } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import { emptyCache } from './replay';
import { isDirection } from './notes';
import type { Notation } from './notes';
import type {
  DeckCache,
  MasterySnapshot,
  ReviewEvent,
  SessionRecord,
  Settings,
} from './types';
import { DEFAULT_SETTINGS, defaultSettings } from './types';

const KEYS = {
  deck: 'fretboard-deck',
  events: 'fretboard-events',
  sessions: 'fretboard-sessions',
  mastery: 'fretboard-mastery',
  settings: 'fretboard-settings',
  current: 'fretboard-current',
  unsynced: 'fretboard-unsynced',
  pulledAt: 'fretboard-pulled-at',
} as const;

/** How many answers to keep locally. Roughly a season of daily practice; the cloud keeps all. */
export const EVENT_CAP = 2000;
/** How many sittings to keep in the local history table. */
export const SESSION_CAP = 300;

export { storageBytes };

// --- writing --------------------------------------------------------------------------------

const failingKeys = new Set<string>();

function reportFailed(key: string, value: string, e: unknown): void {
  // One report per key. A full store fails again on the next answer, and an `error` entry makes
  // the log sink flush immediately - writing to the store that is already full.
  if (failingKeys.has(key)) return;
  failingKeys.add(key);
  log.error('fretboard.storage.write.failed', {
    key,
    bytes: value.length,
    total: storageBytes(),
    ...describeError(e),
  });
}

function reportRecovered(key: string): void {
  if (!failingKeys.delete(key)) return;
  log.info('fretboard.storage.write.recovered', { key, total: storageBytes() });
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
        log.warn('fretboard.storage.evicted', { key, droppedEvents: dropped });
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

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

// --- deck cache -----------------------------------------------------------------------------

export function loadDeckCache(): DeckCache {
  const cache = readJSON<DeckCache | null>(KEYS.deck, null);
  if (!cache || cache.version !== 1 || typeof cache.deck !== 'object' || cache.deck == null) {
    return emptyCache();
  }
  return { ...emptyCache(), ...cache };
}

export function saveDeckCache(cache: DeckCache): void {
  writeKey(KEYS.deck, JSON.stringify(cache));
}

/** Note that the local log no longer holds everything the deck was folded from. */
function markLogPruned(): void {
  const cache = loadDeckCache();
  if (!cache.logComplete) return;
  writeKey(KEYS.deck, JSON.stringify({ ...cache, logComplete: false }));
}

// --- events ---------------------------------------------------------------------------------

export function loadEvents(): ReviewEvent[] {
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
export function saveEvents(events: ReviewEvent[]): void {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const kept = ordered.slice(-EVENT_CAP);
  if (kept.length < ordered.length) markLogPruned();
  writeKey(KEYS.events, JSON.stringify(kept));
}

export function appendEvents(events: ReviewEvent[]): ReviewEvent[] {
  if (events.length === 0) return loadEvents();
  const merged = [...loadEvents(), ...events];
  saveEvents(merged);
  return merged.slice(-EVENT_CAP);
}

// --- the sitting in progress ------------------------------------------------------------------

/**
 * The live sitting, written after every answer.
 *
 * Its own key, holding only this sitting's answers, because the alternative is re-serialising
 * the whole log every few seconds - a quarter of a megabyte per answer, for a handful of new
 * bytes. Folded into the deck and the log when the sitting ends, or on the next page load if
 * the tab closed first, which is what stops a closed tab losing the practice it recorded.
 */
export interface CurrentSitting {
  sessionId: string;
  startedAt: number;
  events: ReviewEvent[];
}

export function loadCurrent(): CurrentSitting | null {
  const current = readJSON<CurrentSitting | null>(KEYS.current, null);
  return current && Array.isArray(current.events) ? current : null;
}

export function saveCurrent(sitting: CurrentSitting): void {
  writeKey(KEYS.current, JSON.stringify(sitting));
}

export function clearCurrent(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEYS.current);
  } catch {
    // Ignore.
  }
}

// --- sessions -------------------------------------------------------------------------------

export function loadSessions(): SessionRecord[] {
  const sessions = readJSON<SessionRecord[]>(KEYS.sessions, []);
  return Array.isArray(sessions) ? sessions : [];
}

export function saveSessions(sessions: SessionRecord[]): void {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const ordered = [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
  writeKey(KEYS.sessions, JSON.stringify(ordered.slice(-SESSION_CAP)));
}

export function addSession(session: SessionRecord): void {
  saveSessions([...loadSessions(), session]);
}

// --- mastery history ------------------------------------------------------------------------

export function loadMastery(): MasterySnapshot[] {
  const history = readJSON<MasterySnapshot[]>(KEYS.mastery, []);
  return Array.isArray(history) ? history : [];
}

export function saveMastery(history: MasterySnapshot[]): void {
  writeKey(KEYS.mastery, JSON.stringify(history));
}

// --- settings -------------------------------------------------------------------------------

export function loadSettings(notation: Notation): Settings {
  const stored = readJSON<Partial<Settings>>(KEYS.settings, {});
  // A settings record written before the notation setting existed has no `notation` key, so the
  // spread hands it the page's default — which is the migration.
  const merged = { ...defaultSettings(notation), ...stored };
  // A scope with no strings or no directions is an empty deck and a game that cannot start.
  if (!Array.isArray(merged.strings) || merged.strings.length === 0) {
    merged.strings = DEFAULT_SETTINGS.strings;
  }
  // Settings sync between devices, so a direction this build has never heard of can arrive from
  // one that has. Dropping it here is what stops `scopeIds` minting card ids that `parseCardId`
  // will then refuse, which is a sitting with nothing in it.
  merged.directions = Array.isArray(merged.directions)
    ? merged.directions.filter(isDirection)
    : [];
  if (merged.directions.length === 0) {
    merged.directions = DEFAULT_SETTINGS.directions;
  }
  return merged;
}

export function saveSettings(settings: Settings): void {
  writeKey(KEYS.settings, JSON.stringify(settings));
}

// --- sync bookkeeping -----------------------------------------------------------------------

/** Sittings not yet confirmed in the cloud. Uploaded on the next opportunity. */
export function loadUnsynced(): string[] {
  const ids = readJSON<string[]>(KEYS.unsynced, []);
  return Array.isArray(ids) ? ids : [];
}

export function saveUnsynced(ids: string[]): void {
  writeKey(KEYS.unsynced, JSON.stringify([...new Set(ids)]));
}

export function loadPulledAt(): number {
  const value = readJSON<number>(KEYS.pulledAt, 0);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function savePulledAt(at: number): void {
  writeKey(KEYS.pulledAt, JSON.stringify(at));
}

export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.values(KEYS)) localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}
