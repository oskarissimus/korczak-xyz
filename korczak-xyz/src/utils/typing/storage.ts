// LocalStorage operations for the Touch-Typing Trainer.
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
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(progressKey(progress.bookId), JSON.stringify(progress));
  } catch {
    // Ignore storage errors (private browsing, quota exceeded).
  }
}

export function resetProgress(bookId: string): TypingProgress {
  const defaults = createDefaultProgress(bookId);
  saveProgress(defaults);
  return defaults;
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
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.selectedBook, bookId);
  } catch {
    // Ignore storage errors.
  }
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
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(session));
  } catch {
    // Ignore storage errors.
  }
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
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
  } catch {
    // Ignore storage errors.
  }
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
  } catch {
    // Ignore.
  }
}
