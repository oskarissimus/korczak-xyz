/*
 * An assembly that outlives the page that asked for it.
 *
 * WHAT THIS CHANGES. Until now the last step of a sitting was a request the browser had to sit
 * through: twenty megabytes up, a minute or three of libx264, an MP4 back down, and only then was
 * the video in the account. Close the tab at any point in that and the encode was thrown away —
 * the one step of the wizard where leaving cost something even though every picture and every
 * narration was already saved. This file is the other way round: the browser writes down *what to
 * assemble*, the assembler reads it off the account and puts the finished video back, and the
 * page is a spectator that may leave whenever it likes.
 *
 * WHY THE JOB IS A DOCUMENT AND NOT A REQUEST BODY. A request body is gone the moment the socket
 * is. A document is the thing both halves can come back to: the function claims it, heartbeats
 * into it and writes the answer into it, and the page — this page, or the same account on another
 * device tomorrow — reads the answer out of it whenever it next looks. The HTTP call that starts
 * an assembly therefore carries nothing but the project id; the browser could go offline the
 * instant after sending it and the video would still be made.
 *
 * WHY IT IS COMPILED INTO BOTH RUNTIMES, like `src/utils/events/`. The browser writes this shape
 * and a Cloud Function reads it, which is the same seam `parseMultipart` has and the same one that
 * has already gone wrong here once (see `handler.test.ts` on file ordering). An import is possible
 * — nothing in this file touches the DOM, `import.meta.env`, React or `firebase/*` — so a copy
 * plus an agreement test would only be identical until the first bug fix. `functions/tsconfig.json`
 * names this file; NOTHING MAY BE IMPORTED HERE THAT A CLOUD FUNCTION CANNOT COMPILE.
 *
 * THE PATHS ARE HERE FOR THE SAME REASON. `users/{uid}/sloper/{projectId}/…` is written by the
 * browser when it uploads a picture and read by the function when it fetches one back, and it is
 * also the whole of the authorization: `storage.rules` matches on that first segment, and the
 * function refuses any path in a job that does not sit under the caller's own folder. One
 * spelling, one place.
 */

/** The collection under `users/{uid}` that holds them. */
export const ASSEMBLY_JOBS = 'sloperJobs';

/**
 * Where a job lives, and why it is not a fresh id per assembly.
 *
 * The document id is the **project id**, so there is exactly one assembly job per project and the
 * page can find it with a `get` rather than a query — no index, no ordering, no "which of these
 * three is the current one". Pressing Assemble again overwrites it, which is what retrying means:
 * one sitting has one video, and a job for a video that has been superseded is not something
 * anybody would come back to.
 */
export function assemblyJobId(projectId: string): string {
  return projectId;
}

export type AssemblyJobStatus = 'queued' | 'running' | 'done' | 'error';

/** Where a finished file ended up, and a URL that fetches it back. `StoredVideo` is this. */
export interface JobVideo {
  path: string;
  url: string;
  bytes: number;
  duration: number;
}

/**
 * One scene as the assembler needs it: two objects in the bucket and how long the still is held.
 *
 * Deliberately paths rather than bytes. The pictures and the narrations are already in the bucket
 * — they were put there the moment each one was paid for — so a job that named them by value
 * would be a second copy of thirty megabytes inside a document capped at one.
 */
export interface AssemblyJobScene {
  imagePath: string;
  audioPath: string;
  imageDuration: number;
}

export interface AssemblyJob {
  projectId: string;
  status: AssemblyJobStatus;
  scenes: AssemblyJobScene[];
  resolution: { width: number; height: number };
  frameRate: number;
  /** How many times an assembler has claimed it. Bounded, so a job that kills its instance stops. */
  attempts: number;
  createdAt: number;
  startedAt: number | null;
  /**
   * Written every few seconds while ffmpeg runs, and the only way to tell a long encode from an
   * instance that died holding the claim. See `jobIsStale`.
   */
  heartbeatAt: number | null;
  finishedAt: number | null;
  video: JobVideo | null;
  error: string | null;
}

/** Matches the frontend's own ceiling; beyond this an instance runs out of memory, not time. */
export const MAX_SCENES = 100;
export const MAX_DIMENSION = 4096;
/** A still held for longer than this is a mistake, and it is ten minutes of encoding. */
export const MAX_SCENE_SECONDS = 600;

