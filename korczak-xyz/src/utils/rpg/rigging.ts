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
 */
import { rememberTiming } from './progress';

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
}

let jobs: RigJob[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function changed(): void {
  for (const l of listeners) l();
}

/** Follows `made` (the template's promise) from now until it settles. */
export function trackRig(label: string, url: string, made: Promise<{ ms: number }>, now: () => number = Date.now): RigJob {
  const job: RigJob = { id: nextId++, label, url, startedAt: now(), endedAt: null, failed: false, workMs: 0 };
  jobs = [...jobs.slice(-199), job];
  changed();
  made.then(
    (t) => {
      job.endedAt = now();
      job.workMs = t.ms;
      if (t.ms > 0) rememberTiming('rig', job.endedAt - job.startedAt);
      changed();
    },
    () => {
      job.endedAt = now();
      job.failed = true;
      changed();
    },
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

export function resetRigs(): void {
  jobs = [];
  changed();
}
