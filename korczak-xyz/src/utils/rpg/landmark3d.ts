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
 * About $0.023 a world, against ~$0.60 a model on Meshy. The prompt is the world's own `landmark`
 * line, which genesis writes in English for exactly this; an older world without one is described
 * from its hub, architecture and look instead.
 *
 * GENERATED ONCE PER WORLD. The result is kept on the world's bible (`landmarkModel`), which the
 * library and the account already sync (`worldSave.ts`, `cloud.ts`), so neither this browser nor
 * another device asks again. fal's files would otherwise expire on fal's schedule, so every request
 * asks for none (`X-Fal-Object-Lifecycle-Preference`), and the GLB's bytes are also kept in the
 * Cache API (`loadLandmarkBytes`), so after the first visit the model loads without the network.
 *
 * Every request is in the developer console as kind `fal`, with its time, its error and its price,
 * and adds to its own fal.ai total there, apart from the tokens and ElevenLabs.
 */

import { recordMeasurement } from '../../lib/sentry';
import { endRequest, startRequest, updateRequest } from './devlog';
import type { LandmarkModel, WorldBible } from './genesis';

export type { LandmarkModel };

export const FAL_IMAGE_MODEL = 'fal-ai/flux/schnell';
export const FAL_MESH_MODEL = 'fal-ai/trellis';

/** List prices, US dollars, Oct 2026 (fal.ai/models/fal-ai/flux/schnell, …/fal-ai/trellis). */
export const FAL_PRICES = { imagePerMegapixel: 0.003, mesh: 0.02 } as const;

const IMAGE_SIZE = 512;

export function imageCost(width = IMAGE_SIZE, height = IMAGE_SIZE): number {
  return Math.ceil((width * height) / 1_000_000) * FAL_PRICES.imagePerMegapixel;
}

/** The picture the 3D model is made from: one object, whole, on white, so TRELLIS sees all of it. */
export function landmarkPrompt(world: Pick<WorldBible, 'landmark' | 'hub' | 'architecture' | 'pitch' | 'look'>): string {
  const subject = world.landmark?.trim()
    ? world.landmark.trim()
    : `the one monument that stands in the middle of ${world.hub}, built the way this world builds: ${world.architecture || world.pitch}`;
  return [
    `A single stylised low-poly game asset: ${subject}.`,
    `Colours: walls ${world.look.wall}, roof ${world.look.roof}, glowing accents ${world.look.accent}.`,
    'The whole object in view, three-quarter view from slightly above, standing on a small base,',
    'isolated on a plain white background, no ground, no people, no text, soft even light.',
  ].join(' ');
}

export interface FalOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** How long the queue may take before the mesh is given up on. */
  timeoutMs?: number;
  pollMs?: number;
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

/** Step 1: the picture. */
async function drawImage(key: string, prompt: string, o: FalOptions): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const entry = startRequest('fal', FAL_IMAGE_MODEL, null, prompt);
  try {
    const res = await f(`https://fal.run/${FAL_IMAGE_MODEL}`, {
      method: 'POST',
      headers: headers(key),
      signal: o.signal,
      body: JSON.stringify({
        prompt,
        image_size: { width: IMAGE_SIZE, height: IMAGE_SIZE },
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: true,
      }),
    });
    if (!res.ok) throw await failure(res);
    const body = (await res.json()) as { images?: { url?: string }[] };
    const url = body.images?.[0]?.url;
    if (!url) throw new Error('no image in the answer');
    endRequest(entry, null, { cost: imageCost(), text: `${prompt}\n→ ${url}` });
    return url;
  } catch (err) {
    endRequest(entry, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Step 2: the model, through the queue, since it takes longer than a request should stay open. */
async function buildMesh(key: string, image: string, o: FalOptions): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? wait;
  const entry = startRequest('fal', FAL_MESH_MODEL, null, `← ${image}`);
  try {
    const submit = await f(`https://queue.fal.run/${FAL_MESH_MODEL}`, {
      method: 'POST',
      headers: headers(key),
      signal: o.signal,
      body: JSON.stringify({ image_url: image, texture_size: 512, mesh_simplify: 0.95 }),
    });
    if (!submit.ok) throw await failure(submit);
    const queued = (await submit.json()) as { status_url?: string; response_url?: string };
    if (!queued.status_url || !queued.response_url) throw new Error('the queue gave no request to follow');
    const auth = { Authorization: `Key ${key}` };
    const deadline = Date.now() + (o.timeoutMs ?? 180_000);
    for (;;) {
      await sleep(o.pollMs ?? 2000);
      if (Date.now() > deadline) throw new Error('timed out in the queue');
      const res = await f(queued.status_url, { headers: auth, signal: o.signal });
      if (!res.ok) throw await failure(res);
      const s = (await res.json()) as { status?: string; queue_position?: number };
      const line = s.status === 'IN_QUEUE' ? `IN_QUEUE #${s.queue_position ?? '?'}` : (s.status ?? '?');
      updateRequest(entry, { text: `← ${image}\n${line}` });
      if (s.status === 'COMPLETED') break;
    }
    const res = await f(queued.response_url, { headers: auth, signal: o.signal });
    if (!res.ok) throw await failure(res);
    const body = (await res.json()) as { model_mesh?: { url?: string; file_size?: number } };
    const glb = body.model_mesh?.url;
    if (!glb) throw new Error('no model in the answer');
    const kb = body.model_mesh?.file_size ? ` (${Math.round(body.model_mesh.file_size / 1024)} KB)` : '';
    endRequest(entry, null, { cost: FAL_PRICES.mesh, text: `← ${image}\n→ ${glb}${kb}` });
    return glb;
  } catch (err) {
    endRequest(entry, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Picture, then model. Throws with the step's error; both steps are in the console either way. */
export async function generateLandmark(key: string, world: WorldBible, o: FalOptions = {}): Promise<LandmarkModel> {
  const started = Date.now();
  const prompt = landmarkPrompt(world);
  let spent = 0;
  try {
    const image = await drawImage(key, prompt, o);
    spent += imageCost();
    const glb = await buildMesh(key, image, o);
    spent += FAL_PRICES.mesh;
    const model: LandmarkModel = { glb, image, prompt, costUsd: spent, ms: Date.now() - started, at: Date.now() };
    recordMeasurement('rpg.landmark', { outcome: 'generated', ms: model.ms, costUsd: spent, lang: world.lang });
    return model;
  } catch (err) {
    recordMeasurement('rpg.landmark', {
      outcome: 'failed',
      ms: Date.now() - started,
      costUsd: spent,
      lang: world.lang,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    throw err;
  }
}

/**
 * One generation per world at a time, and none again in this session for a world whose generation
 * failed: a refused key or an empty balance would otherwise be asked again on every visit.
 */
const inFlight = new Map<string, Promise<LandmarkModel>>();
const failed = new Set<string>();

export function ensureLandmark(key: string, world: WorldBible, o: FalOptions = {}): Promise<LandmarkModel> | null {
  if (world.landmarkModel) return Promise.resolve(world.landmarkModel);
  if (failed.has(world.id)) return null;
  let p = inFlight.get(world.id);
  if (!p) {
    p = generateLandmark(key, world, o).finally(() => inFlight.delete(world.id));
    p.catch(() => failed.add(world.id));
    inFlight.set(world.id, p);
  }
  return p;
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
