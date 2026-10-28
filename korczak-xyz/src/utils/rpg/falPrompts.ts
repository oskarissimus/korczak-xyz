/*
 * What fal.ai is asked to make for a world, and how: the models, the prices, and every piece's
 * picture prompt. Pure, so the browser (`landmark3d.ts`, which re-exports all of it) and the
 * server's job runner (`functions/src/rpg/jobs.ts`, `serverJobs.ts`) build the same prompt for the
 * same piece — the server starts a world's hub itself once its genesis is in, with nobody watching.
 */

import { FOREST_VARIANTS, HUB_PIECES, type ForestVariant, type HubPiece, type WorldBible } from './genesis';

export const FAL_IMAGE_MODEL = 'fal-ai/flux/schnell';
export const FAL_MESH_MODEL = 'fal-ai/trellis';

/** List prices, US dollars, Oct 2026 (fal.ai/models/fal-ai/flux/schnell, …/fal-ai/trellis). */
export const FAL_PRICES = { imagePerMegapixel: 0.003, mesh: 0.02 } as const;

export const IMAGE_SIZE = 512;

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
/**
 * Everything fal.ai is asked to make: the hub's pieces, the forest, a quest's clues (`ensureClueModel`)
 * and what stands at a quest's places (`ensurePlaceModel`).
 */
export type FalSlot = HubSlot | 'clue' | 'place';

/**
 * Each piece's mesh is simplified as far as TRELLIS goes (0.98): at 0.96 one house was 36k
 * triangles, five of them more than the whole village; at 0.98 it was 12k, a lamp 3k, a tree ~15k.
 * The landmark keeps 0.95, being one and the thing looked at.
 */
export const SIMPLIFY: Record<FalSlot, number> = {
  clue: 0.98,
  // A place's landmark and the things copied around it, between the hub's landmark and its pieces.
  place: 0.97,
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
