/*
 * Every generated person being rigged (`People.template` in `components/Rpg/people.ts`), for the
 * start's progress (owner, 2 Nov 2026: "the processing through our rigging endpoint is outside the
 * main loading bar of the world and the quest, and sometimes takes a long time — put it in"). A rig
 * is the person's GLB fetched and checked, the joints worked out in the worker, and with SkinTokens
 * the weights from the service behind the gateway: half a minute or more, after the model itself
 * has come, and until it ends the person is not in the scene at all.
 *
 * Tracked from the moment the scene asks until the template is there — a rig answered from the
 * cache too, so the bar knows it ended — with how long it took and whether any work was done.
 * A rig that did work teaches the usual time (`rememberTiming('rig')`), the whole of it from the
 * ask, since that is the wait the bar estimates. No DOM beyond that localStorage, so it can be tested.
 *
 * STAGES (owner, 10 Nov 2026: "a stickman on the rig before the model, then the model, then the model
 * with the simple rig, then with the advanced one"). A person in the game is brought in stage by stage
 * (`People.staged`), and each stage's time from the ask is kept on the job (`rigStage`): the stickman,
 * the static model, our quick rig (`fit`), and the full one (SkinTokens or Meshy). The person moves
 * from the first rig on, so that — not the full rig — is when the start's bar counts them in
 * (`moving`), and what teaches the usual time. The full rig carries on after, in the console.
 */
import { rememberTiming } from './progress';

/** How far along a person is, worst to best: see `STAGE_RANK` in `components/Rpg/people.ts`. */
export type RigStage = 'stickman' | 'static' | 'fast' | 'full';

export interface RigJob {
  id: number;
  /** The piece's label: `person`, `hero` or `enemy`. */
  label: string;
  url: string;
  startedAt: number;
  endedAt: number | null;
  /** Neither the rig asked for nor its fallback could be made. */
  failed: boolean;
  /** The rig's own work in ms; 0 when it came from this browser's cache or the account. */
  workMs: number;
  /** When each stage first came, in ms from `startedAt` (`rigStage`); empty for the lab's one-go rigs. */
  stages: Partial<Record<RigStage, number>>;
}

/** The person moves: a rig is in (either one), or the job has ended. */
export function moving(job: RigJob): boolean {
  return job.endedAt !== null || job.stages.fast !== undefined || job.stages.full !== undefined;
}

let jobs: RigJob[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function changed(): void {
  for (const l of listeners) l();
}

/** A rig asked for now, ended by `endRig`. */
export function startRig(label: string, url: string, now: () => number = Date.now): RigJob {
  const job: RigJob = { id: nextId++, label, url, startedAt: now(), endedAt: null, failed: false, workMs: 0, stages: {} };
  jobs = [...jobs.slice(-199), job];
  changed();
  return job;
}

/**
 * A stage of the person came (`People.staged`). The first rig to come teaches the usual time when it
 * was worked out rather than read from a cache (`worked`), since it is what the start's bar waits for.
 */
export function rigStage(job: RigJob, stage: RigStage, worked: boolean, now: () => number = Date.now): void {
  if (job.stages[stage] !== undefined) return;
  const wasMoving = moving(job);
  job.stages[stage] = now() - job.startedAt;
  if (!wasMoving && (stage === 'fast' || stage === 'full') && worked) rememberTiming('rig', job.stages[stage]!);
  changed();
}

/** The last rig is in with `workMs` of its own work, or (`null`) not even the fallback could be made. */
export function endRig(job: RigJob, workMs: number | null, now: () => number = Date.now): void {
  const wasMoving = moving(job);
  job.endedAt = now();
  job.failed = workMs === null;
  job.workMs = workMs ?? 0;
  if (!wasMoving && workMs) rememberTiming('rig', job.endedAt - job.startedAt);
  changed();
}

/** Follows `made` (the template's promise) from now until it settles. */
export function trackRig(label: string, url: string, made: Promise<{ ms: number }>, now: () => number = Date.now): RigJob {
  const job = startRig(label, url, now);
  made.then(
    (t) => endRig(job, t.ms, now),
    () => endRig(job, null, now),
  );
  return job;
}

export function rigJobs(): readonly RigJob[] {
  return jobs;
}

export function subscribeRigs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The rigs that belong to a start begun at `since`: every one asked since, and one still running
 * from before. With no start this session (a saved game opened), only a rig that does real work —
 * one running or having run past `quick` — so a page load's rigs from the cache do not put the
 * panel up for a moment and its *World ready* for ten seconds.
 */
export function rigsOfStart(since: number | null, now: number, quick = 1_500): RigJob[] {
  return jobs.filter((j) => {
    if (since !== null) return j.startedAt >= since || j.endedAt === null;
    return (j.endedAt ?? now) - j.startedAt > quick;
  });
}

/**
 * For the console: how many rigs, how many did real work (not from a cache), the wall time from the
 * first one asked to the last one in (they overlap), and the longest single one.
 */
export function rigSummary(list: readonly RigJob[], now: number): { count: number; worked: number; spanMs: number; longestMs: number } {
  if (list.length === 0) return { count: 0, worked: 0, spanMs: 0, longestMs: 0 };
  let first = Infinity;
  let last = 0;
  let longestMs = 0;
  let worked = 0;
  for (const j of list) {
    const end = j.endedAt ?? now;
    first = Math.min(first, j.startedAt);
    last = Math.max(last, end);
    longestMs = Math.max(longestMs, end - j.startedAt);
    if (j.workMs > 0) worked++;
  }
  return { count: list.length, worked, spanMs: last - first, longestMs };
}

/**
 * For the console: the longest time from the ask to each stage across `list` (the slowest person is
 * what the reader waited for), `null` where no person has reached that stage.
 */
export function stageSummary(list: readonly RigJob[]): Record<RigStage, number | null> {
  const out: Record<RigStage, number | null> = { stickman: null, static: null, fast: null, full: null };
  for (const j of list)
    for (const [stage, ms] of Object.entries(j.stages) as [RigStage, number][]) out[stage] = Math.max(out[stage] ?? 0, ms);
  return out;
}

export function resetRigs(): void {
  jobs = [];
  changed();
}
