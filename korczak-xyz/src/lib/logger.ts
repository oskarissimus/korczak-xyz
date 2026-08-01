/*
 * Structured frontend logging.
 *
 * The typing trainer's cloud sync has failed silently in the past - every error path was a
 * bare `catch {}`, so a lost write left no trace anywhere. This module is the record: calls
 * are cheap, buffered locally, and shipped to Firestore by `logSink`.
 *
 * Nothing here may ever throw into the caller. A logger that can break the page it is
 * watching is worse than no logger, so every entry point swallows its own failures.
 */

import { getClientId, getPageId } from './clientId';
import { enqueue } from './logSink';

export { getClientId, getPageId };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number; // epoch ms
  level: LogLevel;
  event: string; // dotted name, e.g. 'sync.push.ok'
  clientId: string; // stable per browser profile
  pageId: string; // one per page load
  path: string; // location.pathname at the time
  online: boolean;
  uid: string | null;
  fields?: Record<string, unknown>;
}

const DEBUG_KEY = 'typing-debug';

// localStorage throws rather than degrades in a few real situations (Safari private mode,
// storage disabled by policy) - same defensive shape as authCache.ts.
function store<T>(fn: (s: Storage) => T): T | null {
  try {
    return fn(window.localStorage);
  } catch {
    return null;
  }
}

// The signed-in uid, pushed in by useAuth rather than pulled from Firebase, so this module
// stays free of an auth dependency (and works before Firebase has resolved anything).
let currentUid: string | null = null;
export function setLogUid(uid: string | null): void {
  currentUid = uid;
}
export function getLogUid(): string | null {
  return currentUid;
}

function consoleMirrorEnabled(): boolean {
  return store((s) => s.getItem(DEBUG_KEY)) === '1';
}

function emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: LogEntry = {
      ts: Date.now(),
      level,
      event,
      clientId: getClientId(),
      pageId: getPageId(),
      path: window.location?.pathname ?? '',
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      uid: currentUid,
      ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
    };
    if (consoleMirrorEnabled()) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[${event}]`, fields ?? '');
    }
    enqueue(entry);
  } catch {
    // A logger must never take the page down with it.
  }
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};

// Firestore rejects `undefined` and chokes on cyclic values, and an error object serializes
// to `{}` through JSON. Normalize anything unknown before it becomes a log field.
export function describeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      code: (e as { code?: string }).code ?? null,
      stack: e.stack?.slice(0, 2000) ?? null,
    };
  }
  return { message: String(e) };
}
