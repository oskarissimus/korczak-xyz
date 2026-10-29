/*
 * The hub's landmark as a real 3D model, from fal.ai (owner, Oct 2026: "a landmark in the starting
 * location that sets the mood of the generated world — as cheaply as possible; quality may suffer,
 * and fewer polygons are better for the game anyway").
 *
 * Two requests, the cheapest pair that measured well (Oct 2026):
 *
 *   1. FLUX.1 [schnell] draws the landmark alone on white, 512×512, in ~1 s, for $0.003 (fal bills
 *      it by the megapixel, rounded up, so 512² costs what a full megapixel does).
 *   2. TRELLIS turns that picture into a textured GLB, ~25 s through the queue, for $0.02; with a
 *      512 px texture and 95% of the mesh simplified away it is ~10k triangles and ~650 KB.
 *
 * About $0.023 a model, against ~$0.60 on Meshy. The prompt is the world's own `landmark` line,
 * which genesis writes in English for exactly this; an older world without one is described from
 * its hub, architecture and look instead.
 *
 * THE WHOLE HUB, NOT ONLY ITS LANDMARK (owner, 26 Oct 2026: "it works; now the whole starting
 * location from the assets"). Seven more pieces the same way, each from a line of the world's
 * `kit`: a house and a hall for the five houses, a tree, a stall, a cart, a lamp and a pile of goods
 * for the square (`HUB_PIECES`, placed by `RpgScene.setHubModels`). Eight models, about **$0.18 a
 * world**, all asked for at once while the kit's village stands in for them (`PARALLEL`, below).
 *
 * AND THE FOREST (owner, 26 Oct 2026: "generate the world's trees — they are static assets now").
 * The hub's tree is also every tree across the map, with two more of its kind made after the hub,
 * a young one and an old one (`FOREST_VARIANTS`), so the forest is three trees and not one: two
 * more models, **$0.046 a world**. The scene simplifies each to ~2,500 triangles before planting
 * it four hundred times (`hubModels.ts`, `loadForestTree`).
 *
 * GENERATED ONCE PER WORLD. The result is kept on the world's bible (`landmarkModel`, `kitModels`), which the
 * library and the account already sync (`worldSave.ts`, `cloud.ts`), so neither this browser nor
 * another device asks again. fal's files would otherwise expire on fal's schedule, so every request
 * asks for none (`X-Fal-Object-Lifecycle-Preference`), and the GLB's bytes are also kept in the
 * Cache API (`loadLandmarkBytes`), so after the first visit the model loads without the network.
 *
 * Every request is in the developer console as kind `fal`, with its time, its error and its price,
 * and adds to its own fal.ai total there, apart from the tokens and ElevenLabs.
 */

import { recordMeasurement } from '../../lib/sentry';
import { endRequest, startRequest, updateRequest, type DevRequest } from './devlog';
import type { LandmarkModel, WorldBible } from './genesis';
import { FAL_IMAGE_MODEL, FAL_MESH_MODEL, FAL_PERSON_MESH_MODEL, FAL_PRICES, FAL_RIG_MODEL, hubModelPrompt, hubSlots, IMAGE_SIZE, DEFAULT_POSE, posePerson, type PersonPose, imageCost, SIMPLIFY, type FalSlot, type HubSlot, type PersonSlot } from './falPrompts';

import { falJobId, falSpec, hubScope, type FalSpec, type JobDoc } from './jobs';
import { jobsOn, runServerJob } from './serverJobs';

export * from './falPrompts';
export type { LandmarkModel };

export interface FalOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long the queue may take before the mesh is given up on. */
  timeoutMs?: number;
  pollMs?: number;
  /** Which try of the piece this is (`withRetries`), from 1; said in the console from the second. */
  attempt?: number;
}

/**
 * How many times a piece is asked for before it counts as failed (owner, 28 Oct 2026, a world
 * ready with "4 failed": "was there a retry?" — there was none, only FLUX's 429s were waited out).
 * A mesh that times out in fal's queue, a 500, a picture TRELLIS cannot read, all come right on a
 * second ask more often than not; a refused key (401, 402, 403) never does, and stops at once.
 */
export const PIECE_TRIES = 3;
const RETRY_AFTER_MS = [3_000, 10_000];

/** The console's mark on a retry's requests: `retry 2/3 · `. */
function tryMark(o: FalOptions): string {
  return o.attempt && o.attempt > 1 ? `retry ${o.attempt}/${PIECE_TRIES} · ` : '';
}

/** Runs a piece up to `PIECE_TRIES` times, a pause between, passing each try its number. */
export async function withRetries<T>(run: (o: FalOptions) => Promise<T>, o: FalOptions = {}): Promise<T> {
  const sleep = o.sleep ?? wait;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run({ ...o, attempt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= PIECE_TRIES || o.signal?.aborted || /^40[123]\b/.test(message) || message.startsWith('skipped')) throw err;
      await sleep(RETRY_AFTER_MS[attempt - 1] ?? RETRY_AFTER_MS[RETRY_AFTER_MS.length - 1]);
    }
  }
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
    // Keep the outputs: the URL is the cache, and fal's default retention is theirs to change.
    'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: null }),
  };
}

