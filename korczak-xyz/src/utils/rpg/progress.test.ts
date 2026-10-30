import { describe, expect, it } from 'vitest';

import { DEFAULT_TYPICAL, learnTypical, progressOf, remainingMs, roughly, type Task } from './progress';

const t = { world: 10_000, quest: 10_000, ground: 4_000, model: 50_000, music: 60_000 };
const now = 1_000_000;

describe('remainingMs', () => {
  it('runs the music on its own line, after the world when it waits for it', () => {
    expect(remainingMs([{ kind: 'music', state: 'running', since: now - 20_000 }], now, t)).toBe(40_000);
    const waiting = [
      { kind: 'world', state: 'running', since: now },
      { kind: 'music', state: 'queued', since: null, afterWorld: true },
    ] as const;
    expect(remainingMs(waiting, now, t)).toBe(70_000);
  });

  it('is nothing once everything has ended', () => {
    expect(remainingMs([{ kind: 'world', state: 'done', since: null }, { kind: 'model', state: 'failed', since: null }], now, t)).toBe(0);
  });

  it('runs the opening after the world', () => {
    const tasks: Task[] = [
      { kind: 'world', state: 'running', since: now - 4_000 },
      { kind: 'quest', state: 'queued', since: null },
    ];
    expect(remainingMs(tasks, now, t)).toBe(6_000 + 10_000);
  });

  it('puts queued models on the first free of the workers', () => {
    const tasks: Task[] = [
      ...[0, 10, 20, 30].map((s): Task => ({ kind: 'model', state: 'running', since: now - s * 1000 })),
      { kind: 'model', state: 'queued', since: null },
    ];
    // Workers free at 50, 40, 30, 20 s; the queued one starts at 20 s and ends at 70 s.
    expect(remainingMs(tasks, now, t, 4)).toBe(70_000);
  });

  it('makes a world of ten in two rounds of the six fal runs at once', () => {
    const tasks = Array.from({ length: 10 }, (): Task => ({ kind: 'model', state: 'queued', since: null }));
    expect(remainingMs(tasks, now, { ...t, model: 25_000 })).toBe(50_000);
  });

  it('counts every running model, even more than the workers', () => {
    const tasks = Array.from({ length: 8 }, (): Task => ({ kind: 'model', state: 'running', since: now - 40_000 }));
    expect(remainingMs([...tasks, { kind: 'model', state: 'queued', since: null }], now, t, 6)).toBe(10_000 + 50_000);
  });

  it('starts nothing marked afterWorld before the world is in', () => {
    const tasks: Task[] = [
      { kind: 'world', state: 'running', since: now },
      { kind: 'model', state: 'queued', since: null, afterWorld: true },
      { kind: 'ground', state: 'queued', since: null, afterWorld: true },
    ];
    expect(remainingMs(tasks, now, t)).toBe(10_000 + 50_000);
  });

  it('keeps a little time on a task that overran its usual', () => {
    expect(remainingMs([{ kind: 'model', state: 'running', since: now - 90_000 }], now, t)).toBe(7_500);
  });
});

describe('progressOf', () => {
  it('counts the ended and says when all are', () => {
    const p = progressOf(
      [
        { kind: 'world', state: 'done', since: null },
        { kind: 'model', state: 'failed', since: null },
        { kind: 'model', state: 'running', since: now },
      ],
      now,
      t,
    );
    expect(p).toMatchObject({ total: 3, ended: 2, failed: 1, finished: false });
  });
});

describe('learnTypical', () => {
  it('moves a third of the way and ignores nonsense', () => {
    expect(learnTypical(DEFAULT_TYPICAL, 'model', 80_000).model).toBe(Math.round(DEFAULT_TYPICAL.model * 0.67 + 80_000 * 0.33));
    expect(learnTypical(DEFAULT_TYPICAL, 'model', NaN)).toBe(DEFAULT_TYPICAL);
  });
});

describe('roughly', () => {
  it('rounds up, by fives then by tens', () => {
    expect(roughly(3_000)).toBeNull();
    expect(roughly(31_000)).toEqual({ min: 0, s: 35 });
    expect(roughly(72_000)).toEqual({ min: 1, s: 20 });
  });
});
