// The per-book sync bookmark: the revision identity local and cloud were last known to hold
// in common. Stored separately from progress because it describes the *relationship* between
// the two copies, not the progress itself - it must not travel to the cloud, and it must be
// dropped whenever that relationship becomes unknown.
import type { SyncBookmark } from './reconcile';

const PREFIX = 'typing-sync-base:';

function key(bookId: string): string {
  return `${PREFIX}${bookId}`;
}

export function loadBookmark(bookId: string): SyncBookmark | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncBookmark>;
    if (typeof parsed?.rev !== 'number' || typeof parsed?.writerId !== 'string') return null;
    return { rev: parsed.rev, writerId: parsed.writerId };
  } catch {
    return null;
  }
}

export function saveBookmark(bookId: string, bookmark: SyncBookmark): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key(bookId), JSON.stringify(bookmark));
  } catch {
    // Ignore storage errors. A missing bookmark degrades to ancestry comparison, which is
    // the same path a first-ever sync takes - never to data loss.
  }
}

export function clearBookmark(bookId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key(bookId));
  } catch {
    // Ignore.
  }
}

export function clearAllBookmarks(): void {
  if (typeof window === 'undefined') return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // Ignore.
  }
}
