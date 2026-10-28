import { describe, expect, it } from 'vitest';

import { DEAD_MS, falJobId, hash, llmJobId, reuse, REUSE_LLM_MS, textRandom, UNCLAIMED_MS, worldPieceJobs, type JobDoc } from './jobs';
import { classicWorld } from './genesis';

const llm = { kind: 'llm' as const, provider: 'google' as const, models: ['a', 'b'], prompt: 'write', temperature: 1, thinking: null, parse: 'beat' as const };

describe('job ids', () => {
  it('are the work, not the moment: the same request, the same id; anything else, another', () => {
    expect(llmJobId(llm)).toBe(llmJobId({ ...llm }));
    expect(llmJobId(llm)).not.toBe(llmJobId({ ...llm, prompt: 'write.' }));
    expect(llmJobId(llm)).not.toBe(llmJobId({ ...llm, models: ['b', 'a'] }));
    expect(falJobId('w1/house')).toBe(falJobId('w1/house'));
    expect(falJobId('w1/house')).not.toBe(falJobId('w1_house'));
    // A Firestore document id: no slash, not too long.
    expect(falJobId('clue/w/1/2')).not.toContain('/');
    expect(falJobId('x'.repeat(2000)).length).toBeLessThan(200);
  });

  it('hash and the pick from an answer are stable across runtimes', () => {
    expect(hash('')).toBe(hash(''));
    expect(hash('abc')).toMatch(/^[0-9a-f]{16}$/);
    const r = textRandom('{"world":1}');
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
    expect(textRandom('{"world":1}')).toBe(r);
  });
});

describe('reuse', () => {
  const now = 10_000_000;
  const job = (patch: Partial<JobDoc>): JobDoc => ({
    spec: { ...llm, ctx: 'null', pieces: false },
    status: 'queued',
    createdAt: now,
    heartbeat: null,
    finishedAt: null,
    error: null,
    ...patch,
  });

  it('takes a running or fresh job, and a finished answer while it is fresh', () => {
    expect(reuse(job({}), now + 1000)).toBe('take');
    expect(reuse(job({ status: 'running', heartbeat: now }), now + DEAD_MS - 1)).toBe('take');
    expect(reuse(job({ status: 'done', outcome: 'generated' }), now + 1000)).toBe('take');
  });

  it('replaces what nobody picked up, a dead runner, a failure, an old answer and nothing', () => {
    expect(reuse(null, now)).toBe('replace');
    expect(reuse(job({}), now + UNCLAIMED_MS + 1)).toBe('replace');
    expect(reuse(job({ status: 'running', heartbeat: now }), now + DEAD_MS + 1)).toBe('replace');
    expect(reuse(job({ status: 'failed' }), now)).toBe('replace');
    expect(reuse(job({ status: 'abandoned' }), now)).toBe('replace');
    expect(reuse(job({ status: 'done', outcome: 'generated' }), now + REUSE_LLM_MS + 1)).toBe('replace');
  });

  it('keeps a made piece for good', () => {
    const piece = job({ spec: { kind: 'fal', label: 'house', prompt: 'p', size: 512, simplify: 0.98 }, status: 'done' });
    expect(reuse({ ...piece, result: { image: 'i', glb: 'g', costUsd: 0.023, ms: 1, queuedMs: 0, at: now } }, now + 30 * REUSE_LLM_MS)).toBe('take');
  });
});

describe('worldPieceJobs', () => {
  it("is every hub slot with the browser's ids and a mesh each", () => {
    const world = { ...classicWorld('en'), id: 'w-1', createdAt: 1 };
    const jobs = worldPieceJobs(world);
    expect(jobs.length).toBeGreaterThanOrEqual(8);
    expect(jobs[0].id).toBe(falJobId('w-1/landmark'));
    expect(jobs.every((j) => j.spec.simplify !== null && j.spec.size === 512)).toBe(true);
  });
});
