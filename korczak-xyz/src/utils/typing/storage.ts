// LocalStorage operations for the Touch-Typing Trainer.
import type { TypingProgress, TypingSession } from './types';
import { createDefaultProgress } from './types';

const STORAGE_KEYS = {
  progress: 'typing-progress',
  currentSession: 'typing-current-session', // live, append-only log
  sessions: 'typing-sessions', // archive of finished sessions
} as const;

// Progress

export function loadProgress(bookId: string): TypingProgress {
  if (typeof window === 'undefined') return createDefaultProgress(bookId);
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.progress);
    if (!stored) return createDefaultProgress(bookId);
    const parsed = JSON.parse(stored) as TypingProgress;
    // Progress is per-book; if it's for a different book, start fresh.
    if (parsed.bookId !== bookId) return createDefaultProgress(bookId);
    return { ...createDefaultProgress(bookId), ...parsed };
  } catch {
    return createDefaultProgress(bookId);
  }
}

export function saveProgress(progress: TypingProgress): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(progress));
  } catch {
    // Ignore storage errors (private browsing, quota exceeded).
  }
}

export function resetProgress(bookId: string): TypingProgress {
  const defaults = createDefaultProgress(bookId);
  saveProgress(defaults);
  return defaults;
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

export function exportLogToJSON(): string {
  const current = loadCurrentSession();
  const sessions = [...loadArchivedSessions()];
  if (current && current.events.length > 0) sessions.push(current);
  return JSON.stringify(
    { version: 1, progress: loadProgressRaw(), sessions },
    null,
    2
  );
}

function loadProgressRaw(): TypingProgress | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.progress);
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

export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.progress);
    localStorage.removeItem(STORAGE_KEYS.currentSession);
    localStorage.removeItem(STORAGE_KEYS.sessions);
  } catch {
    // Ignore.
  }
}
