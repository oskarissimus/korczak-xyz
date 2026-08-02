import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recycleDb = vi.fn(() => true);

vi.mock('./firebase', () => ({
  getDb: () => ({}),
  recycleDb,
}));
vi.mock('./logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Fresh module per test: the cooldown and the install guard are module state.
async function load() {
  vi.resetModules();
  return import('./firestoreHealth');
}

describe('runCloud', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recycleDb.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes a resolved value straight through', async () => {
    const { runCloud } = await load();
    await expect(runCloud('x', async () => 42)).resolves.toBe(42);
    expect(recycleDb).not.toHaveBeenCalled();
  });

  it('rejects a call that never settles, rather than hanging with it', async () => {
    const { runCloud, FirestoreStalledError } = await load();
    // The shape of a call made against a dead Firestore client: no resolve, no reject, ever.
    const promise = runCloud('stuck', () => new Promise<never>(() => undefined));
    const assertion = expect(promise).rejects.toBeInstanceOf(FirestoreStalledError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('replaces the client when a call stalls', async () => {
    const { runCloud } = await load();
    const promise = runCloud('stuck', () => new Promise<never>(() => undefined));
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(recycleDb).toHaveBeenCalledTimes(1);
  });

  it('replaces the client when a call throws the SDK internal assertion', async () => {
    const { runCloud } = await load();
    const panic = new Error(
      'FIRESTORE (12.15.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: 3c6b)'
    );
    await expect(runCloud('panicky', () => Promise.reject(panic))).rejects.toThrow(panic);
    expect(recycleDb).toHaveBeenCalledTimes(1);
  });

  it('leaves the client alone for an ordinary rejection', async () => {
    const { runCloud } = await load();
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    await expect(runCloud('denied', () => Promise.reject(denied))).rejects.toThrow(denied);
    expect(recycleDb).not.toHaveBeenCalled();
  });

  it('does not replace the client repeatedly inside the cooldown', async () => {
    const { recoverFirestore } = await load();
    recoverFirestore('first');
    recoverFirestore('second');
    recoverFirestore('third');
    expect(recycleDb).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31_000);
    recoverFirestore('later');
    expect(recycleDb).toHaveBeenCalledTimes(2);
  });

  it('clears its deadline timer once a call comes back', async () => {
    const { runCloud } = await load();
    await runCloud('quick', async () => 'ok');
    // A leaked timer would fire here and recycle a perfectly healthy client.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(recycleDb).not.toHaveBeenCalled();
  });
});

describe('isRecoverableClientError', () => {
  it('recognises a stall and an internal assertion, and nothing else', async () => {
    const { isRecoverableClientError, FirestoreStalledError } = await load();
    expect(isRecoverableClientError(new FirestoreStalledError('x'))).toBe(true);
    expect(isRecoverableClientError(new Error('INTERNAL ASSERTION FAILED: nope'))).toBe(true);
    expect(isRecoverableClientError(new Error('unavailable'))).toBe(false);
    expect(isRecoverableClientError(null)).toBe(false);
  });
});
