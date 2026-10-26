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
 * world**, made four at a time in ~1–1.5 min while the kit's village stands in for them.
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
import { endRequest, startRequest, updateRequest } from './devlog';
import { FOREST_VARIANTS, HUB_PIECES, type ForestVariant, type HubPiece, type LandmarkModel, type WorldBible } from './genesis';

export type { LandmarkModel };

export const FAL_IMAGE_MODEL = 'fal-ai/flux/schnell';
export const FAL_MESH_MODEL = 'fal-ai/trellis';

/** List prices, US dollars, Oct 2026 (fal.ai/models/fal-ai/flux/schnell, …/fal-ai/trellis). */
export const FAL_PRICES = { imagePerMegapixel: 0.003, mesh: 0.02 } as const;

const IMAGE_SIZE = 512;

export function imageCost(width = IMAGE_SIZE, height = IMAGE_SIZE): number {
  return Math.ceil((width * height) / 1_000_000) * FAL_PRICES.imagePerMegapixel;
}

/** Everything fal.ai makes for a world, in the order it is made: the hub, then the forest's other trees. */
export type HubSlot = 'landmark' | HubPiece | ForestVariant;
export const HUB_SLOTS: readonly HubSlot[] = ['landmark', ...HUB_PIECES, ...FOREST_VARIANTS];
/** The forest's trees, the hub's own first: what `RpgScene.setForest` plants across the map. */
export const FOREST_SLOTS: readonly HubSlot[] = ['tree', ...FOREST_VARIANTS];

export function isForestVariant(slot: HubSlot): slot is ForestVariant {
  return (FOREST_VARIANTS as readonly string[]).includes(slot);
}
/** Everything fal.ai is asked to make: the hub's pieces, the forest, and a quest's clues (`ensureClueModel`). */
export type FalSlot = HubSlot | 'clue';

/**
 * Each piece's mesh is simplified as far as TRELLIS goes (0.98): at 0.96 one house was 36k
 * triangles, five of them more than the whole village; at 0.98 it was 12k, a lamp 3k, a tree ~15k.
 * The landmark keeps 0.95, being one and the thing looked at.
 */
const SIMPLIFY: Record<FalSlot, number> = {
  clue: 0.98,
  landmark: 0.95,
  house: 0.98,
  hall: 0.98,
  tree: 0.98,
  stall: 0.98,
  cart: 0.98,
  lamp: 0.98,
  goods: 0.98,
  tree2: 0.98,
  tree3: 0.98,
};

/** How each of the forest's other trees differs from the hub's, appended to its line. */
const VARIANT: Record<ForestVariant, string> = {
  tree2: 'a young one of the same kind, smaller and lighter, with fewer branches',
  tree3: 'an old one of the same kind, larger, wider and more gnarled',
};

/** What a tree is in a world that wrote no `kit`, from its flora; `none` grows nothing to make. */
const FLORA_SUBJECT: Record<WorldBible['look']['flora'], string | null> = {
  pines: 'a tall pine tree',
  broadleaf: 'a broad leafy tree with a round crown',
  dead: 'a dead, leafless, twisted tree',
  fungi: 'a giant mushroom as tall as a tree',
  spires: 'a tall crystal spire growing out of the ground',
  none: null,
};

type PromptWorld = Pick<WorldBible, 'landmark' | 'kit' | 'hub' | 'architecture' | 'pitch' | 'tech' | 'look'>;

/** A piece in a world from before `kit`, described from its bible (whose words may be in Polish). */
function fallbackSubject(world: PromptWorld, piece: HubPiece): string | null {
  const built = world.architecture || world.pitch;
  switch (piece) {
    case 'house':
      return `a small one-storey home in ${world.hub}, built like this: ${built}`;
    case 'hall':
      return `the biggest building of ${world.hub}, a meeting hall, built like this: ${built}`;
    case 'tree':
      return FLORA_SUBJECT[world.look.flora];
    case 'stall':
      return `a market stall in ${world.hub}, built like this: ${built}`;
    case 'cart':
      return `a cart for moving goods, as made in a world where ${world.tech || world.pitch}`;
    case 'lamp':
      return `a sturdy light post, as made in a world where ${world.tech || world.pitch}`;
    case 'goods':
      return 'a small pile of goods: crates, sacks and barrels';
  }
}

/** What the world's tree is, from its `kit` line or else its flora; null where nothing grows. */
function treeSubject(world: PromptWorld): string | null {
  return world.kit?.tree?.trim() || FLORA_SUBJECT[world.look.flora];
}

/** The slots this world has something to make for: all of them, but no tree where nothing grows. */
export function hubSlots(world: PromptWorld): HubSlot[] {
  return HUB_SLOTS.filter((s) => (s !== 'tree' && !isForestVariant(s)) || treeSubject(world));
}

