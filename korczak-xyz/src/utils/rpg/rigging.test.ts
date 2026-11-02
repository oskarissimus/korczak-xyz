import { beforeEach, describe, expect, it } from 'vitest';

import { resetRigs, rigJobs, rigsOfStart, rigSummary, trackRig } from './rigging';

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
});
