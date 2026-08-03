/*
 * Storage write failures, which used to be invisible.
 *
 * The bug these cover: a full localStorage made `saveProgress` throw on every keystroke while
 * the page carried on typing and pushing to Firestore, so the next page load read back a
 * three-minute-old record and the sync engine pushed it over good cloud data. Nothing in the
 * logs said the write had failed, because the write was wrapped in a bare `catch {}`.
 *
 * There is no jsdom and no setup file in this project, so `localStorage` does not exist in
 * tests. The fake below is the point of the exercise rather than scaffolding around it: it has
 * a byte ceiling, so "the store is full" is a state a test can actually reach.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TypingProgress, TypingSession } from './types';
import { createDefaultProgress } from './types';

const logger = vi.hoisted(() => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/logger', () => ({
  ...logger,
  describeError: (e: unknown) => ({ name: (e as Error)?.name, message: String(e) }),
}));

const BOOK = 'krasnoludek';
const PROGRESS_KEY = `typing-progress:${BOOK}`;
const SESSIONS_KEY = 'typing-sessions';

class CappedStorage {
  private map = new Map<string, string>();
  constructor(public capacity: number) {}

  get length() {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  setItem(k: string, v: string): void {
    let total = k.length + v.length;
    for (const [key, value] of this.map) {
      if (key !== k) total += key.length + value.length;
    }
    if (total > this.capacity) {
      const e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, v);
  }
  // What `storageBytes()` should report.
  bytes(): number {
    let total = 0;
    for (const [key, value] of this.map) total += key.length + value.length;
    return total;
  }
}

let store: CappedStorage;

function install(capacity: number): void {
  store = new CappedStorage(capacity);
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
}

// A finished sitting, padded to a predictable size so capacity maths in the tests is exact.
function session(id: string, startedAt: number, events = 20): TypingSession {
  return {
    id,
    bookId: BOOK,
    startedAt,
    endedAt: startedAt + 1000,
    startPassageIndex: 0,
    startCharIndex: 0,
    events: Array.from({ length: events }, (_, i) => ({
      t: i,
      kind: 'char' as const,
      data: 'x',
      correct: true,
    })),
  };
}

// Progress carrying a `typedHistory`, which is what makes the real record large.
function progress(sections: number): TypingProgress {
  return {
    ...createDefaultProgress(BOOK),
    passageIndex: sections,
    completedPassages: sections,
    typedHistory: Array.from({ length: sections }, (_, i) => `section ${i} text\n`),
    totalKeystrokes: sections * 100,
    rev: sections,
    writerId: 'A',
  };
}

async function load() {
  vi.resetModules(); // `failingKeys` is module state: one page load per test
  return import('./storage');
}

beforeEach(() => {
  Object.values(logger.log).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('saveProgress', () => {
  it('writes when there is room, and says nothing', async () => {
    install(100_000);
    const { saveProgress, loadProgress } = await load();

    saveProgress(progress(5));

    expect(loadProgress(BOOK).passageIndex).toBe(5);
    expect(logger.log.error).not.toHaveBeenCalled();
  });

  it('reports a write that does not fit', async () => {
    install(50); // room for nothing
    const { saveProgress } = await load();

    saveProgress(progress(5));

    expect(store.getItem(PROGRESS_KEY)).toBeNull();
    expect(logger.log.error).toHaveBeenCalledTimes(1);
    const [event, fields] = logger.log.error.mock.calls[0];
    expect(event).toBe('storage.write.failed');
    expect(fields).toMatchObject({ key: PROGRESS_KEY, name: 'QuotaExceededError' });
    expect(fields.total).toBe(store.bytes());
  });

  /*
   * The reason the report is rate-limited. A full store fails again on the very next
   * keystroke, and an `error` entry makes the log sink persist and flush immediately - so an
   * unthrottled report would hammer the store that is already full, and bury the log buffer
   * in copies of one fact.
   */
  it('reports a persistently failing key only once', async () => {
    install(50);
    const { saveProgress } = await load();

    saveProgress(progress(5));
    saveProgress(progress(6));
    saveProgress(progress(7));

    expect(logger.log.error).toHaveBeenCalledTimes(1);
  });

  it('reports recovery once a failing key writes again', async () => {
    install(50);
    const { saveProgress } = await load();
    saveProgress(progress(5));
    expect(logger.log.error).toHaveBeenCalledTimes(1);

    store.capacity = 100_000;
    saveProgress(progress(5));

    expect(logger.log.info).toHaveBeenCalledTimes(1);
    expect(logger.log.info.mock.calls[0][0]).toBe('storage.write.recovered');
    // And the key is re-armed: a later failure is worth reporting again.
    store.capacity = 50;
    saveProgress(progress(6));
    expect(logger.log.error).toHaveBeenCalledTimes(2);
  });
});

