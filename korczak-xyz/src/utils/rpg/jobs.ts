/*
 * Generation that outlives the page (owner, 28 Oct 2026: "on the phone, when I switch apps, the
 * quest stops being generated in the background. The server should do it and I should come back to
 * it finished. The same with generating the world").
 *
 * iOS freezes a page in the background within seconds and often reloads it on return, so anything
 * the browser itself asks a provider for — a beat, a genesis, a fal.ai picture or model — dies with
 * it. For a signed-in reader the asking is now a JOB: a document under `users/{uid}/rpgJobs/{id}`,
 * written by the browser, run by the `rpgJob` function on the account's own keys
 * (`users/{uid}/keys/config`, the store every app reads), and written back into the same document
 * as it goes — the stream, each model tried, the result. The browser only watches it.
 *
 * - **The id is the work, not the moment.** A model request's id is a hash of everything that makes
 *   its answer (provider, models, prompt, temperature, thinking); a fal.ai piece's is what it is for
 *   (`world/slot`, `world/ground`, `clue/…`). So a reloaded page that asks for the same beat or the
 *   same piece again finds the job already running or done and takes it, instead of paying twice.
 * - **The world's hub is started by the server.** A genesis job born with `pieces` creates the jobs
 *   for its hub's and forest's models itself (`worldPieceJobs`, the same ids the browser uses), so
 *   a world asked for and the phone put away is a world with its village built on return.
 * - **The browser path stays.** Signed out, a key only in this browser, the demo, or a job nobody
 *   picked up in `UNCLAIMED_MS` (the function not deployed, Eventarc down): the browser asks the
 *   provider itself, as it always did.
 *
 * Pure, compiled into both runtimes like `quest.ts`.
 */

import { hubModelPrompt, hubSlots, IMAGE_SIZE, SIMPLIFY, type FalSlot, type HubSlot } from './falPrompts';
import type { WorldBible } from './genesis';

export const JOBS = 'rpgJobs';

/** How hard a Gemini model thinks before it writes (`storyteller.ts`). */
export type Thinking = 'low' | 'high';

/** What a model request's answer is checked against on the server, so an unplayable one moves on. */
export type JobParse = 'beat' | 'world' | 'sizes';

export interface LlmSpec {
  kind: 'llm';
  provider: 'google' | 'openai';
  /** In order: the first that answers with something `parse` accepts wins. */
  models: string[];
  prompt: string;
  temperature: number;
  thinking: Thinking | null;
  parse: JobParse;
  /** The `BeatContext` or `GenesisContext` the answer is parsed against, as JSON. */
  ctx: string;
  /** A world's: once born, start its hub's and forest's models on the account's fal.ai key. */
  pieces: boolean;
}

export interface FalSpec {
  kind: 'fal';
  label: string;
  prompt: string;
  /** The picture's side in pixels. */
  size: number;
  /** TRELLIS's `mesh_simplify`; null for a picture alone (the ground, the cover). */
  simplify: number | null;
}

export type JobSpec = LlmSpec | FalSpec;

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'abandoned';

export interface JobUsage {
  input: number;
  output: number;
  thoughts: number;
}

/** One model's turn, as `storyteller.ts`'s `ModelTry`, plus when it began (a world's id is minted from it). */
export interface JobTry {
  model: string;
  at: number;
  status: number | null;
  ms: number;
  firstMs: number | null;
  error: string | null;
  usage: JobUsage | null;
  servedBy: string | null;
}

/** The turn being written now: its answer so far, whole, and the tail of its thoughts. */
export interface JobCurrent {
  model: string;
  at: number;
  firstMs: number | null;
  text: string;
  thoughts: string;
  usage: JobUsage | null;
  servedBy: string | null;
}

/** A fal.ai piece's two steps, as far as they have gone. */
export interface FalProgress {
  image: { url: string | null; ms: number | null; error: string | null; retry: string | null };
  mesh: {
    /** Waiting for a runner, being made, or made. */
    state: 'queued' | 'running' | 'done' | null;
    position: number | null;
    glb: string | null;
    kb: number | null;
    queuedMs: number | null;
    ms: number | null;
    error: string | null;
  } | null;
}

