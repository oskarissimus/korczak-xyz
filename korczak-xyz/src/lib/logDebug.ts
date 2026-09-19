/*
 * `window.typingLogs` - console access to the frontend log tail, in the same spirit as the
 * `window.solitaire` debug interface documented in CLAUDE.md.
 *
 * The point is being able to read what happened on the machine where something went wrong,
 * without leaving the page. That was worth having when the entries were queued for a Firestore
 * upload, and it is worth having now that they are Sentry breadcrumbs: a breadcrumb is only
 * visible once something else fails and carries it along, so during a reproduction the tail is
 * the only way to watch the events go by.
 */

import { flush as flushSentry } from '@sentry/browser';
import { getClientId, getPageId } from './clientId';
import { clearTail, getLogUid, snapshot, type LogEntry } from './logger';
import { sentryReady } from './sentry';

const DEBUG_KEY = 'typing-debug';

interface TypingLogsApi {
  dump: () => LogEntry[];
  tail: (n?: number) => LogEntry[];
  find: (pattern: string) => LogEntry[];
  show: (n?: number) => void;
  flush: () => Promise<boolean>;
  clear: () => void;
  verbose: (on?: boolean) => string;
  info: () => {
    clientId: string;
    pageId: string;
    uid: string | null;
    buffered: number;
    sentry: boolean;
  };
  help: () => void;
}

declare global {
  interface Window {
    typingLogs?: TypingLogsApi;
  }
}

function fmt(e: LogEntry): string {
  const time = new Date(e.ts).toISOString().slice(11, 23);
  const fields = e.fields ? ` ${JSON.stringify(e.fields)}` : '';
  return `${time} ${e.level.toUpperCase().padEnd(5)} ${e.event}${fields}`;
}

let installed = false;

export function installLogDebug(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.typingLogs = {
    dump: () => snapshot(),
    tail: (n = 20) => snapshot().slice(-n),
    find: (pattern: string) => snapshot().filter((e) => e.event.includes(pattern)),
    show: (n = 40) => {
      const rows = snapshot().slice(-n);
      if (rows.length === 0) {
        console.log('(log tail empty)');
        return;
      }
      console.log(rows.map(fmt).join('\n'));
    },
    // Sentry sends errors as they happen; this only matters when you are about to close the tab
    // and want to be sure the last one left. Resolves false if the queue did not drain in time.
    flush: () => flushSentry(2000),
    clear: () => clearTail(),
    verbose: (on = true) => {
      try {
        if (on) window.localStorage.setItem(DEBUG_KEY, '1');
        else window.localStorage.removeItem(DEBUG_KEY);
      } catch {
        return 'localStorage unavailable';
      }
      return on ? 'console mirroring on' : 'console mirroring off';
    },
    info: () => ({
      clientId: getClientId(),
      pageId: getPageId(),
      uid: getLogUid(),
      buffered: snapshot().length,
      sentry: sentryReady(),
    }),
    help: () => {
      console.log(
        [
          'typingLogs.show(n)     print the last n entries (default 40)',
          'typingLogs.tail(n)     last n entries as objects',
          'typingLogs.dump()      the whole in-memory tail (not persisted, max 200)',
          "typingLogs.find('sync') entries whose event contains a string",
          'typingLogs.flush()     wait for queued Sentry events to send',
          'typingLogs.clear()     discard the tail',
          'typingLogs.verbose()   mirror new entries to the console',
          'typingLogs.info()      client id, page id, uid, tail size, whether Sentry is up',
        ].join('\n')
      );
    },
  };
}
