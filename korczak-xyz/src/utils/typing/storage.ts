/*
 * LocalStorage operations for the Touch-Typing Trainer.
 *
 * Every write here used to be wrapped in a bare `catch {}`. That is how a session ended up
 * rolled back five sections: the store filled up, `saveProgress` began throwing on every
 * keystroke, and nothing said so - the page carried on typing and pushing to Firestore while
 * the stored copy stayed frozen, until the next page load read the frozen one back. So writes
 * now go through `writeKey`, which reports the failure and, when the store is simply full,
 * buys room by giving up session history rather than losing progress.
 */
import { describeError, log } from '../../lib/logger';
import { bumpRevision } from './reconcile';
import { clearAllBookmarks } from './syncBookmark';
import type { TypingProgress, TypingSession } from './types';
import { createDefaultProgress, normalizeProgress } from './types';

const STORAGE_KEYS = {
  progressPrefix: 'typing-progress:', // per-book: `typing-progress:${bookId}`
  legacyProgress: 'typing-progress', // pre-multi-book single slot (migrated on read)
  selectedBook: 'typing-selected-book', // which book the picker last showed
  currentSession: 'typing-current-session', // live, append-only log
  sessions: 'typing-sessions', // archive of finished sessions
} as const;

function progressKey(bookId: string): string {
  return `${STORAGE_KEYS.progressPrefix}${bookId}`;
}

// Total characters held in localStorage, across every key on the origin - the trainer shares
// its budget with the rest of the site. Reported alongside a failed write, where knowing how
// close to the ceiling we were is the whole diagnosis.
export function storageBytes(): number {
  if (typeof window === 'undefined') return 0;
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key == null) continue;
      total += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return total;
  } catch {
    return 0;
  }
}

// Browsers disagree on how they say "full": the name is standard, the numeric codes are what
// older Firefox and Safari builds report.
function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

// Keys whose last write threw. A full store fails again on the very next keystroke, and an
// `error` entry makes the log sink persist and flush immediately - so reporting every one
// would hammer the store that is already full. One report per key, re-armed once it recovers.
const failingKeys = new Set<string>();

function reportFailed(key: string, value: string, e: unknown): void {
  if (failingKeys.has(key)) return;
  failingKeys.add(key);
  log.error('storage.write.failed', {
    key,
    bytes: value.length,
    total: storageBytes(),
    ...describeError(e),
  });
}

function reportRecovered(key: string): void {
  if (!failingKeys.delete(key)) return;
  log.info('storage.write.recovered', { key, total: storageBytes() });
}

/*
 * Give up the older half of the session archive.
 *
 * Sessions are keystroke logs: replayable telemetry, and already mirrored to Firestore.
 * Progress is neither - lose it and the user retypes the book. So when the store is full and
 * something has to go, it is always this. Half at a time so one blocked write doesn't have to
 * walk a 60-entry archive one entry at a time.
 */
function evictArchivedSessions(): { dropped: number; freed: number } {
  const sessions = loadArchivedSessions();
  if (sessions.length === 0) return { dropped: 0, freed: 0 };
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  const keep = ordered.slice(Math.ceil(ordered.length / 2));
  const before = readRaw(STORAGE_KEYS.sessions)?.length ?? 0;
  const serialized = JSON.stringify(keep);
  try {
    localStorage.setItem(STORAGE_KEYS.sessions, serialized);
  } catch {
    return { dropped: 0, freed: 0 }; // nothing gained; the caller reports the original failure
  }
  return { dropped: ordered.length - keep.length, freed: before - serialized.length };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write one key, reporting failure instead of swallowing it.
 *
 * Returns whether the value actually landed. A quota failure is retried once against a
 * freshly-trimmed session archive, because the alternative - a write that silently never
 * happens again for the life of the page - is the failure this whole module exists to prevent.
 */
function writeKey(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Evicting the archive to make room for the archive would be circular.
    if (isQuotaError(e) && key !== STORAGE_KEYS.sessions) {
      const { dropped, freed } = evictArchivedSessions();
      if (dropped > 0) {
        log.warn('storage.evicted', { key, droppedSessions: dropped, freedBytes: freed });
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

// Progress — stored per book under `typing-progress:${bookId}`.

export function loadProgress(bookId: string): TypingProgress {
  if (typeof window === 'undefined') return createDefaultProgress(bookId);
  try {
    const stored = localStorage.getItem(progressKey(bookId));
    if (stored) {
      const parsed = JSON.parse(stored) as TypingProgress;
      return normalizeProgress({ ...createDefaultProgress(bookId), ...parsed });
    }
    // One-time migration from the pre-multi-book single slot.
    const legacy = localStorage.getItem(STORAGE_KEYS.legacyProgress);
    if (legacy) {
      const parsed = JSON.parse(legacy) as TypingProgress;
      if (parsed.bookId === bookId) {
        localStorage.removeItem(STORAGE_KEYS.legacyProgress);
        const migrated = normalizeProgress({ ...createDefaultProgress(bookId), ...parsed });
        saveProgress(migrated);
        return migrated;
      }
    }
    return createDefaultProgress(bookId);
  } catch {
    return createDefaultProgress(bookId);
  }
}

export function saveProgress(progress: TypingProgress): void {
  writeKey(progressKey(progress.bookId), JSON.stringify(progress));
}

// Reset carries the revision counter forward rather than restarting it. A reset that went
// back to rev 0 would look to the cloud like an older revision than the progress it is meant
// to replace, and the next reconcile would helpfully pull the deleted progress back. Emptying
// the book is an edit like any other, so it gets the next revision number.
export function resetProgress(bookId: string, writerId: string): TypingProgress {
  const previous = loadProgress(bookId);
  const fresh = bumpRevision(
    { ...createDefaultProgress(bookId), rev: previous.rev, writerId },
    writerId
  );
  saveProgress(fresh);
  return fresh;
}

// Which book the picker last had selected.

export function loadSelectedBookId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEYS.selectedBook);
  } catch {
    return null;
  }
}

export function saveSelectedBookId(bookId: string): void {
  writeKey(STORAGE_KEYS.selectedBook, bookId);
}

// Sessions

export function loadCurrentSession(): TypingSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.currentSession);
    return stored ? (JSON.parse(stored) as TypingSession) : null;
  } catch {
    return null;
  }
}

