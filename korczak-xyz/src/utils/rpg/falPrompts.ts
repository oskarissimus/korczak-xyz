/*
 * What fal.ai is asked to make for a world, and how: the models, the prices, and every piece's
 * picture prompt. Pure, so the browser (`landmark3d.ts`, which re-exports all of it) and the
 * server's job runner (`functions/src/rpg/jobs.ts`, `serverJobs.ts`) build the same prompt for the
 * same piece — the server starts a world's hub itself once its genesis is in, with nobody watching.
 */

import { FOREST_VARIANTS, HUB_PIECES, type ForestVariant, type HubPiece, type WorldBible } from './genesis';

export const FAL_IMAGE_MODEL = 'fal-ai/flux/schnell';
export const FAL_MESH_MODEL = 'fal-ai/trellis';
/** Meshy's auto-rig, one of the two ways a person gets a skeleton (`Rigger` in `people.ts`). */
export const FAL_RIG_MODEL = 'fal-ai/meshy/rigging';
/** Meshy's image-to-3D, the other way a person's model can be made (`setPersonMesher` in `landmark3d.ts`). */
export const FAL_PERSON_MESH_MODEL = 'fal-ai/meshy/v6/image-to-3d';

/** List prices, US dollars, Oct 2026 (fal.ai/models/fal-ai/flux/schnell, …/fal-ai/trellis, …/fal-ai/meshy/rigging, …/fal-ai/meshy/v6/image-to-3d). */
export const FAL_PRICES = { imagePerMegapixel: 0.003, mesh: 0.02, rig: 0.2, meshyMesh: 0.8 } as const;

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
 * Everything fal.ai is asked to make: the hub's pieces, the forest, a quest's clues (`ensureClueModel`),
 * what stands at a quest's places (`ensurePlaceModel`), and the people (`ensurePersonModel`): the
 * quest's characters, the hero, and the enemies that walk on two legs.
 */
export type FalSlot = HubSlot | 'clue' | 'place' | PersonSlot;
export type PersonSlot = 'person' | 'hero' | 'enemy';

/**
 * Each piece's mesh is simplified as far as TRELLIS goes (0.98): at 0.96 one house was 36k
 * triangles, five of them more than the whole village; at 0.98 it was 12k, a lamp 3k, a tree ~15k.
 * The landmark keeps 0.95, being one and the thing looked at.
 */
