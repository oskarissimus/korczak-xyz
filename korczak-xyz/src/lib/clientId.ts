/*
 * A stable id for this browser profile, plus a fresh one per page load.
 *
 * Its own module because two unrelated subsystems need it and neither should have to import
 * the other: the logger stamps every entry with it, and typing progress stamps every
 * revision with it so a sync conflict can name which device wrote which side.
 */

const CLIENT_ID_KEY = 'typing-client-id';

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let clientIdMemo: string | null = null;

// Stable across page loads and sessions, so a whole browser profile's history reads back as
// one thread. Falls back to a per-load id where storage is unavailable (Safari private mode),
// which degrades conflict attribution but never blocks a write.
export function getClientId(): string {
  if (clientIdMemo) return clientIdMemo;
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) {
      clientIdMemo = existing;
      return existing;
    }
  } catch {
    // Fall through to a memo-only id.
  }
  const fresh = uuid();
  try {
    window.localStorage.setItem(CLIENT_ID_KEY, fresh);
  } catch {
    // Ignore; the memo keeps it stable for this page at least.
  }
  clientIdMemo = fresh;
  return fresh;
}

// One per page load. With ClientRouter in play a "page load" is the document's lifetime, not
// a navigation - which is the grouping we want, since it spans the tab-to-stats-and-back
// round trip that the sync bug was reported across.
const pageId = uuid();
export function getPageId(): string {
  return pageId;
}
