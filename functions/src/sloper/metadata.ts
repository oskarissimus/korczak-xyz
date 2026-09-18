/*
 * What the browser is allowed to ask the assembler for.
 *
 * Everything in here was a Pydantic model in sloper's FastAPI backend, which validated the
 * request body for free. There is no such thing in a Cloud Function, and this endpoint spawns a
 * process with arguments derived from the request — so the bounds are not paperwork. A width of
 * `1e9` is an out-of-memory kill on a shared runtime; a duration of `NaN` reaches ffmpeg's `-t`
 * as the literal string `NaN` and the error it produces says nothing about where it came from.
 *
 * Kept apart from the handler so it can be tested without a fake HTTP request, which is the only
 * part of this function testable at all without ffmpeg on the box.
 */

export interface AssemblyMetadata {
  scenes: { index: number; imageDuration: number }[];
  resolution: { width: number; height: number };
  frameRate: number;
}

/** Matches the frontend's own ceiling; beyond this an instance runs out of memory, not time. */
export const MAX_SCENES = 100;
export const MAX_DIMENSION = 4096;
/** A still held for longer than this is a mistake, and it is ten minutes of encoding. */
export const MAX_SCENE_SECONDS = 600;

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestError(`${what} is missing or is not an object`);
  }
  return value as Record<string, unknown>;
}

function asBoundedInt(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestError(`${what} is not a number`);
  }
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    throw new BadRequestError(`${what} must be between ${min} and ${max}`);
  }
  return rounded;
}

function asBoundedNumber(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestError(`${what} is not a number`);
  }
  if (value < min || value > max) {
    throw new BadRequestError(`${what} must be between ${min} and ${max}`);
  }
  return value;
}

export function parseMetadata(raw: string | undefined): AssemblyMetadata {
  if (!raw) throw new BadRequestError('No metadata was sent with the upload');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError('The metadata was not valid JSON');
  }

  const root = asRecord(parsed, 'metadata');

  if (!Array.isArray(root.scenes) || root.scenes.length === 0) {
    throw new BadRequestError('metadata.scenes must be a non-empty array');
  }
  if (root.scenes.length > MAX_SCENES) {
    throw new BadRequestError(`metadata.scenes holds more than ${MAX_SCENES} scenes`);
  }

  const scenes = root.scenes.map((scene, i) => {
    const s = asRecord(scene, `metadata.scenes[${i}]`);
    return {
      index: asBoundedInt(s.index, `metadata.scenes[${i}].index`, 0, MAX_SCENES - 1),
      // The floor is a hundredth of a second rather than zero: ffmpeg accepts `-t 0` and
      // produces a segment with no frames, which then fails the concat with a useless message.
      imageDuration: asBoundedNumber(
        s.imageDuration,
        `metadata.scenes[${i}].imageDuration`,
        0.01,
        MAX_SCENE_SECONDS,
      ),
    };
  });

  const resolution = asRecord(root.resolution, 'metadata.resolution');

  return {
    scenes,
    resolution: {
      // Even, because yuv420p subsamples chroma 2x2 and libx264 refuses an odd dimension.
      width: evenify(asBoundedInt(resolution.width, 'metadata.resolution.width', 16, MAX_DIMENSION)),
      height: evenify(asBoundedInt(resolution.height, 'metadata.resolution.height', 16, MAX_DIMENSION)),
    },
    frameRate: asBoundedInt(root.frameRate, 'metadata.frameRate', 1, 60),
  };
}

function evenify(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

/**
 * The counts have to line up, because the pipeline pairs them by position: `images[i]` is held
 * for `scenes[i].imageDuration` while `audio[i]` plays. A mismatch here is a video where the
 * narration drifts a scene further out of step with every cut, which is worse than a refusal.
 */
export function checkCounts(meta: AssemblyMetadata, imageCount: number, audioCount: number): void {
  if (imageCount !== meta.scenes.length) {
    throw new BadRequestError(`Expected ${meta.scenes.length} images, got ${imageCount}`);
  }
  if (audioCount !== meta.scenes.length) {
    throw new BadRequestError(`Expected ${meta.scenes.length} audio files, got ${audioCount}`);
  }
}

/**
 * The origins allowed to call this from a browser.
 *
 * THE SAME LIST IS IN `terraform/storage.tf`, as the sloper bucket's `cors` block, and the two
 * have to agree. They answer one question in two places: this one decides who may POST a sitting
 * to the assembler, that one decides who may read the pictures and narrations back out of the
 * bucket in order to have something to POST. An origin added here and not there can start an
 * assembly it cannot gather the assets for — which is the shape of the bug that put the CORS
 * block in that file in the first place, and which reaches the screen as nothing more useful than
 * Safari's `TypeError: Load failed`. `metadata.test.ts` reads the HCL and fails on drift.
 */
export const ALLOWED_ORIGINS = [
  'https://korczak.xyz',
  'https://www.korczak.xyz',
  // `astro dev` and `astro preview`.
  'http://localhost:4321',
  'http://localhost:4322',
];

export function corsOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}