export const SIMPLIFY: Record<FalSlot, number> = {
  clue: 0.98,
  // A person is looked at up close and bends at every joint: ~9k triangles, as many as a Quaternius one.
  person: 0.95,
  hero: 0.95,
  enemy: 0.95,
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

const A_POSE = 'Standing straight in an A-pose, arms held a little away from the body, legs apart, hands empty and open,';
/** The precise A-pose: the game's A-pose setting and the lab's "wide" picture. */
const WIDE_POSE =
  'Standing in a precise A-pose for rigging (an A-pose, not a T-pose): both arms straight, angled down exactly 45 degrees from the shoulders, elbows and wrists straight, palms facing the thighs, fingers straight and together, hands at hip height and well away from the thighs, a clear gap between each arm and the body all the way to the armpit; both hands completely empty, holding nothing at all, no weapon, tool, staff, shield, lantern, bag, book or any other object in or near the hands (anything they carry is worn on the back or at the belt); legs straight and apart with a clear gap between them, feet flat on the ground, clothes close to the body, nothing hanging from the arms or between the legs,';
/**
 * The picture a person's model is made from (`components/Rpg/people.ts`): one person, whole, front-on,
 * in an A-pose with empty hands, on white. The pose is the rig's: every person is warped from the same
 * donor body standing that way (`utils/rpg/selfRig.ts`), so a figure with folded arms, a staff in hand
 * or a friend beside them comes out with the wrong bones. "One person only" is there because FLUX drew
 * the same woman twice side by side (28 Oct 2026), and TRELLIS made both.
 */
export function personPrompt(appearance: string, who: { gender?: 'male' | 'female'; color?: string }): string {
  return [
    `A single full-body 3D game character, one person only: ${appearance.trim().replace(/[.\s]+$/, '')}.`,
    who.gender === 'female' ? 'A woman.' : who.gender === 'male' ? 'A man.' : '',
    who.color ? `Their clothes are mostly ${who.color}.` : '',
    A_POSE,
    'facing the viewer, the whole figure from head to feet, centred.',
    'Stylised low-poly game character, chunky proportions,',
    'isolated on a plain white background, no ground, no shadow, no text, soft even light.',
  ]
    .filter(Boolean)
    .join(' ');
}

const T_POSE =
  'Standing in a strict T-pose for rigging: both arms stretched straight out to the sides, exactly horizontal at shoulder height, in one straight line from fingertip to fingertip, elbows and wrists straight, palms facing down, fingers straight and together, a clear gap between each arm and the body all the way to the armpit; both hands completely empty, holding nothing at all, no weapon, tool, staff, shield, lantern, bag, book or any other object in or near the hands (anything they carry is worn on the back or at the belt); legs straight and slightly apart with a clear gap between them, feet flat on the ground, clothes close to the body, nothing hanging from the arms or between the legs,';

/**
 * A person's prompt in a strict T-pose, for the model lab (owner, 29 Oct 2026: "the key to a good
 * rig is a very exact T-pose in the picture; the arms pointing exactly, no objects held in them").
 */
export function tPose(prompt: string): string {
  return prompt.includes(A_POSE) ? prompt.replace(A_POSE, T_POSE) : `${prompt} ${T_POSE.replace(/,$/, '.')}`;
}

/**
 * The pose a person is drawn in, the game's setting (owner, 29 Oct 2026: "put the T-pose in the
 * game, and a setting for A-pose or T-pose, both prompts viewable and very precise about what we
 * want"). The words of each, as sent, for the settings to show.
 */
export const PERSON_POSES = { tpose: T_POSE, apose: WIDE_POSE } as const;
export type PersonPose = keyof typeof PERSON_POSES;
export const DEFAULT_POSE: PersonPose = 'tpose';

/** A person's prompt (`personPrompt`, in its loose A-pose) in `pose`. */
export function posePerson(prompt: string, pose: PersonPose): string {
  return pose === 'tpose' ? tPose(prompt) : widePose(prompt);
}

/**
 * A person's prompt in a wider pose, for the model lab (`/apps/rpg-models/`): the guess being tested
 * is that TRELLIS fuses what touches in the picture (a hand to an apron), and no rig can part it
 * after, so a picture with gaps rigs better at the same $0.023.
 */
export function widePose(prompt: string): string {
  return prompt.includes(A_POSE) ? prompt.replace(A_POSE, WIDE_POSE) : `${prompt} ${WIDE_POSE.replace(/,$/, '.')}`;
}

/**
 * How a character looks, for `personPrompt`: what the beat wrote (`appearance`), or for one from
 * before it, the persona their voice was designed from (English too) and what people wear here.
 */
export function personLook(
  c: { appearance?: string; voice?: string; age?: string },
  world: Pick<WorldBible, 'people' | 'hub'>,
): string {
  if (c.appearance?.trim()) return c.appearance.trim();
  const persona = c.voice?.match(/Persona:\s*([^.]+)/i)?.[1]?.trim();
  const age = c.age === 'old' ? 'an old' : c.age === 'young' ? 'a young' : 'a';
  return [persona ? `${age} ${persona}` : `${age} villager of ${world.hub}`, world.people ? `dressed as people here dress: ${world.people}` : '']
    .filter(Boolean)
    .join(', ')
    .slice(0, 300);
}

/** How the hero looks, for `personPrompt`: the world's `hero` line, or who the player is in a world from before it. */
export function heroLook(world: Pick<WorldBible, 'hero' | 'player' | 'people'>): string {
  return world.hero?.trim() || `a wandering adventurer in sturdy travelling clothes: ${world.player || world.people}`.slice(0, 300);
}