export function saveCurrentSession(session: TypingSession): void {
  writeKey(STORAGE_KEYS.currentSession, JSON.stringify(session));
}

function loadArchivedSessions(): TypingSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.sessions);
    return stored ? (JSON.parse(stored) as TypingSession[]) : [];
  } catch {
    return [];
  }
}

function saveArchivedSessions(sessions: TypingSession[]): void {
  writeKey(STORAGE_KEYS.sessions, JSON.stringify(sessions));
}

/**
 * Drop sessions from the archive by id.
 *
 * Called once their cloud copy is confirmed. Without it the archive is append-only for the
 * life of the profile - which is what filled the store and stopped progress being saved. The
 * archive is re-read here rather than taken from the caller, because a sitting can be archived
 * while the uploads that authorised this prune are still in flight.
 */
export function removeArchivedSessions(ids: string[]): void {
  if (typeof window === 'undefined' || ids.length === 0) return;
  const drop = new Set(ids);
  const sessions = loadArchivedSessions();
  const remaining = sessions.filter((s) => !drop.has(s.id));
  if (remaining.length === sessions.length) return;
  saveArchivedSessions(remaining);
}

// Move the current session into the archive (if it recorded anything) and clear
// the live slot.
export function archiveCurrentSession(): void {
  if (typeof window === 'undefined') return;
  const current = loadCurrentSession();
  if (current && current.events.length > 0) {
    current.endedAt = Date.now();
    saveArchivedSessions([...loadArchivedSessions(), current]);
  }
  try {
    localStorage.removeItem(STORAGE_KEYS.currentSession);
  } catch {
    // Ignore.
  }
}

// Export / Import — the full keystroke record for replay/backup.

export function exportLogToJSON(bookId: string): string {
  const current = loadCurrentSession();
  const sessions = [...loadArchivedSessions()];
  if (current && current.events.length > 0) sessions.push(current);
  return JSON.stringify(
    { version: 1, progress: loadProgressRaw(bookId), sessions },
    null,
    2
  );
}

function loadProgressRaw(bookId: string): TypingProgress | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(progressKey(bookId));
    return stored ? (JSON.parse(stored) as TypingProgress) : null;
  } catch {
    return null;
  }
}

export function importLogFromJSON(
  json: string
): { success: boolean; sessionCount: number; error?: string } {
  try {
    const parsed = JSON.parse(json) as {
      sessions?: TypingSession[];
      progress?: TypingProgress;
    };
    if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
      return { success: false, sessionCount: 0, error: 'No sessions found in file.' };
    }
    // Merge imported sessions into the archive, de-duplicating by id.
    const existing = loadArchivedSessions();
    const seen = new Set(existing.map((s) => s.id));
    const merged = [...existing];
    for (const s of parsed.sessions) {
      if (!seen.has(s.id)) {
        merged.push(s);
        seen.add(s.id);
      }
    }
    saveArchivedSessions(merged);
    if (parsed.progress) saveProgress(parsed.progress);
    return { success: true, sessionCount: parsed.sessions.length };
  } catch (e) {
    return { success: false, sessionCount: 0, error: String(e) };
  }
}

// Collapse sessions sharing an id to a single entry, keeping the one with the
// most events. The same session can legitimately appear more than once — e.g.
// a second tab archives the live session while the first tab still holds it in
// the current-session slot — and every consumer (stats, cloud upload) must count
// each id exactly once, or a session's whole day gets double-counted.
export function dedupeSessionsById(sessions: TypingSession[]): TypingSession[] {
  const byId = new Map<string, TypingSession>();
  for (const s of sessions) {
    const prev = byId.get(s.id);
    if (!prev || s.events.length > prev.events.length) byId.set(s.id, s);
  }
  return [...byId.values()];
}

// All locally-stored sessions (archive plus the live one), for one-time upload
// to the cloud on first sign-in.
export function loadAllSessions(): TypingSession[] {
  const sessions = [...loadArchivedSessions()];
  const current = loadCurrentSession();
  if (current && current.events.length > 0) sessions.push(current);
  return dedupeSessionsById(sessions);
}

// Whether the local progress holds anything worth migrating to the cloud.
export function isNonTrivialProgress(progress: TypingProgress): boolean {
  return (
    progress.passageIndex > 0 || progress.typed.length > 0 || progress.totalKeystrokes > 0
  );
}

export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  try {
    // Remove every per-book progress slot plus the legacy single slot.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEYS.legacyProgress)) {
        localStorage.removeItem(key);
      }
    }
    localStorage.removeItem(STORAGE_KEYS.selectedBook);
    localStorage.removeItem(STORAGE_KEYS.currentSession);
    localStorage.removeItem(STORAGE_KEYS.sessions);
    // The bookmarks describe a relationship to progress that no longer exists; leaving them
    // behind would have the next reconcile compare against a revision nothing holds.
    clearAllBookmarks();
  } catch {
    // Ignore.
  }
}