/**
 * The picture a 3D model is made from: one object, whole, on white, so TRELLIS sees all of it.
 * Buildings face the camera with their door, since TRELLIS keeps the picture's front as the model's
 * +Z and the game turns +Z to the square. Thin parts are asked away: a lamp on a slender pole came
 * back as its lantern and a hook, the pole gone (Oct 2026). A tree is asked for a solid silhouette
 * on top of that: FLUX draws dead trees with a hundred bare twigs whatever "chunky" says, and from
 * those TRELLIS built a flat card with the picture on it, twice in three (26 Oct 2026); with "a few
 * thick limbs … no twigs" four trees of four kinds all came back as trees.
 */
export function hubModelPrompt(world: PromptWorld, slot: HubSlot = 'landmark'): string {
  const { look } = world;
  if (slot === 'landmark') {
    const subject = world.landmark?.trim()
      ? world.landmark.trim()
      : `the one monument that stands in the middle of ${world.hub}, built the way this world builds: ${world.architecture || world.pitch}`;
    return [
      `A single stylised low-poly game asset: ${subject}.`,
      `Colours: walls ${look.wall}, roof ${look.roof}, glowing accents ${look.accent}.`,
      'The whole object in view, three-quarter view from slightly above, standing on a small base,',
      'isolated on a plain white background, no ground, no people, no text, soft even light.',
    ].join(' ');
  }
  const subject = isForestVariant(slot)
    ? `${(treeSubject(world) ?? 'a tree').replace(/[.\s]+$/, '')}, ${VARIANT[slot]}`
    : world.kit?.[slot]?.trim() || fallbackSubject(world, slot) || slot;
  const building = slot === 'house' || slot === 'hall' || slot === 'stall';
  const tree = slot === 'tree' || isForestVariant(slot);
  return [
    `A single stylised low-poly game asset: ${subject.replace(/[.\s]+$/, '')}.`,
    tree
      ? `Colours: foliage ${look.foliage}, glowing accents ${look.accent}.`
      : `Colours: walls ${look.wall}, roof ${look.roof}, glowing accents ${look.accent}.`,
    building
      ? 'Seen from the front and slightly above, its entrance facing the viewer, the whole of it in view.'
      : 'The whole object in view, three-quarter view from slightly above.',
    'Chunky, thick proportions with no thin or spindly parts,',
    ...(tree ? ['a few thick limbs and one solid, compact silhouette, no twigs, simple faceted shapes like a mobile game asset,'] : []),
    'isolated on a plain white background, no ground, no shadow, no people, no text, soft even light.',
  ].join(' ');
}

/** The landmark's picture prompt, as it was before the other pieces. */
export const landmarkPrompt = (world: PromptWorld) => hubModelPrompt(world, 'landmark');

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
async function drawImage(key: string, prompt: string, label: FalSlot, o: FalOptions): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const entry = startRequest('fal', FAL_IMAGE_MODEL, null, prompt, label);
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
async function buildMesh(key: string, image: string, label: FalSlot, o: FalOptions): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? wait;
  const entry = startRequest('fal', FAL_MESH_MODEL, null, `← ${image}`, label);
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
    const deadline = Date.now() + (o.timeoutMs ?? 300_000);
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
export async function generateHubModel(key: string, world: WorldBible, slot: HubSlot, o: FalOptions = {}): Promise<LandmarkModel> {
  const started = Date.now();
  const prompt = hubModelPrompt(world, slot);
  let spent = 0;
  try {
    const image = await drawImage(key, prompt, slot, o);
    spent += imageCost();
    const glb = await buildMesh(key, image, slot, o);
    spent += FAL_PRICES.mesh;
    const model: LandmarkModel = { glb, image, prompt, costUsd: spent, ms: Date.now() - started, at: Date.now() };
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

/** How many pieces fal.ai makes at once: the hub's eight took 55–80 s four at a time, and the queue holds the rest. */
const PARALLEL = 4;
let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(run: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await run();
  } finally {
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
    const p = inTurn(async () => {
      if (refused.has(world.id)) throw new Error('skipped: fal.ai refused the key');
      try {
        const model = await generateHubModel(key, world, slot, o);
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
  const slot = `clue/${id}`;
  if (refused.has('clue') || made.has(slot) || failed.has(slot) || inFlight.has(slot)) return false;
  const p = inTurn(async () => {
    if (refused.has('clue')) throw new Error('skipped: fal.ai refused the key');
    const started = Date.now();
    let spent = 0;
    try {
      const image = await drawImage(key, prompt, 'clue', o);
      spent += imageCost();
      const glb = await buildMesh(key, image, 'clue', o);
      spent += FAL_PRICES.mesh;
      const model: LandmarkModel = { glb, image, prompt, costUsd: spent, ms: Date.now() - started, at: Date.now() };
      recordMeasurement('rpg.landmark', { outcome: 'generated', piece: 'clue', ms: model.ms, costUsd: spent });
      made.add(slot);
      return model;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/^40[123]\b/.test(message)) refused.add('clue');
      recordMeasurement('rpg.landmark', { outcome: 'failed', piece: 'clue', ms: Date.now() - started, costUsd: spent, error: message.slice(0, 200) });
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
