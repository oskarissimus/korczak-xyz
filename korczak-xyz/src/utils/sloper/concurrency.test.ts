import { describe, expect, it } from 'vitest';

import { ConcurrencyLimiter } from './concurrency';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ConcurrencyLimiter', () => {
  it('runs no more than the width at once', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: number[] = [];

    const jobs = gates.map((gate, i) =>
      limiter.add(async () => {
        started.push(i);
        await gate.promise;
        return i;
      }),
    );

    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(limiter.runningCount).toBe(2);
    expect(limiter.pendingCount).toBe(1);

    gates[0].resolve();
    await jobs[0];
    // The caller's promise settles one microtask before the slot is released — `add` resolves it
    // in a `.then` and the pump runs in the `.finally` after it — so the queue has not moved yet.
    expect(started).toEqual([0, 1]);
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve();
    gates[2].resolve();
    expect(await Promise.all(jobs)).toEqual([0, 1, 2]);
  });

  /*
   * The one that matters: a refused image must not hold the queue. Twelve scenes with a
   * rate-limited key would otherwise stop at the first 429 and the eleven behind it would sit
   * queued for ever, looking exactly like a generation still in progress.
   */
  it('frees its slot when a job rejects, and keeps going', async () => {
    const limiter = new ConcurrencyLimiter(1);

    const failed = limiter.add(async () => {
      throw new Error('429');
    });
    const after = limiter.add(async () => 'ok');

    await expect(failed).rejects.toThrow('429');
    expect(await after).toBe('ok');
    expect(limiter.runningCount).toBe(0);
  });

  /*
   * A task that throws synchronously — a null key dereferenced before the first await — must
   * reject the promise `add` returned, not escape out of the pump. Escaping leaves that promise
   * pending for ever, which is a scene card stuck on "Working" with nothing to retry.
   */
  it('turns a synchronous throw into a rejection', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const thrown = limiter.add((() => {
      throw new Error('boom');
    }) as () => Promise<never>);

    await expect(thrown).rejects.toThrow('boom');
    expect(limiter.runningCount).toBe(0);
  });

  it('carries each caller its own result type', async () => {
    const limiter = new ConcurrencyLimiter(4);
    const [text, count] = await Promise.all([
      limiter.add(async () => 'a string'),
      limiter.add(async () => 42),
    ]);
    expect(text).toBe('a string');
    expect(count).toBe(42);
  });
});