async function failure(res: Response): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* the status says enough */
  }
  return new Error(`${res.status}${detail ? ` ${detail}` : ''}`);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How often a picture is asked again after a 429. `fal.run` answers synchronously, so at the
 * account's concurrency limit it refuses (`concurrent_requests_limit`, `X-Fal-Needs-Retry: 1`)
 * where the queue would have waited; fal's own client backs off 1, 2, 4, 8 s, and so does this.
 */
const IMAGE_RETRIES = 5;

/**
 * What can draw a person's picture (owner, 29 Oct 2026: "a picker for those models in the lab and a
 * switch in the game's settings, Nano Banana by default in the lab, because the pose matters a lot
 * here"). FLUX schnell is the game's default and everything else's only painter: the cheapest and
 * fastest, and the loosest about a pose. The others are asked for a square picture and priced as
 * fal bills them, Oct 2026. Every one answers `images[0].url`.
 */
export const PERSON_PAINTERS = {
  schnell: {
    model: FAL_IMAGE_MODEL,
    price: (size: number) => imageCost(size, size),
    body: (prompt: string, size: number) => ({ prompt, image_size: { width: size, height: size }, num_inference_steps: 4, num_images: 1, enable_safety_checker: true }),
  },
  fluxDev: {
    model: 'fal-ai/flux/dev',
    price: (size: number) => Math.ceil((size * size) / 1_000_000) * 0.025,
    body: (prompt: string, size: number) => ({ prompt, image_size: { width: size, height: size }, num_inference_steps: 28, num_images: 1, enable_safety_checker: true }),
  },
  flux2: {
    model: 'fal-ai/flux-2',
    price: () => 0.012,
    body: (prompt: string, size: number) => ({ prompt, image_size: { width: size, height: size }, num_images: 1, enable_safety_checker: true }),
  },
  nanoBanana: {
    model: 'fal-ai/nano-banana',
    price: () => 0.0398,
    body: (prompt: string) => ({ prompt, aspect_ratio: '1:1', output_format: 'jpeg', num_images: 1 }),
  },
  nanoBanana2: {
    model: 'fal-ai/nano-banana-2',
    price: () => 0.08,
    body: (prompt: string) => ({ prompt, aspect_ratio: '1:1', output_format: 'jpeg', num_images: 1 }),
  },
} as const;
export type PersonPainter = keyof typeof PERSON_PAINTERS;
export const DEFAULT_PAINTER: PersonPainter = 'schnell';
let personPainter: PersonPainter = DEFAULT_PAINTER;
/** The game's switch: what draws its people's pictures from now on. */
export function setPersonPainter(p: PersonPainter) {
  personPainter = p;
}

