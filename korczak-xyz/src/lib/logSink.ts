/*
 * Where log entries go.
 *
 * Entries land in a localStorage ring buffer first and are shipped to Firestore in batches.
 * The buffer is the point: the failure this logging exists to catch is one where the network
 * or the auth session is the thing that went wrong, so an entry that could only be delivered
 * live would be missing exactly when it mattered. Entries survive reloads and upload on the
 * next opportunity - including the next page load, or the next sign-in if the user was
 * signed out when they were recorded.
 *
 * Entries leave the buffer only once a write has resolved, so a failed flush retries rather
 * than loses. The cost of that is possible duplicates if a write lands but its
 * acknowledgement does not; batches carry the entries' own timestamps, so duplicates are
 * identifiable and harmless.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getClientId } from './clientId';
import { db } from './firebase';
import { getLogUid, type LogEntry } from './logger';

const BUFFER_KEY = 'logs:buffer';
// Ring-buffer caps. Whichever binds first wins; the byte cap is what actually protects the
// 5MB localStorage budget shared with progress and session logs.
const MAX_ENTRIES = 500;
const MAX_BYTES = 200_000;
// Entries per uploaded document. Well under Firestore's 1MB doc limit at any realistic
// entry size, and keeps one flush to one write.
const BATCH_SIZE = 200;
const FLUSH_INTERVAL_MS = 30_000;
// Backoff after consecutive failures: 5s, 15s, 45s, … capped.
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

let buffer: LogEntry[] = [];
let loaded = false;
let started = false;
let flushing = false;
let consecutiveFailures = 0;
let nextAttemptAt = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function store<T>(fn: (s: Storage) => T): T | null {
  try {
    return fn(window.localStorage);
  } catch {
    return null;
  }
}

function loadBuffer(): void {
  if (loaded) return;
  loaded = true;
  const raw = store((s) => s.getItem(BUFFER_KEY));
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as LogEntry[];
    if (Array.isArray(parsed)) buffer = parsed;
  } catch {
    buffer = [];
  }
}

// Drop oldest entries until both caps are satisfied.
function trim(): void {
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(buffer.length - MAX_ENTRIES);
  let serialized = JSON.stringify(buffer);
  while (serialized.length > MAX_BYTES && buffer.length > 1) {
    buffer = buffer.slice(Math.ceil(buffer.length / 4)); // drop a quarter at a time
    serialized = JSON.stringify(buffer);
  }
}

function persistNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  trim();
  store((s) => s.setItem(BUFFER_KEY, JSON.stringify(buffer)));
}

// Writing localStorage on every keystroke-adjacent log call would be its own performance
// problem, so ordinary entries coalesce into one write per tick. Errors and page teardown
// persist immediately - those are the entries most likely to be the last ones recorded.
function persistSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 1000);
}

export function enqueue(entry: LogEntry): void {
  if (typeof window === 'undefined') return;
  loadBuffer();
  start();
  buffer.push(entry);
  if (entry.level === 'error') {
    persistNow();
    void flush(); // get it off the device while we still can
  } else {
    persistSoon();
  }
}

function canFlush(): boolean {
  if (!db) return false;
  if (!getLogUid()) return false; // signed out: keep buffering, upload once a user appears
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  if (Date.now() < nextAttemptAt) return false;
  return true;
}

export async function flush(): Promise<void> {
  if (typeof window === 'undefined') return;
  loadBuffer();
  if (flushing || buffer.length === 0 || !canFlush()) return;

  const uid = getLogUid();
  if (!uid) return;

  flushing = true;
  try {
    // One batch per call. If more remains, the interval or the next error picks it up;
    // draining a large backlog in a loop would compete with the typing path for the
    // network on exactly the slow connections that created the backlog.
    const batch = buffer.slice(0, BATCH_SIZE);
    await addDoc(collection(db!, 'users', uid, 'logs'), {
      createdAt: serverTimestamp(),
      clientId: getClientId(),
      count: batch.length,
      from: batch[0]?.ts ?? null,
      to: batch[batch.length - 1]?.ts ?? null,
      entries: batch,
    });
    // Drop exactly what was uploaded. Entries appended during the write stay put; splicing
    // by count rather than reassigning avoids losing them.
    buffer.splice(0, batch.length);
    persistNow();
    consecutiveFailures = 0;
    nextAttemptAt = 0;
  } catch {
    consecutiveFailures += 1;
    nextAttemptAt =
      Date.now() + Math.min(BACKOFF_BASE_MS * 3 ** (consecutiveFailures - 1), BACKOFF_MAX_MS);
    // Deliberately not logged: a failing sink logging its own failure loops.
  } finally {
    flushing = false;
  }
}

// Called by useAuth when the signed-in user resolves, so a backlog recorded while signed out
// (the auth-resolution window - the one this logging most needs to see) uploads at once.
export function onAuthResolved(): void {
  nextAttemptAt = 0;
  consecutiveFailures = 0;
  void flush();
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  setInterval(() => void flush(), FLUSH_INTERVAL_MS);

  window.addEventListener('online', () => {
    nextAttemptAt = 0; // a reconnect invalidates any backoff earned while offline
    void flush();
  });

  // Teardown: persisting is the guarantee, flushing is best-effort. A Firestore write cannot
  // reliably complete during unload, so the contract is that nothing is lost - it uploads on
  // the next load instead.
  const onTeardown = () => {
    persistNow();
    void flush();
  };
  window.addEventListener('pagehide', onTeardown);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onTeardown();
  });
}

// Read side, for the debug console.
export function snapshot(): LogEntry[] {
  loadBuffer();
  return [...buffer];
}

export function clearBuffer(): void {
  buffer = [];
  persistNow();
}
