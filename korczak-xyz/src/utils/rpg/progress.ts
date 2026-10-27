/*
 * How far the start has got and how long it has left (owner, 27 Oct 2026: "the storyteller is
 * writing a quest" said nothing useful; "I'd like to know whether what I see is already everything,
 * and roughly how long it takes"). The start is three lines of work that overlap: the world's bible
 * and then the opening beat, one after the other; the ground, one picture; and fal.ai's 3D models,
 * all asked for at once and made as many at a time as fal runs for the account (`FAL_RUNNING`).
 * Each is a task here, done, running since some moment, queued or failed, and the time left is a
 * small simulation of those lines using how long each kind of task took in this browser before
 * (`Typical`).
 *
 * No DOM beyond localStorage, so it can be tested.
 */

export type TaskKind = 'world' | 'quest' | 'ground' | 'model' | 'piece';
export type TaskState = 'done' | 'running' | 'queued' | 'failed';

export interface Task {
  kind: TaskKind;
  state: TaskState;
  /** When a running task began; null when not known, which counts as just begun. */
  since: number | null;
  /** A queued task that cannot start before the world is written (the hub, before its preview). */
  afterWorld?: boolean;
}

/**
 * How long each kind of task usually takes, in ms; a model or a piece is one picture plus one
 * mesh, without the time its mesh waited in fal's queue, which the simulation adds itself.
 */
export interface Typical {
  world: number;
  quest: number;
  ground: number;
  model: number;
}

/**
 * Before this browser has timed anything: quick start's world and opening, and fal.ai's usual 3D
 * model with a runner (27 Oct 2026, 36 pieces: a picture in 1–6 s, a mesh in 14–37 s, ~22 s).
 */
export const DEFAULT_TYPICAL: Typical = { world: 12_000, quest: 12_000, ground: 4_000, model: 25_000 };

/**
 * Meshes fal.ai runs at once for the owner's account, the rest held in its queue: 6–7 at most
 * whether 10 or 16 were asked (27 Oct 2026, `PARALLEL` in `landmark3d.ts`). The account's limit
 * grows with its invoices, so this is a measurement to repeat, not a constant of fal's.
 */
export const FAL_RUNNING = 6;

const TYPICAL_KEY = 'rpg-typical';

export function loadTypical(): Typical {
  try {
    const raw = JSON.parse(localStorage.getItem(TYPICAL_KEY) ?? 'null') as Partial<Typical> | null;
    const ok = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
    return {
      world: ok(raw?.world, DEFAULT_TYPICAL.world),
      quest: ok(raw?.quest, DEFAULT_TYPICAL.quest),
      ground: ok(raw?.ground, DEFAULT_TYPICAL.ground),
      model: ok(raw?.model, DEFAULT_TYPICAL.model),
    };
  } catch {
    return { ...DEFAULT_TYPICAL };
  }
}

/** A new measurement moves the typical a third of the way: one slow model does not double the estimate. */
export function learnTypical(t: Typical, kind: keyof Typical, ms: number): Typical {
  if (!Number.isFinite(ms) || ms <= 0) return t;
  const clamped = Math.min(Math.max(ms, 500), 5 * 60_000);
  return { ...t, [kind]: Math.round(t[kind] * 0.67 + clamped * 0.33) };
}

/** Learns and keeps it for the next start. */
export function rememberTiming(kind: keyof Typical, ms: number): void {
  try {
    localStorage.setItem(TYPICAL_KEY, JSON.stringify(learnTypical(loadTypical(), kind, ms)));
  } catch {
    // Private mode or a full store: the estimate stays the default, nothing else depends on it.
  }
}

function typicalOf(kind: TaskKind, t: Typical): number {
  return kind === 'piece' ? t.model : t[kind];
}

/** What a running task has left: its typical less what it has had, and a little more once it overruns. */
function left(task: Task, now: number, t: Typical): number {
  const typ = typicalOf(task.kind, t);
  if (task.state !== 'running') return typ;
  const had = task.since === null ? 0 : Math.max(0, now - task.since);
  return Math.max(typ - had, typ * 0.15);
}

/**
 * Milliseconds until every task has ended, by the usual times: the world, then the opening; the
 * ground on its own; the models through `parallel` workers, each queued one on the first free
 * worker, and none of those marked `afterWorld` before the world is in. A running one is one fal
 * has a runner for; should more be running than the workers, the extra ones only make more workers.
 */
export function remainingMs(tasks: readonly Task[], now: number, t: Typical, parallel = FAL_RUNNING): number {
  const open = tasks.filter((x) => x.state === 'running' || x.state === 'queued');
  if (open.length === 0) return 0;
  const world = open.find((x) => x.kind === 'world');
  const worldEnd = world ? left(world, now, t) : 0;
  const quest = open.find((x) => x.kind === 'quest');
  const storyEnd = quest ? (quest.state === 'running' ? left(quest, now, t) : worldEnd + t.quest) : worldEnd;
  let end = storyEnd;
  for (const g of open.filter((x) => x.kind === 'ground')) {
    end = Math.max(end, (g.state === 'queued' && g.afterWorld ? worldEnd : 0) + left(g, now, t));
  }
  const fal = open.filter((x) => x.kind === 'model' || x.kind === 'piece');
  const workers = fal.filter((x) => x.state === 'running').map((x) => left(x, now, t));
  while (workers.length < Math.max(parallel, 1)) workers.push(0);
  for (const q of fal.filter((x) => x.state === 'queued')) {
    let i = 0;
    for (let j = 1; j < workers.length; j++) if (workers[j] < workers[i]) i = j;
    workers[i] = Math.max(workers[i], q.afterWorld ? worldEnd : 0) + typicalOf(q.kind, t);
  }
  return Math.max(end, ...workers);
}

export interface Progress {
  /** Every task, done or not. */
  total: number;
  /** Done or failed: nothing more will come of them. */
  ended: number;
  failed: number;
  /** Nothing is running or waiting. */
  finished: boolean;
  /** By the usual times; 0 when finished. */
  leftMs: number;
}

export function progressOf(tasks: readonly Task[], now: number, t: Typical): Progress {
  const ended = tasks.filter((x) => x.state === 'done' || x.state === 'failed').length;
  return {
    total: tasks.length,
    ended,
    failed: tasks.filter((x) => x.state === 'failed').length,
    finished: ended === tasks.length,
    leftMs: remainingMs(tasks, now, t),
  };
}

/** How many of one kind are done, and of how many. */
export function countOf(tasks: readonly Task[], kinds: readonly TaskKind[]): { done: number; failed: number; running: number; total: number } {
  const mine = tasks.filter((x) => kinds.includes(x.kind));
  return {
    done: mine.filter((x) => x.state === 'done').length,
    failed: mine.filter((x) => x.state === 'failed').length,
    running: mine.filter((x) => x.state === 'running').length,
    total: mine.length,
  };
}

/** An estimate said as one: a moment, seconds by fives, minutes and tens of seconds. */
export function roughly(ms: number): { min: number; s: number } | null {
  if (ms < 5_000) return null;
  if (ms < 60_000) return { min: 0, s: Math.ceil(ms / 5_000) * 5 };
  const s = Math.ceil(ms / 10_000) * 10;
  return { min: Math.floor(s / 60), s: s % 60 };
}
