/*
 * The job document is the contract between a browser and a Cloud Function, so what is tested here
 * is the round trip rather than either half: what `buildAssemblyJob` writes has to be what
 * `readAssemblyJob` reads, because between those two calls is a Firestore document, a deploy, and
 * possibly a week.
 *
 * It is the same argument `handler.test.ts` makes about the multipart form, with one difference
 * that makes it cheaper: both ends compile from this file, so the test can hold them side by side
 * instead of rebuilding one of them.
 */

import { describe, expect, it } from 'vitest';

import {
  AssemblyJobError,
  MAX_ATTEMPTS,
  MAX_SCENES,
  STALE_MS,
  assemblyJobId,
  assetObjectPath,
  buildAssemblyJob,
  isInProjectFolder,
  jobIsLive,
  jobIsStale,
  jobNeedsStarting,
  readAssemblyJob,
  videoObjectPath,
  type AssemblyJob,
} from './job';

const NOW = 1_700_000_000_000;

function scene(i: number) {
  return {
    imagePath: `users/u1/sloper/p1/img${i}.jpg`,
    audioPath: `users/u1/sloper/p1/aud${i}.mp3`,
    imageDuration: 4.2,
  };
}

function job(overrides: Partial<AssemblyJob> = {}): AssemblyJob {
  return {
    ...buildAssemblyJob({
      projectId: 'p1',
      scenes: [scene(0), scene(1)],
      resolution: { width: 1024, height: 1536 },
      frameRate: 30,
      now: NOW,
    }),
    ...overrides,
  };
}

describe('the job a browser writes and a function reads', () => {
  it('survives the round trip unchanged', () => {
    const written = job();
    // What Firestore does to it in between: JSON, and nothing else this file may depend on.
    expect(readAssemblyJob(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it('is filed under the project, so there is never a second current one', () => {
    expect(assemblyJobId('Kx3_pQ2mTaV')).toBe('Kx3_pQ2mTaV');
  });

  it('refuses a sitting with nothing finished in it', () => {
    expect(() =>
      buildAssemblyJob({
        projectId: 'p1',
        scenes: [],
        resolution: { width: 1024, height: 1024 },
        frameRate: 30,
        now: NOW,
      }),
    ).toThrow(AssemblyJobError);
  });

  it('refuses more scenes than an instance can hold', () => {
    const scenes = Array.from({ length: MAX_SCENES + 1 }, (_, i) => scene(i));
    expect(() =>
      buildAssemblyJob({
        projectId: 'p1',
        scenes,
        resolution: { width: 1024, height: 1024 },
        frameRate: 30,
        now: NOW,
      }),
    ).toThrow(/at most/);
  });

  // libx264 refuses an odd dimension under yuv420p, and the refusal arrives as an ffmpeg error
  // several minutes into an encode rather than as anything a reader could act on.
  it('makes both dimensions even, at both ends', () => {
    const built = job({ resolution: { width: 1025, height: 1537 } });
    expect(buildAssemblyJob({ ...built, now: NOW }).resolution).toEqual({ width: 1024, height: 1536 });
    expect(readAssemblyJob({ ...built }).resolution).toEqual({ width: 1024, height: 1536 });
  });

  it('will not read a duration that would reach ffmpeg as nonsense', () => {
    const broken = { ...job(), scenes: [{ ...scene(0), imageDuration: Number.NaN }] };
    expect(() => readAssemblyJob(broken)).toThrow(AssemblyJobError);
  });

  it('reads an unknown status as queued rather than as a new kind of job', () => {
    expect(readAssemblyJob({ ...job(), status: 'sideways' }).status).toBe('queued');
  });
});

describe('what a path in a job is allowed to name', () => {
  it('accepts the folder this project owns', () => {
    expect(isInProjectFolder(assetObjectPath('u1', 'p1', 'a1', 'image'), 'u1', 'p1')).toBe(true);
    expect(isInProjectFolder(videoObjectPath('u1', 'p1'), 'u1', 'p1')).toBe(true);
  });

  // The assembler reads the bucket on the Admin SDK, which is outside storage.rules entirely, so
  // this check is the rule. A forged path is the whole reason it exists.
  it('refuses another account, another project, and a way out of either', () => {
    expect(isInProjectFolder('users/u2/sloper/p1/a1.jpg', 'u1', 'p1')).toBe(false);
    expect(isInProjectFolder('users/u1/sloper/p2/a1.jpg', 'u1', 'p1')).toBe(false);
    expect(isInProjectFolder('users/u1/sloper/p1/../p2/a1.jpg', 'u1', 'p1')).toBe(false);
    expect(isInProjectFolder('users/u1/sloper/p1/', 'u1', 'p1')).toBe(false);
  });

  it('spells the extension the way the browser uploaded it', () => {
    expect(assetObjectPath('u1', 'p1', 'a1', 'image')).toBe('users/u1/sloper/p1/a1.jpg');
    expect(assetObjectPath('u1', 'p1', 'a1', 'audio')).toBe('users/u1/sloper/p1/a1.mp3');
  });
});

describe('deciding what to do about a job that is already there', () => {
  it('leaves a running encode alone while it is heartbeating', () => {
    const running = job({ status: 'running', startedAt: NOW, heartbeatAt: NOW, attempts: 1 });
    expect(jobIsStale(running, NOW + 20_000)).toBe(false);
    expect(jobNeedsStarting(running, NOW + 20_000)).toBe(false);
    expect(jobIsLive(running, NOW + 20_000)).toBe(true);
  });

  it('takes back a claim nobody is behind any more', () => {
    const abandoned = job({ status: 'running', startedAt: NOW, heartbeatAt: NOW, attempts: 1 });
    const later = NOW + STALE_MS + 1;
    expect(jobIsStale(abandoned, later)).toBe(true);
    expect(jobNeedsStarting(abandoned, later)).toBe(true);
    expect(jobIsLive(abandoned, later)).toBe(false);
  });

  // The page pokes on every opening, so without this a job that kills its instance is re-run for
  // as long as somebody keeps coming back to look at it.
  it('stops offering one that has had its three goes', () => {
    const spent = job({ status: 'queued', attempts: MAX_ATTEMPTS });
    expect(jobNeedsStarting(spent, NOW)).toBe(false);
  });

  it('treats a fresh job as wanting a poke', () => {
    expect(jobNeedsStarting(job(), NOW)).toBe(true);
    expect(jobIsLive(job(), NOW)).toBe(true);
  });

  it('is finished with one that is done or failed', () => {
    expect(jobIsLive(job({ status: 'done' }), NOW)).toBe(false);
    expect(jobIsLive(job({ status: 'error' }), NOW)).toBe(false);
    expect(jobNeedsStarting(job({ status: 'error' }), NOW)).toBe(false);
  });
});