/**
 * How long a `running` job may go without a heartbeat before anybody may take it back.
 *
 * Generously longer than the function's own 540-second ceiling: a job whose instance is still
 * alive is heartbeating every few seconds, so the only thing this can catch is an instance that
 * has gone — and taking a live job away from a running encode would pay for it twice.
 */
export const STALE_MS = 15 * 60 * 1000;

/**
 * How many times an assembler may pick one up.
 *
 * A job that runs the instance out of memory or out of time fails the same way every time, and a
 * page that re-offers it on every open would re-run it for ever. Three is enough to survive a
 * platform hiccup and few enough to stop.
 */
export const MAX_ATTEMPTS = 3;

export class AssemblyJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblyJobError';
  }
}

/* --- where the bytes are ------------------------------------------------------------------- */

/** Everything one project owns, and the prefix every path in its job has to start with. */
export function projectFolder(uid: string, projectId: string): string {
  return `users/${uid}/sloper/${projectId}`;
}

/**
 * Where an asset's bytes go.
 *
 * The extension is real rather than decorative — Storage serves an object with a content type
 * derived from the upload, and a browser asked to play an `<audio>` from a URL ending in `.mp3`
 * behaves better than one guessing.
 */
export function assetObjectPath(
  uid: string,
  projectId: string,
  assetId: string,
  type: 'image' | 'audio',
): string {
  return `${projectFolder(uid, projectId)}/${assetId}.${type === 'image' ? 'jpg' : 'mp3'}`;
}

export function videoObjectPath(uid: string, projectId: string): string {
  return `${projectFolder(uid, projectId)}/video.mp4`;
}

/**
 * Whether a path in a job is one this account's own project may name.
 *
 * The assembler reads the bucket with the Admin SDK, which is outside `storage.rules` entirely —
 * so this is the rule, and it is checked rather than assumed. A job document is written by a
 * browser and a browser can be made to write anything; without this, a forged `imagePath` would
 * have the assembler fetch somebody else's picture and put it in a video.
 */
export function isInProjectFolder(path: string, uid: string, projectId: string): boolean {
  const prefix = `${projectFolder(uid, projectId)}/`;
  // No `..` anywhere: the prefix test alone is satisfied by `users/u/sloper/p/../../other`.
  return path.startsWith(prefix) && !path.includes('..') && path.length > prefix.length;
}

/* --- writing one -------------------------------------------------------------------------- */

export interface AssemblyJobInput {
  projectId: string;
  scenes: AssemblyJobScene[];
  resolution: { width: number; height: number };
  frameRate: number;
  now: number;
}

/**
 * A fresh, unclaimed job.
 *
 * It validates rather than trusts, exactly as `readAssemblyJob` does at the other end, because the
 * refusal is worth far more here: a sentence on the screen the moment Assemble is pressed beats a
 * 400 read out of a document ten seconds later by a page that may by then be closed.
 */
export function buildAssemblyJob(input: AssemblyJobInput): AssemblyJob {
  const { projectId, scenes, resolution, frameRate, now } = input;

  if (!projectId) throw new AssemblyJobError('A job needs a project to belong to');
  if (scenes.length === 0) {
    throw new AssemblyJobError('No scene has both an image and a narration, so there is nothing to assemble.');
  }
  if (scenes.length > MAX_SCENES) {
    throw new AssemblyJobError(`A video may have at most ${MAX_SCENES} scenes.`);
  }

  for (const scene of scenes) {
    if (!scene.imagePath || !scene.audioPath) {
      throw new AssemblyJobError('One of the scenes has no saved picture or narration to assemble from.');
    }
  }

  return {
    projectId,
    status: 'queued',
    scenes: scenes.map((scene) => ({
      imagePath: scene.imagePath,
      audioPath: scene.audioPath,
      imageDuration: boundedNumber(scene.imageDuration, 'A scene duration', 0.01, MAX_SCENE_SECONDS),
    })),
    resolution: {
      width: evenify(boundedInt(resolution.width, 'The video width', 16, MAX_DIMENSION)),
      height: evenify(boundedInt(resolution.height, 'The video height', 16, MAX_DIMENSION)),
    },
    frameRate: boundedInt(frameRate, 'The frame rate', 1, 60),
    attempts: 0,
    createdAt: now,
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
    video: null,
    error: null,
  };
}

/* --- reading one back ---------------------------------------------------------------------- */

