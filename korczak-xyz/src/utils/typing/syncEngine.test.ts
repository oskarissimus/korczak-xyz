/*
 * The engine's recovery paths, driven through the real cloudStorage + firestoreHealth stack so
 * that what is under test is the whole chain from `firebase/firestore` upwards.
 *
 * The case that matters here is a Firestore client that has died: its calls return promises
 * that are never settled at all. Before the deadline in firestoreHealth, a single such call
 * left `writeInFlight` set forever - the engine reported a sync permanently in progress and
 * every later edit coalesced into a write that could not happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProgress, type TypingProgress } from './types';

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  ...firestore,
  doc: (...path: unknown[]) => ({ path }),
  collection: (...path: unknown[]) => ({ path }),
  terminate: vi.fn(async () => undefined),
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('../../lib/firebase', () => ({
  getDb: () => ({}),
  recycleDb: vi.fn(() => true),
  auth: null,
  firebaseEnabled: false,
}));

vi.mock('../../lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  describeError: (e: unknown) => ({ error: String(e) }),
}));

const BOOK = 'krasnoludek';
const UID = 'user-1';

/** A promise that behaves like a call to a Firestore client whose queue has died. */
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function docSnap(data: TypingProgress | null) {
  return { exists: () => data != null, data: () => data };
}

/** Minimal window/navigator so the engine can register and receive online/offline events. */
function installFakeWindow() {
  const handlers = new Map<string, Set<() => void>>();
  const win = {
    addEventListener: (type: string, fn: () => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => handlers.get(type)?.delete(fn),
  };
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
  return {
    dispatch: (type: string) => handlers.get(type)?.forEach((fn) => fn()),
    teardown: () => {
      Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

async function makeEngine(local: TypingProgress) {
  vi.resetModules();
  const { ProgressSyncEngine } = await import('./syncEngine');
  const applyRemote = vi.fn();
  const engine = new ProgressSyncEngine({
    uid: UID,
    bookId: BOOK,
    getLocal: () => local,
    applyRemote,
    onState: () => undefined,
  });
  return { engine, applyRemote };
}

function progressAt(passageIndex: number, rev: number): TypingProgress {
  return {
    ...createDefaultProgress(BOOK),
    passageIndex,
    completedPassages: passageIndex,
    typedHistory: Array.from({ length: passageIndex }, (_, i) => `section ${i}`),
    totalKeystrokes: passageIndex * 100,
    rev,
    writerId: 'device-A',
    updatedAt: 1_000 + rev,
    lastPlayedAt: 1_000 + rev,
  };
}

describe('ProgressSyncEngine recovery', () => {
  let dom: ReturnType<typeof installFakeWindow>;

  beforeEach(() => {
    vi.useFakeTimers();
    dom = installFakeWindow();
    Object.values(firestore).forEach((fn) => fn.mockReset());
  });

  afterEach(() => {
    dom.teardown();
    vi.useRealTimers();
  });

  it('does not stay "syncing" forever when a write never comes back', async () => {
    firestore.getDoc.mockResolvedValue(docSnap(null));
    // First write hangs the way a dead client's does; the second is against a live one.
    firestore.runTransaction
      .mockImplementationOnce(() => neverSettles())
      .mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ get: async () => docSnap(null), set: () => undefined })
      );
    // Empty local progress: reconcile decides 'in-sync', so the hang below is the push.
    const { engine } = await makeEngine(createDefaultProgress(BOOK));

    await engine.start();
    expect(engine.getState().status).toBe('synced');

    engine.flush('test');
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getState().status).toBe('syncing');

    // Without a deadline this is where it stopped, for the rest of the page's life.
    await vi.advanceTimersByTimeAsync(26_000);
    expect(engine.getState().status).not.toBe('syncing');
    expect(engine.getState().error).toBe('write-failed');
    expect(engine.getState().pendingWork).toBe(true); // a retry is scheduled

    // And the retry, once the client is healthy again, actually lands.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(engine.getState().status).toBe('synced');
    expect(engine.getState().error).toBeNull();
    expect(engine.getState().lastSyncedAt).not.toBeNull();
  });

  it('retries an initial reconcile that never came back', async () => {
    firestore.getDoc
      .mockImplementationOnce(() => neverSettles())
      .mockResolvedValue(docSnap(progressAt(4, 9)));
    const { engine, applyRemote } = await makeEngine(createDefaultProgress(BOOK));

    const started = engine.start();
    await vi.advanceTimersByTimeAsync(26_000);
    await started;
    expect(engine.getState().error).toBe('reconcile-failed');
    expect(engine.getState().pendingWork).toBe(true);

    // The scheduled retry re-runs the reconcile rather than pushing over a cloud copy this
    // engine has still never read.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
    expect(applyRemote).toHaveBeenCalledTimes(1);
    expect(engine.getState().error).toBeNull();
    expect(engine.getState().status).toBe('synced');
  });

  it('reconciles again on reconnect rather than waiting out the backoff', async () => {
    firestore.getDoc
      .mockImplementationOnce(() => neverSettles())
      .mockResolvedValue(docSnap(progressAt(4, 9)));
    const { engine, applyRemote } = await makeEngine(createDefaultProgress(BOOK));

    const started = engine.start();
    await vi.advanceTimersByTimeAsync(26_000);
    await started;
    expect(engine.getState().error).toBe('reconcile-failed');

    dom.dispatch('online');
    await vi.advanceTimersByTimeAsync(0);
    expect(applyRemote).toHaveBeenCalledTimes(1);
    expect(engine.getState().status).toBe('synced');
  });

  it('writes edits that arrived while the initial reconcile was in flight', async () => {
    let local = createDefaultProgress(BOOK);
    firestore.getDoc.mockResolvedValue(docSnap(null));
    firestore.runTransaction.mockImplementation(
      async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ get: async () => docSnap(null), set: () => undefined })
    );
    vi.resetModules();
    const { ProgressSyncEngine } = await import('./syncEngine');
    const engine = new ProgressSyncEngine({
      uid: UID,
      bookId: BOOK,
      getLocal: () => local,
      applyRemote: vi.fn(),
      onState: () => undefined,
    });

    const started = engine.start();
    // A keystroke lands before the reconcile settles: `push` parks it, since writing before
    // the cloud copy has been read could overwrite it.
    local = progressAt(2, 1);
    engine.flush('typing');
    await started;
    await vi.advanceTimersByTimeAsync(0);

    expect(firestore.runTransaction).toHaveBeenCalled();
    expect(engine.getState().pendingWork).toBe(false);
    expect(engine.getState().status).toBe('synced');
  });
});