export interface JobDoc {
  spec: JobSpec;
  status: JobStatus;
  createdAt: number;
  /** Set by the runner on every write, so a job whose function died is seen as dead. */
  heartbeat: number | null;
  finishedAt: number | null;
  /** Why it failed, when it did. */
  error: string | null;
  /** The account holds no key for this, so the browser should ask with its own. */
  noKey?: boolean;
  /** The runner itself broke, not the provider: the browser may try on its own. */
  crashed?: boolean;
  // A model request:
  tries?: JobTry[];
  current?: JobCurrent | null;
  raw?: string | null;
  /** The model whose answer was used, and when its turn began. */
  model?: string | null;
  at?: number | null;
  outcome?: 'generated' | 'unusable' | 'failed' | null;
  // A fal.ai piece:
  fal?: FalProgress;
  result?: { image: string; glb: string | null; costUsd: number; ms: number; queuedMs: number; at: number } | null;
}

/** A queued job nobody has picked up by now is not going to be: the browser asks itself. */
export const UNCLAIMED_MS = 25_000;
/** A running job whose runner has written nothing for this long is dead. */
export const DEAD_MS = 90_000;
/** A model's answer is taken again for the same request only this fresh; a piece, always. */
export const REUSE_LLM_MS = 6 * 3600_000;
/** How long a job's document is kept (Firestore TTL on `expireAt`). */
export const KEEP_MS = 14 * 24 * 3600_000;

/*
 * Two limits per model, as in the browser (`storyteller.ts`): moving on when either runs out. The
 * whole job also has to end inside the function's own 540 s, so the runner stops starting new
 * models past `JOB_BUDGET_MS`.
 */
export const STALL_MS = 60_000;
export const MODEL_MS = 180_000;
export const JOB_BUDGET_MS = 480_000;

/** FNV-1a, twice with different offsets: a short, stable, synchronous hash, the same in both runtimes. */
export function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** A number in [0, 1) drawn from a text: the same pick of world from the same answer, on both sides. */
export function textRandom(text: string): number {
  return parseInt(hash(text).slice(0, 8), 16) / 2 ** 32;
}

/** A model request's id: everything that makes its answer, hashed with its length. */
export function llmJobId(spec: Omit<LlmSpec, 'ctx' | 'pieces'>): string {
  const key = JSON.stringify([spec.provider, spec.models, spec.prompt, spec.temperature, spec.thinking, spec.parse]);
  return `llm-${spec.parse}-${hash(key)}-${key.length.toString(36)}`;
}

/** A fal.ai piece's id: what it is for, readable, with a hash so no two scopes share one. */
export function falJobId(scope: string): string {
  const readable = scope.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 120);
  return `fal-${readable}-${hash(scope)}`;
}

/** The scope of a world's hub or forest piece. */
export const hubScope = (worldId: string, slot: HubSlot) => `${worldId}/${slot}`;

/** What a world's hub and forest need made, as the jobs the server starts once the world is born. */
export function worldPieceJobs(world: WorldBible): { id: string; spec: FalSpec }[] {
  return hubSlots(world).map((slot) => ({
    id: falJobId(hubScope(world.id, slot)),
    spec: falSpec(slot, hubModelPrompt(world, slot)),
  }));
}

export function falSpec(label: FalSlot | 'ground' | 'cover', prompt: string, size = IMAGE_SIZE, mesh = true): FalSpec {
  return { kind: 'fal', label, prompt, size, simplify: mesh && label in SIMPLIFY ? SIMPLIFY[label as FalSlot] : null };
}

/** What to do with a job already there when it is asked for again. */
export function reuse(doc: JobDoc | null, now: number): 'take' | 'replace' {
  if (!doc) return 'replace';
  if (doc.status === 'done') {
    if (doc.spec.kind === 'llm') return doc.outcome === 'generated' && now - doc.createdAt < REUSE_LLM_MS ? 'take' : 'replace';
    return doc.result ? 'take' : 'replace';
  }
  if (doc.status === 'queued') return now - doc.createdAt < UNCLAIMED_MS ? 'take' : 'replace';
  if (doc.status === 'running') return now - (doc.heartbeat ?? doc.createdAt) < DEAD_MS ? 'take' : 'replace';
  return 'replace';
}