/**
 * A stored document, made safe to act on.
 *
 * Every field is re-read rather than cast, for the reason `metadata.ts` gives about the multipart
 * form: these numbers become `ffmpeg` arguments. A width of `1e9` is an out-of-memory kill on a
 * shared runtime and a `NaN` duration reaches `-t` as the literal string. The document is written
 * by a browser, which is not a place anything may be trusted from.
 */
export function readAssemblyJob(raw: unknown): AssemblyJob {
  const root = asRecord(raw, 'The job');

  const scenes = Array.isArray(root.scenes) ? root.scenes : [];
  if (scenes.length === 0) throw new AssemblyJobError('The job names no scenes');
  if (scenes.length > MAX_SCENES) throw new AssemblyJobError(`The job names more than ${MAX_SCENES} scenes`);

  const resolution = asRecord(root.resolution, 'The job resolution');

  return {
    projectId: str(root.projectId),
    status: isStatus(root.status) ? root.status : 'queued',
    scenes: scenes.map((scene, i) => {
      const s = asRecord(scene, `scenes[${i}]`);
      return {
        imagePath: str(s.imagePath),
        audioPath: str(s.audioPath),
        imageDuration: boundedNumber(
          s.imageDuration,
          `scenes[${i}].imageDuration`,
          0.01,
          MAX_SCENE_SECONDS,
        ),
      };
    }),
    resolution: {
      // Even, because yuv420p subsamples chroma 2x2 and libx264 refuses an odd dimension.
      width: evenify(boundedInt(resolution.width, 'resolution.width', 16, MAX_DIMENSION)),
      height: evenify(boundedInt(resolution.height, 'resolution.height', 16, MAX_DIMENSION)),
    },
    frameRate: boundedInt(root.frameRate, 'frameRate', 1, 60),
    attempts: typeof root.attempts === 'number' && root.attempts > 0 ? Math.floor(root.attempts) : 0,
    createdAt: numOr(root.createdAt, 0),
    startedAt: numOrNull(root.startedAt),
    heartbeatAt: numOrNull(root.heartbeatAt),
    finishedAt: numOrNull(root.finishedAt),
    video: readJobVideo(root.video),
    error: typeof root.error === 'string' ? root.error : null,
  };
}

function readJobVideo(raw: unknown): JobVideo | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.path !== 'string' || typeof v.url !== 'string') return null;
  return { path: v.path, url: v.url, bytes: numOr(v.bytes, 0), duration: numOr(v.duration, 0) };
}

/* --- what to do about one ------------------------------------------------------------------ */

/**
 * A claim nobody is behind any more.
 *
 * The instance that claimed it has gone — killed for memory, evicted, or simply never got past
 * the claim — and the job would otherwise sit at `running` for ever with a page politely waiting
 * on a heartbeat that is not coming.
 */
export function jobIsStale(job: AssemblyJob, now: number): boolean {
  if (job.status !== 'running') return false;
  const last = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
  return now - last > STALE_MS;
}

/**
 * Whether this job wants poking.
 *
 * Read by both ends: the function uses it to decide whether it may claim, and the page uses it on
 * opening a project to decide whether to send the start request again. That second case is the
 * whole of the recovery story — there is no sweeper and no queue, because the one moment anybody
 * cares whether a video got made is the moment they come back to look at it, and that is exactly
 * when the page is there to ask again.
 */
export function jobNeedsStarting(job: AssemblyJob, now: number): boolean {
  if (job.attempts >= MAX_ATTEMPTS) return false;
  return job.status === 'queued' || jobIsStale(job, now);
}

/** Still being worked on, as far as anybody can tell. Drives the wait screen. */
export function jobIsLive(job: AssemblyJob, now: number): boolean {
  return job.status === 'queued' || (job.status === 'running' && !jobIsStale(job, now));
}

/* --- the small print ----------------------------------------------------------------------- */

const STATUSES: AssemblyJobStatus[] = ['queued', 'running', 'done', 'error'];

function isStatus(value: unknown): value is AssemblyJobStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssemblyJobError(`${what} is missing or is not an object`);
  }
  return value as Record<string, unknown>;
}

function boundedInt(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AssemblyJobError(`${what} is not a number`);
  }
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    throw new AssemblyJobError(`${what} must be between ${min} and ${max}`);
  }
  return rounded;
}

function boundedNumber(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AssemblyJobError(`${what} is not a number`);
  }
  if (value < min || value > max) {
    throw new AssemblyJobError(`${what} must be between ${min} and ${max}`);
  }
  return value;
}

function evenify(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}
