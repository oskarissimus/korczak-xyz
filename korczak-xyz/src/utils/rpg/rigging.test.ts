import { beforeEach, describe, expect, it } from 'vitest';

import { endRig, moving, resetRigs, rigJobs, rigsOfStart, rigStage, rigSummary, stageSummary, startRig, trackRig } from './rigging';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('rigging', () => {
  beforeEach(() => resetRigs());

  it('follows a rig until its template is there, and a failed one as failed', async () => {
    let clock = 1_000;
    const now = () => clock;
    let done!: (v: { ms: number }) => void;
    trackRig('person', 'a.glb', new Promise((r) => (done = r)), now);
    trackRig('hero', 'b.glb', Promise.reject(new Error('no')), now);
    expect(rigJobs()[0].endedAt).toBeNull();
    clock = 31_000;
    done({ ms: 29_000 });
    await settle();
    expect(rigJobs()[0]).toMatchObject({ endedAt: 31_000, failed: false, workMs: 29_000 });
    expect(rigJobs()[1].failed).toBe(true);
  });

  it('counts the rigs of this start, and with no start only the slow ones', async () => {
    let clock = 1_000;
    const now = () => clock;
    trackRig('person', 'cached.glb', Promise.resolve({ ms: 0 }), now);
    await settle();
    clock = 5_000;
    trackRig('person', 'slow.glb', new Promise(() => {}), now);
    clock = 10_000;
    expect(rigsOfStart(4_000, clock).map((j) => j.url)).toEqual(['slow.glb']);
    expect(rigsOfStart(null, clock).map((j) => j.url)).toEqual(['slow.glb']);
    expect(rigSummary(rigsOfStart(null, clock), clock)).toEqual({ count: 1, worked: 0, spanMs: 5_000, longestMs: 5_000 });
  });

  it('keeps each stage once, and the person counts as in once the first rig moves them', () => {
    let clock = 1_000;
    const now = () => clock;
    const a = startRig('person', 'a.glb', now);
    clock = 1_050;
    rigStage(a, 'stickman', false, now);
    clock = 3_000;
    rigStage(a, 'static', false, now);
    expect(moving(a)).toBe(false);
    clock = 5_000;
    rigStage(a, 'fast', true, now);
    expect(moving(a)).toBe(true);
    clock = 6_000;
    rigStage(a, 'fast', true, now);
    clock = 40_000;
    rigStage(a, 'full', true, now);
    endRig(a, 34_000, now);
    expect(a.stages).toEqual({ stickman: 50, static: 2_000, fast: 4_000, full: 39_000 });
    const b = startRig('hero', 'b.glb', now);
    clock = 41_000;
    rigStage(b, 'static', false, now);
    endRig(b, null, now);
    expect(b.failed).toBe(true);
    expect(stageSummary([a, b])).toEqual({ stickman: 50, static: 2_000, fast: 4_000, full: 39_000 });
    expect(stageSummary([b])).toEqual({ stickman: null, static: 1_000, fast: null, full: null });
  });
});