describe('eviction under quota pressure', () => {
  /*
   * Progress is the thing that cannot be reconstructed; session keystroke logs are replayable
   * telemetry and are already mirrored to Firestore. So when only one of them fits, it is
   * always the archive that goes.
   */
  it('gives up the older half of the archive so progress can be written', async () => {
    const archive = [1, 2, 3, 4].map((n) => session(`s${n}`, n * 1000));
    const full = JSON.stringify(archive);
    const halved = JSON.stringify(archive.slice(2));
    const blob = JSON.stringify(progress(5));
    install(1_000_000);
    store.setItem(SESSIONS_KEY, full); // seeded directly: this write is not under test
    const { saveProgress } = await load();
    // Now enough room for the trimmed archive plus progress, but not the full archive plus
    // progress - so the write fails, and then fits on the retry.
    store.capacity = SESSIONS_KEY.length + halved.length + PROGRESS_KEY.length + blob.length;

    saveProgress(progress(5));

    expect(store.getItem(PROGRESS_KEY)).toBe(blob);
    const kept = JSON.parse(store.getItem(SESSIONS_KEY)!) as TypingSession[];
    expect(kept.map((s) => s.id)).toEqual(['s3', 's4']); // oldest two dropped
    expect(logger.log.warn).toHaveBeenCalledTimes(1);
    const [event, fields] = logger.log.warn.mock.calls[0];
    expect(event).toBe('storage.evicted');
    expect(fields).toMatchObject({ key: PROGRESS_KEY, droppedSessions: 2 });
    expect(fields.freedBytes).toBe(full.length - halved.length);
    // A recovered write is not a failure.
    expect(logger.log.error).not.toHaveBeenCalled();
  });

  it('still reports the failure when giving up the archive was not enough', async () => {
    install(1_000_000);
    store.setItem(SESSIONS_KEY, JSON.stringify([session('s1', 1000, 1)]));
    const { saveProgress } = await load();
    store.capacity = 80; // not even an empty archive leaves room for this progress record

    saveProgress(progress(40));

    expect(store.getItem(PROGRESS_KEY)).toBeNull();
    expect(logger.log.warn).toHaveBeenCalledTimes(1); // the archive was surrendered anyway
    expect(logger.log.error).toHaveBeenCalledTimes(1);
    expect(logger.log.error.mock.calls[0][0]).toBe('storage.write.failed');
  });

  /*
   * Trimming the archive to make room for the archive would be circular: the retry would write
   * the same oversized value that just failed. The archive write has to fail outright.
   */
  it('does not evict the archive to make room for the archive', async () => {
    const archive = [1, 2, 3].map((n) => session(`s${n}`, n * 1000));
    const full = JSON.stringify(archive);
    install(1_000_000);
    store.setItem(SESSIONS_KEY, full);
    const { removeArchivedSessions } = await load();
    // Room for neither the two-session archive nor the three-session one it replaces.
    store.capacity = SESSIONS_KEY.length + JSON.stringify(archive.slice(2)).length;

    removeArchivedSessions(['s1']);

    expect(logger.log.warn).not.toHaveBeenCalled(); // no 'storage.evicted'
    expect(store.getItem(SESSIONS_KEY)).toBe(full); // unchanged
    expect(logger.log.error).toHaveBeenCalledTimes(1);
    expect(logger.log.error.mock.calls[0][1]).toMatchObject({ key: SESSIONS_KEY });
  });
});

describe('removeArchivedSessions', () => {
  it('drops the named sessions and keeps the rest', async () => {
    install(100_000);
    store.setItem(
      SESSIONS_KEY,
      JSON.stringify([session('a', 1), session('b', 2), session('c', 3)])
    );
    const { removeArchivedSessions } = await load();

    removeArchivedSessions(['a', 'c']);

    const kept = JSON.parse(store.getItem(SESSIONS_KEY)!) as TypingSession[];
    expect(kept.map((s) => s.id)).toEqual(['b']);
  });

  it('leaves the archive untouched when nothing matches', async () => {
    install(100_000);
    const original = JSON.stringify([session('a', 1)]);
    store.setItem(SESSIONS_KEY, original);
    const { removeArchivedSessions } = await load();

    removeArchivedSessions(['b']);
    removeArchivedSessions([]);

    expect(store.getItem(SESSIONS_KEY)).toBe(original);
  });
});

describe('storageBytes', () => {
  it('totals every key on the origin, not just the trainer', async () => {
    install(100_000);
    store.setItem('solitaire-game-state', 'xxxxx');
    const { storageBytes, saveSelectedBookId } = await load();

    saveSelectedBookId(BOOK);

    expect(storageBytes()).toBe(store.bytes());
    expect(storageBytes()).toBe(
      'solitaire-game-state'.length + 5 + 'typing-selected-book'.length + BOOK.length
    );
  });
});
