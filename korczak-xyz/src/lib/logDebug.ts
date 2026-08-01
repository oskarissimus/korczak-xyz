/*
 * `window.typingLogs` - console access to the frontend log buffer, in the same spirit as the
 * `window.solitaire` debug interface documented in CLAUDE.md.
 *
 * The point is being able to read what happened on the machine where something went wrong,
 * without waiting for the Firestore upload or leaving the page.
 */

import { getClientId, getPageId } from './clientId';
import { clearBuffer, flush, snapshot } from './logSink';
import { getLogUid, type LogEntry } from './logger';

const DEBUG_KEY = 'typing-debug';

interface TypingLogsApi {
  dump: () => LogEntry[];
  tail: (n?: number) => LogEntry[];
  find: (pattern: string) => LogEntry[];
  show: (n?: number) => void;
  flush: () => Promise<void>;
  clear: () => void;
  verbose: (on?: boolean) => string;
  info: () => { clientId: string; pageId: string; uid: string | null; buffered: number };
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
        console.log('(log buffer empty)');
        return;
      }
      console.log(rows.map(fmt).join('\n'));
    },
    flush: () => flush(),
    clear: () => clearBuffer(),
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
    }),
    help: () => {
      console.log(
        [
          'typingLogs.show(n)     print the last n entries (default 40)',
          'typingLogs.tail(n)     last n entries as objects',
          'typingLogs.dump()      the whole buffer',
          "typingLogs.find('sync') entries whose event contains a string",
          'typingLogs.flush()     upload the buffer now (needs sign-in + network)',
          'typingLogs.clear()     discard the buffer',
          'typingLogs.verbose()   mirror new entries to the console',
          'typingLogs.info()      client id, page id, uid, buffered count',
        ].join('\n')
      );
    },
  };
}