/** Step 1: the picture; also the whole of a world's ground texture (`groundTexture.ts`), at its own size. */
export async function drawImage(
  key: string,
  prompt: string,
  label: FalSlot | 'ground' | 'cover',
  o: FalOptions,
  size = IMAGE_SIZE,
  /** What the picture is for, for good (`world/ground`): given, a signed-in reader's server paints it. */
  scope?: string,
  /** Who paints it; the server's runner only knows FLUX schnell. */
  painter: PersonPainter = 'schnell',
): Promise<string> {
  const paint = PERSON_PAINTERS[painter];
  if (scope && painter === 'schnell' && jobsOn() && !o.fetchImpl) {
    const made = await serverPiece(scope, falSpec(label, prompt, size, false));
    if (made) return made.image;
  }
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? wait;
  const entry = startRequest('fal', paint.model, null, `${tryMark(o)}${prompt}`, label);
  try {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await f(`https://fal.run/${paint.model}`, {
        method: 'POST',
        headers: headers(key),
        signal: o.signal,
        body: JSON.stringify(paint.body(prompt, size)),
      });
      if (res.status !== 429 || attempt >= IMAGE_RETRIES) break;
      updateRequest(entry, { text: `${tryMark(o)}${prompt}\n429, fal.ai at its limit: again in ${2 ** attempt} s` });
      await sleep(1000 * 2 ** attempt);
    }
    if (!res.ok) throw await failure(res);
    const body = (await res.json()) as { images?: { url?: string }[] };
    const url = body.images?.[0]?.url;
    if (!url) throw new Error('no image in the answer');
    endRequest(entry, null, { cost: paint.price(size), text: `${tryMark(o)}${prompt}\n→ ${url}` });
    return url;
  } catch (err) {
    endRequest(entry, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Step 2: the model, through the queue, since it takes longer than a request should stay open.
 * `started` is called when fal gives it a runner, which is not when it was asked: past the
 * account's limit the queue holds it, and that wait comes back as `queuedMs`.
 */
async function buildMesh(key: string, image: string, label: FalSlot, o: FalOptions, started?: () => void): Promise<{ glb: string; queuedMs: number }> {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? wait;
  const entry = startRequest('fal', FAL_MESH_MODEL, null, `${tryMark(o)}← ${image}`, label);
  try {
    const submit = await f(`https://queue.fal.run/${FAL_MESH_MODEL}`, {
      method: 'POST',
      headers: headers(key),
      signal: o.signal,
      body: JSON.stringify({ image_url: image, texture_size: 512, mesh_simplify: SIMPLIFY[label] }),
    });
    if (!submit.ok) throw await failure(submit);
    const queued = (await submit.json()) as { status_url?: string; response_url?: string };
    if (!queued.status_url || !queued.response_url) throw new Error('the queue gave no request to follow');
    const auth = { Authorization: `Key ${key}` };
    const asked = Date.now();
    const deadline = asked + (o.timeoutMs ?? 300_000);
    let queuedMs: number | null = null;
    for (;;) {
      await sleep(o.pollMs ?? 2000);
      if (Date.now() > deadline) throw new Error('timed out in the queue');
      const res = await f(queued.status_url, { headers: auth, signal: o.signal });
      if (!res.ok) throw await failure(res);
      const s = (await res.json()) as { status?: string; queue_position?: number };
      const line = s.status === 'IN_QUEUE' ? `IN_QUEUE #${s.queue_position ?? '?'}` : (s.status ?? '?');
      updateRequest(entry, { text: `${tryMark(o)}← ${image}\n${line}` });
      if (queuedMs === null && s.status !== 'IN_QUEUE') {
        queuedMs = Date.now() - asked;
        started?.();
      }
      if (s.status === 'COMPLETED') break;
    }
    const res = await f(queued.response_url, { headers: auth, signal: o.signal });
    if (!res.ok) throw await failure(res);
    const body = (await res.json()) as { model_mesh?: { url?: string; file_size?: number } };
    const glb = body.model_mesh?.url;
    if (!glb) throw new Error('no model in the answer');
    const kb = body.model_mesh?.file_size ? ` (${Math.round(body.model_mesh.file_size / 1024)} KB)` : '';
    const waited = queuedMs ?? 0;
    const held = waited >= 1000 ? `, ${Math.round(waited / 1000)} s of it in fal's queue` : '';
    endRequest(entry, null, { cost: FAL_PRICES.mesh, text: `${tryMark(o)}← ${image}\n→ ${glb}${kb}${held}` });
    return { glb, queuedMs: waited };
  } catch (err) {
    endRequest(entry, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * A job through fal's queue (Meshy's and the model lab's): submits `body`, follows it with a line in `entry`, and
 * answers the result. `started` is called when fal gives it a runner.
 */
async function queueJob<T>(key: string, model: string, body: object, entry: DevRequest, head: string, o: FalOptions, started?: () => void): Promise<T> {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? wait;
  const submit = await f(`https://queue.fal.run/${model}`, { method: 'POST', headers: headers(key), signal: o.signal, body: JSON.stringify(body) });
  if (!submit.ok) throw await failure(submit);
  const queued = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!queued.status_url || !queued.response_url) throw new Error('the queue gave no request to follow');
  const auth = { Authorization: `Key ${key}` };
  const deadline = Date.now() + (o.timeoutMs ?? 420_000);
  let running = false;
  for (;;) {
    await sleep(o.pollMs ?? 3000);
    if (Date.now() > deadline) throw new Error('timed out in the queue');
    const res = await f(queued.status_url, { headers: auth, signal: o.signal });
    if (!res.ok) throw await failure(res);
    const s = (await res.json()) as { status?: string; queue_position?: number };
    const line = s.status === 'IN_QUEUE' ? `IN_QUEUE #${s.queue_position ?? '?'}` : (s.status ?? '?');
    updateRequest(entry, { text: `${head} · ${line}` });
    if (!running && s.status !== 'IN_QUEUE') {
      running = true;
      started?.();
    }
    if (s.status === 'COMPLETED') break;
  }
  const res = await f(queued.response_url, { headers: auth, signal: o.signal });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

const kbOf = (file?: { file_size?: number } | null) => (file?.file_size ? ` (${Math.round(file.file_size / 1024)} KB)` : '');

/**
 * A person's model rigged by Meshy (owner, 29 Oct 2026: "a toggle to choose our own rig or Meshy via
 * fal.ai, our own is weak, maybe Meshy will be better; Meshy by default"). The same queue as the
 * mesh, 1–3 minutes, $0.20; the answer is the rigged GLB's URL, with Meshy's 24 bones under the names
 * the donors have, so the one clip library moves it (`people.ts`). Not retried: a body Meshy will not
 * rig does not become one on a second ask, and the browser's own rig stands in.
 */
export async function rigWithMeshy(key: string, glb: string, height: number, label: string, o: FalOptions = {}): Promise<string> {
  const head = `← ${glb}\n${height} m`;
  const entry = startRequest('fal', FAL_RIG_MODEL, null, head, label);
  try {
    type Rigged = { rigged_character_glb?: { url?: string; file_size?: number } | null };
    const body = await queueJob<Rigged>(key, FAL_RIG_MODEL, { model_url: glb, height_meters: height, enable_animation: false }, entry, head, o);
    const rigged = body.rigged_character_glb?.url;
    if (!rigged) throw new Error('no rigged model in the answer');
    endRequest(entry, null, { cost: FAL_PRICES.rig, text: `${head}\n→ ${rigged}${kbOf(body.rigged_character_glb)}` });
    return rigged;
  } catch (err) {
    endRequest(entry, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Who makes a person's model from its picture (owner, 29 Oct 2026, after the rig's switch: "one more
 * toggle so the models are made by Meshy too, maybe it will be better"): TRELLIS ($0.02, ~30 s, the
 * default) or Meshy's image-to-3D ($0.80, a few minutes), asked for an A-pose at ~10k polygons so
 * either rig gets the pose it expects. Only people; the hub, places and clues stay on TRELLIS.
 */
export type Mesher = 'trellis' | 'meshy';
export const DEFAULT_MESHER: Mesher = 'trellis';
let personMesher: Mesher = DEFAULT_MESHER;
export function setPersonMesher(m: Mesher) {
  personMesher = m;
}
let personPose: PersonPose = DEFAULT_POSE;
/** The game's switch: the pose its people are drawn in from now on (`PERSON_POSES`). */
export function setPersonPose(p: PersonPose) {
  personPose = p;
}

const PERSON_SLOTS: readonly FalSlot[] = ['person', 'hero', 'enemy'];

type FalFile = { url?: string; file_size?: number } | null | undefined;

/**
 * Every image-to-3D a person can be made with, for the game's switch (TRELLIS, Meshy) and the model
 * lab at `/apps/rpg-models/`, which makes the same picture every way to see which is worth its price
 * (owner, 29 Oct 2026: "a button to generate a model from the same image with various methods and
 * view and assess animated results"). List prices on fal, Oct 2026; each asks for roughly the
 * ~10k-triangle, one-texture model the game can carry.
 */
export const PERSON_MESHERS = {
  trellis: {
    model: FAL_MESH_MODEL,
    price: FAL_PRICES.mesh,
    body: (image: string) => ({ image_url: image, texture_size: 512, mesh_simplify: SIMPLIFY.person }),
    pick: (r: { model_mesh?: FalFile }) => r.model_mesh,
  },
  trellis2: {
    model: 'fal-ai/trellis-2',
    price: 0.25,
    body: (image: string) => ({ image_url: image, resolution: 512, texture_size: 1024, decimation_target: 10_000 }),
    pick: (r: { model_glb?: FalFile }) => r.model_glb,
  },
  tripo: {
    model: 'tripo3d/tripo/v2.5/image-to-3d',
    price: 0.3,
    body: (image: string) => ({ image_url: image, texture: 'standard', pbr: false, face_limit: 10_000, orientation: 'align_image' }),
    pick: (r: { model_mesh?: FalFile }) => r.model_mesh,
  },
  hunyuan: {
    model: 'fal-ai/hunyuan3d/v2',
    // $0.16 a white mesh, three times that textured.
    price: 0.48,
    body: (image: string) => ({ input_image_url: image, textured_mesh: true }),
    pick: (r: { model_mesh?: FalFile }) => r.model_mesh,
  },
  meshy: {
    model: FAL_PERSON_MESH_MODEL,
    price: FAL_PRICES.meshyMesh,
    body: (image: string, at: MeshAsk = {}) => ({ image_url: image, pose_mode: meshyPose(at), target_polycount: 10_000, should_texture: true, enable_pbr: false, enable_rigging: false }),
    pick: (r: { model_glb?: FalFile }) => r.model_glb,
  },
  /**
   * Meshy's model, texture and rig in one request (owner, 29 Oct 2026: "an option in the lab to see
   * how the pipeline works in one go: model, texture and rig"): the same Meshy 6 with
   * `enable_rigging`, its $0.20 add-on, answering the rigged GLB beside the bare one. On fal only
   * Meshy does this; Tripo's rig is on Tripo's own API, not fal's.
   */
  meshyRigged: {
    model: FAL_PERSON_MESH_MODEL,
    price: FAL_PRICES.meshyMesh + FAL_PRICES.rig,
    body: (image: string, at: MeshAsk = {}) => ({
      image_url: image,
      pose_mode: meshyPose(at),
      target_polycount: 10_000,
      should_texture: true,
      enable_pbr: false,
      enable_rigging: true,
      rigging_height_meters: at.height ?? 1.75,
    }),
    pick: (r: { model_glb?: FalFile }) => r.model_glb,
  },
} as const;
export type PersonMesher = keyof typeof PERSON_MESHERS;

/** What a mesher may be told beyond the picture: the pose it is in, and how tall the person is. */
export interface MeshAsk {
  pose?: PersonPose;
  height?: number;
}

const meshyPose = (at: MeshAsk) => (at.pose === 'tpose' ? 't-pose' : 'a-pose');

/** What one person's picture and model cost as the game's switches stand, before any rig. */
export function personCostNow(): number {
  return PERSON_PAINTERS[personPainter].price(IMAGE_SIZE) + PERSON_MESHERS[personMesher].price;
}

/** The game's switches as the console names them: who draws, and what makes the model. */
export function personMakersNow(): { painter: PersonPainter; mesher: Mesher } {
  return { painter: personPainter, mesher: personMesher };
}

/** A person's model from its picture by `method`, in the browser (the server's runner only knows TRELLIS). */
export async function buildPersonMesh(
  key: string,
  image: string,
  method: PersonMesher,
  label: string,
  o: FalOptions = {},
  started?: () => void,
  at: MeshAsk = { pose: personPose },
): Promise<{ glb: string; costUsd: number; bytes: number | null; rigged: string | null }> {
  const m = PERSON_MESHERS[method];
  const head = `${tryMark(o)}← ${image}`;
  const entry = startRequest('fal', m.model, null, head, label);
  try {
    const body = await queueJob<Record<string, FalFile>>(key, m.model, (m.body as (image: string, at: MeshAsk) => object)(image, at), entry, head, o, started);
    const file = (m.pick as (r: Record<string, FalFile>) => FalFile)(body);
    if (!file?.url) throw new Error('no model in the answer');
    const rigged = body.rigged_character_glb?.url ?? null;
    if (method === 'meshyRigged' && !rigged) throw new Error('no rigged model in the answer');
    endRequest(entry, null, { cost: m.price, text: `${head}\n→ ${file.url}${kbOf(file)}${rigged ? `\n→ rigged ${rigged}${kbOf(body.rigged_character_glb)}` : ''}` });
    return { glb: file.url, costUsd: m.price, bytes: file.file_size ?? null, rigged };
  } catch (err) {
    endRequest(entry, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Meshy's text-to-3D, as the lab asks it: model, texture and rig in one request, from words alone. */
export const FAL_TEXT_PERSON_MODEL = 'fal-ai/meshy/v6/text-to-3d';
/** $0.80 a generation on fal's page, Oct 2026, plus the $0.20 its image-to-3D charges to rig (the page does not say). */
export const TEXT_PERSON_PRICE = FAL_PRICES.meshyMesh + FAL_PRICES.rig;

/** The words Meshy's text-to-3D is asked with (at most 600 characters); the T-pose is its own field. */
export function textPersonPrompt(description: string, gender: 'male' | 'female'): string {
  const tail = ` ${gender === 'female' ? 'A woman' : 'A man'}, one person, full body, stylised low-poly game character, chunky proportions, both hands empty and holding nothing, clothes close to the body.`;
  return `${description.trim().replace(/[.\s]+$/, '').slice(0, 600 - tail.length - 1)}.${tail}`;
}

/**
 * A person from a description, by Meshy's text-to-3D (owner, 29 Oct 2026: "is there a way to make
 * the model, texture and rig at once from text rather than a picture? — add it to the lab"): no
 * picture to look at and turn down first, so about a dollar is spent before anything is seen.
 */
export async function textToRiggedPerson(
  key: string,
  description: string,
  gender: 'male' | 'female',
  height: number,
  label: string,
  o: FalOptions = {},
): Promise<{ glb: string; rigged: string; image: string; prompt: string; costUsd: number; bytes: number | null }> {
  const prompt = textPersonPrompt(description, gender);
  const head = `${tryMark(o)}${prompt}\nt-pose, ${height} m`;
  const entry = startRequest('fal', FAL_TEXT_PERSON_MODEL, null, head, label);
  try {
    const body = await queueJob<Record<string, FalFile>>(
      key,
      FAL_TEXT_PERSON_MODEL,
      { prompt, mode: 'full', pose_mode: 't-pose', target_polycount: 10_000, enable_pbr: false, enable_rigging: true, rigging_height_meters: height },
      entry,
      head,
      o,
    );
    const glb = body.model_glb?.url;
    const rigged = body.rigged_character_glb?.url;
    if (!glb || !rigged) throw new Error('no rigged model in the answer');
    const image = body.thumbnail?.url ?? '';
    endRequest(entry, null, { cost: TEXT_PERSON_PRICE, text: `${head}\n→ ${glb}${kbOf(body.model_glb)}\n→ rigged ${rigged}${kbOf(body.rigged_character_glb)}` });
    return { glb, rigged, image, prompt, costUsd: TEXT_PERSON_PRICE, bytes: body.model_glb?.file_size ?? null };
  } catch (err) {
    endRequest(entry, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * A piece made by the server's job runner (`serverJobs.ts`) rather than this browser: the same two
 * steps, in the console the same way as they happen there, and `running` told when fal.ai gives the
 * mesh a runner. Null when the browser should make it itself after all; a failure throws as a
 * failure here would, with fal's status first so a refused key still stops the rest.
 */
async function serverPiece(scope: string, spec: FalSpec, running?: () => void): Promise<{ image: string; glb: string | null; queuedMs: number; costUsd: number } | null> {
  const e: { image: DevRequest | null; mesh: DevRequest | null } = { image: null, mesh: null };
  let told = false;
  const job = await runServerJob(falJobId(scope), spec, (doc: JobDoc) => {
    const fal = doc.fal;
    if (!e.image) {
      e.image = startRequest('fal', FAL_IMAGE_MODEL, null, spec.prompt, spec.label);
      updateRequest(e.image, { server: true });
    }
    if (!fal) return;
    if (e.image.status !== 'ok' && e.image.status !== 'error') {
      if (fal.image.url) endRequest(e.image, null, { cost: imageCost(spec.size, spec.size), text: `${spec.prompt}\n→ ${fal.image.url}` });
      else if (fal.image.error) endRequest(e.image, fal.image.error);
      else if (fal.image.retry) updateRequest(e.image, { text: `${spec.prompt}\n${fal.image.retry}` });
    }
    const m = fal.mesh;
    if (!m) return;
    if (!e.mesh) {
      e.mesh = startRequest('fal', FAL_MESH_MODEL, null, `← ${fal.image.url}`, spec.label);
      updateRequest(e.mesh, { server: true });
    }
    if (e.mesh.status === 'ok' || e.mesh.status === 'error') return;
    if (m.state !== 'queued' && !told) {
      told = true;
      running?.();
    }
    if (m.glb) {
      const held = (m.queuedMs ?? 0) >= 1000 ? `, ${Math.round((m.queuedMs ?? 0) / 1000)} s of it in fal's queue` : '';
      endRequest(e.mesh, null, { cost: FAL_PRICES.mesh, text: `← ${fal.image.url}\n→ ${m.glb}${m.kb ? ` (${m.kb} KB)` : ''}${held}` });
    } else if (m.error) endRequest(e.mesh, m.error);
    else updateRequest(e.mesh, { text: `← ${fal.image.url}\n${m.state === 'queued' ? `IN_QUEUE #${m.position ?? '?'}` : 'IN_PROGRESS'}` });
  });
  const open = [e.image, e.mesh].filter((r): r is DevRequest => r !== null && r.status !== 'ok' && r.status !== 'error');
  if (!job) {
    open.forEach((r) => endRequest(r, 'handed back to the browser'));
    return null;
  }
  open.forEach((r) => endRequest(r, job.error));
  if (job.status !== 'done' || !job.result) throw new Error(job.error ?? 'failed on the server');
  return { image: job.result.image, glb: job.result.glb, queuedMs: job.result.queuedMs, costUsd: job.result.costUsd };
}

/**
 * Picture then model, by the server when it can (`scope` names the piece for good), else here.
 */
async function imageAndMesh(
  key: string,
  prompt: string,
  label: FalSlot,
  o: FalOptions,
  scope: string,
  running?: () => void,
): Promise<{ image: string; glb: string; queuedMs: number; costUsd: number }> {
  if ((personMesher === 'meshy' || personPainter !== 'schnell') && PERSON_SLOTS.includes(label)) {
    const painter = personPainter;
    const image = await drawImage(key, prompt, label, o, IMAGE_SIZE, undefined, painter);
    const { glb, costUsd } = await buildPersonMesh(key, image, personMesher, label, o, running);
    return { image, glb, queuedMs: 0, costUsd: PERSON_PAINTERS[painter].price(IMAGE_SIZE) + costUsd };
  }
  if (jobsOn() && !o.fetchImpl) {
    const made = await serverPiece(scope, falSpec(label, prompt), running);
    if (made?.glb) return { ...made, glb: made.glb };
  }
  const image = await drawImage(key, prompt, label, o);
  const { glb, queuedMs } = await buildMesh(key, image, label, o, running);
  return { image, glb, queuedMs, costUsd: imageCost() + FAL_PRICES.mesh };
}

/** Picture, then model. Throws with the step's error; both steps are in the console either way. */
export async function generateHubModel(
  key: string,
  world: WorldBible,
  slot: HubSlot,
  o: FalOptions = {},
  running?: () => void,
): Promise<LandmarkModel> {
  const started = Date.now();
  const prompt = hubModelPrompt(world, slot);
  let spent = 0;
  try {
    const { image, glb, queuedMs, costUsd } = await imageAndMesh(key, prompt, slot, o, hubScope(world.id, slot), running);
    spent += costUsd;
    const model: LandmarkModel = { glb, image, prompt, costUsd: spent, ms: Date.now() - started, queuedMs, at: Date.now() };
    recordMeasurement('rpg.landmark', { outcome: 'generated', piece: slot, ms: model.ms, costUsd: spent, lang: world.lang });
    return model;
  } catch (err) {
    recordMeasurement('rpg.landmark', {
      outcome: 'failed',
      piece: slot,
      ms: Date.now() - started,
      costUsd: spent,
      lang: world.lang,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    throw err;
  }
}

export const generateLandmark = (key: string, world: WorldBible, o: FalOptions = {}) => generateHubModel(key, world, 'landmark', o);

/** What the world already has in a slot. */
export function hubModel(world: WorldBible, slot: HubSlot): LandmarkModel | undefined {
  return slot === 'landmark' ? world.landmarkModel : world.kitModels?.[slot];
}

/**
 * How many pieces are asked of fal.ai at once: a whole world's ten and a quest's first few
 * (owner, 27 Oct 2026: "the world could generate faster with parallel calls to fal.ai, but are
 * there concurrency limits?"). There are, and they are fal's to keep: an account runs 2 at once
 * when new and up to 40 as its invoices grow, across every endpoint, and a queued request over
 * the limit is never refused, only held (fal.ai/docs, *Concurrency limits*). So the queue is the
 * limiter and this only bounds what one tab has open. Measured on the owner's key the same day,
 * ten pieces of a world: 113 s four at a time, 63 s all at once, sixteen at once 62 s, fal running
 * 6–7 of them at any moment and holding the rest, no request refused.
 */
const PARALLEL = 12;
let running = 0;
const waiting: (() => void)[] = [];
/**
 * When fal.ai gave each piece a runner, by the same id as `inFlight`; a piece asked for and not
 * in here is still waiting, in this tab's turn, on its picture or in fal's queue.
 */
const turnSince = new Map<string, number>();

async function inTurn<T>(id: string, run: (started: () => void) => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await run(() => turnSince.set(id, Date.now()));
  } finally {
    turnSince.delete(id);
    running--;
    waiting.shift()?.();
  }
}

/**
 * One generation per world and slot at a time, and none again in this session for one that
 * failed: a refused key or an empty balance would otherwise be asked again on every visit. A
 * refusal (401, 402, 403) stops the world's other slots before they spend anything.
 */
const inFlight = new Map<string, Promise<LandmarkModel>>();
/**
 * Made in this session, whether or not the world handed in has it yet: React may run the effect
 * again between a model's arrival and the world's state taking it, and that once asked fal.ai for
 * three pieces a second time (Oct 2026).
 */
const made = new Set<string>();
const failed = new Set<string>();
const refused = new Set<string>();

/**
 * Starts whatever of the hub this world lacks, the landmark first, and calls `onModel` with each
 * piece as it arrives, so the village changes a piece at a time. A slot already being made or
 * already failed is left alone, so calling it again on every change of the world is safe.
 */
export function ensureHubModels(
  key: string,
  world: WorldBible,
  onModel: (slot: HubSlot, model: LandmarkModel) => void,
  onError: (slot: HubSlot, err: unknown) => void = () => {},
  o: FalOptions = {},
): HubSlot[] {
  const started: HubSlot[] = [];
  if (refused.has(world.id)) return started;
  for (const slot of hubSlots(world)) {
    const id = `${world.id}/${slot}`;
    if (hubModel(world, slot) || made.has(id) || failed.has(id) || inFlight.has(id)) continue;
    const p = inTurn(id, async (started) => {
      if (refused.has(world.id)) throw new Error('skipped: fal.ai refused the key');
      try {
        const model = await withRetries((each) => generateHubModel(key, world, slot, each, started), o);
        made.add(id);
        return model;
      } catch (err) {
        // Before the turn passes on, so the next in line sees it.
        if (/^40[123]\b/.test(err instanceof Error ? err.message : '')) refused.add(world.id);
        throw err;
      }
    }).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
    started.push(slot);
    p.then(
      (model) => onModel(slot, model),
      (err) => {
        failed.add(id);
        onError(slot, err);
      },
    );
  }
  return started;
}

/**
 * What fal.ai has been asked for and not yet answered (the start's progress, `progress.ts`): each
 * piece's id — `world/slot` for the hub, `clue/…` and `place/…` for a quest's — and when fal.ai
 * began making its model, or null while it waits for that.
 */
export function falPending(): { id: string; since: number | null }[] {
  return [...inFlight.keys()].map((id) => ({ id, since: turnSince.get(id) ?? null }));
}

/** A hub slot of this world that failed this session and will not be asked again until a reload. */
export function hubSlotFailed(worldId: string, slot: HubSlot): boolean {
  return failed.has(`${worldId}/${slot}`) || refused.has(worldId);
}

/** A model fal.ai was asked to make for a hub slot and has not answered yet. */
export function hubSlotPending(worldId: string, slot: HubSlot): boolean {
  return inFlight.has(`${worldId}/${slot}`);
}

/**
 * A clue's picture (owner, 26 Oct 2026: "generated assets to examine, and a witcher-senses button
 * to light them up"): the thing the model described in English (`Clue.prop`), small and whole, in
 * the world's colours where it has any, lying as it would be found.
 */
export function cluePrompt(prop: string, look?: Pick<WorldBible['look'], 'accent'>): string {
  return [
    `A single stylised low-poly game asset, a small object lying on the ground: ${prop.trim().replace(/[.\s]+$/, '')}.`,
    look ? `A touch of ${look.accent} somewhere on it.` : '',
    'The whole object in view, three-quarter view from slightly above.',
    'Chunky, thick proportions with no thin or spindly parts,',
    'isolated on a plain white background, no ground, no shadow, no people, no text, soft even light.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * A clue's model, made once per clue: the same queue as the hub's (`inTurn`), and the same rule
 * that a refused key stops asking. `id` is whatever names the clue for good (the world, the quest's
 * start, the beat and its index), so a reload with the model not yet on the beat does not ask twice
 * in one session.
 */
export function ensureClueModel(
  key: string,
  id: string,
  prompt: string,
  onModel: (model: LandmarkModel) => void,
  onError: (err: unknown) => void = () => {},
  o: FalOptions = {},
): boolean {
  return ensurePiece(key, 'clue', id, prompt, onModel, onError, o);
}

/**
 * What a quest's place shows in an invented world (`PlaceAsset`): its landmark, or a thing that stands
 * around it many times over, as the beat described it in English, in the world's colours.
 */
export function placeAssetPrompt(what: string, role: 'landmark' | 'scatter', look?: Pick<WorldBible['look'], 'wall' | 'roof' | 'accent'>): string {
  return [
    `A single stylised low-poly game asset: ${what.trim().replace(/[.\s]+$/, '')}.`,
    look ? `Colours: walls ${look.wall}, roof ${look.roof}, glowing accents ${look.accent}.` : '',
    role === 'landmark'
      ? 'Seen from the front and slightly above, its entrance or face toward the viewer, the whole of it in view, standing on a small base,'
      : 'The whole object in view, three-quarter view from slightly above, chunky, thick proportions with no thin or spindly parts,',
    'isolated on a plain white background, no ground, no shadow, no people, no text, soft even light.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A place's piece, made once: `id` names the world, the place and the piece for good. */
export function ensurePlaceModel(
  key: string,
  id: string,
  prompt: string,
  onModel: (model: LandmarkModel) => void,
  onError: (err: unknown) => void = () => {},
  o: FalOptions = {},
): boolean {
  return ensurePiece(key, 'place', id, prompt, onModel, onError, o);
}

/**
 * A person's model (`personPrompt`), made once: a quest's character by world and name, the hero by
 * world, an enemy by the beat whose job it is. Rigged in the browser when it loads (`people.ts`).
 */
export function ensurePersonModel(
  key: string,
  label: PersonSlot,
  id: string,
  prompt: string,
  onModel: (model: LandmarkModel) => void,
  onError: (err: unknown) => void = () => {},
  o: FalOptions = {},
): boolean {
  return ensurePiece(key, label, id, posePerson(prompt, personPose), onModel, onError, o);
}

function ensurePiece(
  key: string,
  label: 'clue' | 'place' | PersonSlot,
  id: string,
  prompt: string,
  onModel: (model: LandmarkModel) => void,
  onError: (err: unknown) => void,
  o: FalOptions,
): boolean {
  const slot = `${label}/${id}`;
  if (refused.has(label) || made.has(slot) || failed.has(slot) || inFlight.has(slot)) return false;
  const p = inTurn(slot, async (running) => {
    if (refused.has(label)) throw new Error('skipped: fal.ai refused the key');
    const started = Date.now();
    let spent = 0;
    try {
      const { image, glb, queuedMs, costUsd } = await withRetries((each) => imageAndMesh(key, prompt, label, each, slot, running), o);
      spent += costUsd;
      const model: LandmarkModel = { glb, image, prompt, costUsd: spent, ms: Date.now() - started, queuedMs, at: Date.now() };
      recordMeasurement('rpg.landmark', { outcome: 'generated', piece: label, ms: model.ms, costUsd: spent });
      made.add(slot);
      return model;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/^40[123]\b/.test(message)) refused.add(label);
      recordMeasurement('rpg.landmark', { outcome: 'failed', piece: label, ms: Date.now() - started, costUsd: spent, error: message.slice(0, 200) });
      throw err;
    }
  }).finally(() => inFlight.delete(slot));
  inFlight.set(slot, p);
  p.then(onModel, (err) => {
    failed.add(slot);
    onError(err);
  });
  return true;
}

const CACHE = 'rpg-landmarks';

/** The GLB's bytes: from the Cache API when this browser has fetched them before, else fetched and kept. */
export async function loadLandmarkBytes(url: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = typeof caches === 'undefined' ? null : await caches.open(CACHE);
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching the landmark`);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {
      /* a full or blocked cache only means fetching again next time */
    }
  }
  return res.arrayBuffer();
}
