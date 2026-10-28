/*
 * Where an invented world's village stands: its landmark, houses, halls, stalls, carts, lamps, goods
 * and trees, and the forest across the map (owner, 27 Oct 2026: "while the world is generated and
 * there are no assets yet there should be an empty board, not placeholders; things should just
 * appear as they become available, and where they stand should be generated, not predefined").
 *
 * Drawn from the world's id, so a world is laid out the same way on every load and every device,
 * and no two worlds the same way: a style (a ring round the square, a street through it, a cluster
 * to one side, a scatter), how far the village reaches, how many of each piece, where the groves
 * are. Nothing is asked of a model and nothing is stored: the id is the whole of it.
 *
 * What it keeps clear, whatever the style: the square, where the characters stand and the hunter
 * starts (`VILLAGE_STANDS`, `SPAWN_AT`), apart from a landmark that may stand in its middle; the
 * eight roads out (`ROAD_START` along each direction a quest may name) under anything bigger than a
 * lamp; and the pieces from each other. The classic world keeps its hand-built village and never
 * comes here.
 *
 * Plain numbers on the ground plane, no Three.js, so it can be tested.
 */

import { clampTo, HUB_SIZE_LIMITS, type HubSize, type HubSizes } from './genesis';
import type { HubSlot } from './landmark3d';
import { ROAD_START } from './trail';

/**
 * What a slot is sized to before the world says how big its piece really is (`WorldBible.sizes`):
 * metres, tallest and widest. The landmark is twice the houses' eaves, seen over the roofs from the
 * edge of the village, and 5 m across at most: the square's walkway around it is ~5 m before the
 * first villager. The house and the hall take the kit's small (4×6 m) and large (6×8 m) houses'
 * plots; the rest stand where the kit's cart, wagon, barrels and crates stood.
 */
export const HUB_FIT: Record<HubSlot, { height: number; width: number }> = {
  landmark: { height: 6.5, width: 5 },
  house: { height: 5.5, width: 6.5 },
  hall: { height: 7, width: 8.5 },
  tree: { height: 6.5, width: 5 },
  stall: { height: 3, width: 3.2 },
  cart: { height: 2.4, width: 3.6 },
  lamp: { height: 3.2, width: 1.2 },
  goods: { height: 1.4, width: 1.8 },
  // Stand nowhere in the hub: the forest sizes its trees by `FOREST_FIT`.
  tree2: { height: 6.5, width: 5 },
  tree3: { height: 6.5, width: 5 },
};

/**
 * The piece's own size when the world has one, else the slot's. The world's comes from the model
 * that described the piece, so a home that is a truck stands truck-sized; the slot's assumed a
 * building, and stood that truck 6 m tall (owner, 26 Oct 2026). Clamped again here, so a world whose
 * sizes were kept under older, lower floors stands at today's (owner, 28 Oct 2026).
 */
export function hubFit(slot: HubSlot, sizes: HubSizes | undefined): { height: number; width: number } {
  // The forest's other trees have no size of their own: they are planted at the tree's (`setForest`).
  const own = (sizes as Partial<Record<HubSlot, HubSize>> | undefined)?.[slot];
  if (!own) return HUB_FIT[slot];
  const limits = HUB_SIZE_LIMITS[slot as keyof typeof HUB_SIZE_LIMITS];
  return limits ? { height: clampTo(own.height, limits.height), width: clampTo(own.width, limits.width) } : own;
}

/**
 * Every generated piece stands a tenth over the size it was given (owner, 28 Oct 2026: "rather a
 * touch too big than too small"). A model guessing sizes guesses short more often than tall, and a
 * hut the hero has to stoop into reads as a toy where one a little roomy reads as a hut.
 */
export const SIZE_BIAS = 1.1;

/**
 * How far past its stated length a piece may stand before the length, and not the height, decides
 * its size. A wide awning, a cart's shafts or a roof's eaves reach out past what a model calls the
 * thing's length; fitting to the smaller of the two scales, as this used to, let those shrink the
 * whole piece, and a stall with a deep awning came out shorter than the hero (owner, 28 Oct 2026).
 */
export const WIDTH_SLACK = 1.5;

/**
 * The uniform scale that stands a model, `size` its own bounding box, as `fit` says. Height is the
 * anchor: it is the number a person (and a model) judges best against a 1.8 m figure, and the one the
 * eye compares to the hero. The length only caps a model whose proportions came out far wider than
 * described, so a flat thing drawn as a slab cannot fill the square. This is the rule scene
 * generators that size assets by language model use (Holodeck and its successors: one metric
 * dimension from the model, the asset's own proportions for the rest).
 */
export function fitScale(size: { x: number; y: number; z: number }, fit: { height: number; width: number }): number {
  const byHeight = (fit.height * SIZE_BIAS) / Math.max(size.y, 1e-3);
  const byWidth = (fit.width * SIZE_BIAS * WIDTH_SLACK) / Math.max(size.x, size.z, 1e-3);
  return Math.min(byHeight, byWidth);
}

/** Where the characters stand in the square, in the order they first appear there. */
export const VILLAGE_STANDS: readonly { x: number; z: number }[] = [
  { x: 4, z: -4 },
  { x: -5, z: 3 },
  { x: 6, z: 5 },
  { x: -4, z: -9 },
  { x: 9, z: -1 },
];
/** Where the hunter starts. */
export const SPAWN_AT = { x: 0, z: 8 };
/**
 * The square: nothing but the landmark stands inside it. A world that has met many people stands
 * the sixth and later on a ring 7–9.4 m out (`villageSpot`), so this is past that.
 */
export const SQUARE_RADIUS = 10.5;
/** Half a road and a step either side of it. */
const ROAD_CLEAR = 2;
/** Between two pieces, past their own footprints. */
const GAP = 0.8;

export interface HubSpot {
  x: number;
  z: number;
  /** Turned about y: 0 faces +z, where the model's front is. */
  rot: number;
}

export interface ForestTree {
  x: number;
  z: number;
  /** Against the tree's own size, 0.7–1.6. */
  scale: number;
}

export type VillageStyle = 'ring' | 'street' | 'cluster' | 'scatter';

export interface HubLayout {
  /** The same for the same world and sizes: the scene lays out again only when it changes. */
  key: string;
  style: VillageStyle | 'empty';
  /** How far out the village reaches; the forest keeps a few metres past it. */
  radius: number;
  spots: Record<HubSlot, HubSpot[]>;
  forest: ForestTree[];
}

const noSpots = (): Record<HubSlot, HubSpot[]> => ({
  landmark: [],
  house: [],
  hall: [],
  tree: [],
  stall: [],
  cart: [],
  lamp: [],
  goods: [],
  tree2: [],
  tree3: [],
});

/** Nothing anywhere: the board while a world is being invented. */
export const EMPTY_LAYOUT: HubLayout = { key: 'empty', style: 'empty', radius: 0, spots: noSpots(), forest: [] };

/** mulberry32: small, seeded, and good enough to scatter trees with. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** How far (x, z) is from the nearest of the eight roads out, which leave the square at `ROAD_START`. */
export function roadDistance(x: number, z: number): number {
  const d = Math.hypot(x, z);
  if (d < ROAD_START) return Infinity;
  let best = Infinity;
  for (let i = 0; i < 8; i++) {
    // `placePosition`: direction i is at (sin a, −cos a).
    const a = (i / 8) * Math.PI * 2;
    const along = x * Math.sin(a) - z * Math.cos(a);
    if (along <= 0) continue;
    best = Math.min(best, Math.abs(x * Math.cos(a) + z * Math.sin(a)));
  }
  return best;
}

/** The footprint each slot is kept apart by: half its width as it stands (`SIZE_BIAS`) and a little. */
function footprint(slot: HubSlot, sizes: HubSizes | undefined): number {
  return (hubFit(slot, sizes).width * SIZE_BIAS) / 2 + 0.3;
}

/** Facing (x, z) from (fromX, fromZ): the rotation that turns +z toward it. */
const facing = (fromX: number, fromZ: number, x: number, z: number) => Math.atan2(x - fromX, z - fromZ);

const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);
const count = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

/** Map edge the forest stops at (`WORLD_HALF` in the scene). */
const MAP_HALF = 160;

/**
 * The village and forest of the world with this id. `sizes` are the world's own sizes for its
 * pieces, which is how much room each takes.
 */
export function hubLayout(worldId: string, sizes?: HubSizes): HubLayout {
  const rand = seeded(hash(worldId));
  const style = pick(rand, ['ring', 'street', 'cluster', 'scatter'] as const);
  const radius = between(rand, 22, style === 'scatter' ? 34 : 30);
  const spots = noSpots();
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) >= t.r + r + GAP);
  const offRoads = (x: number, z: number, r: number) => roadDistance(x, z) >= r + ROAD_CLEAR;

  /**
   * Tries `candidate` until a spot is free (and off the roads, and out of the square unless
   * `inSquare`), and takes it. Null when there is no room, which leaves that copy out.
   */
  const place = (slot: HubSlot, candidate: () => HubSpot, o: { inSquare?: boolean; onRoads?: boolean } = {}): HubSpot | null => {
    const r = footprint(slot, sizes);
    for (let tries = 0; tries < 80; tries++) {
      const s = candidate();
      const d = Math.hypot(s.x, s.z);
      if (d + r > radius + (slot === 'tree' ? 4 : 0)) continue;
      if (!o.inSquare && d - r < SQUARE_RADIUS) continue;
      if (!o.onRoads && !offRoads(s.x, s.z, r)) continue;
      if (!free(s.x, s.z, r)) continue;
      taken.push({ x: s.x, z: s.z, r });
      spots[slot].push(s);
      return s;
    }
    return null;
  };

  // The square's characters and the hunter's first step are taken before anything is placed.
  for (const s of [...VILLAGE_STANDS, SPAWN_AT]) taken.push({ ...s, r: 0.8 });

  // The landmark: in the square's middle, or at its edge as what the square looks at.
  const middle = rand() < 0.6;
  const landmark = middle
    ? place(
        'landmark',
        () => {
          const a = rand() * Math.PI * 2;
          const d = rand() * 2.5;
          const x = Math.sin(a) * d - 0.5;
          const z = Math.cos(a) * d - 0.5;
          return { x, z, rot: facing(x, z, SPAWN_AT.x, SPAWN_AT.z) };
        },
        { inSquare: true, onRoads: true },
      )
    : place('landmark', () => {
        const a = rand() * Math.PI * 2;
        const d = SQUARE_RADIUS + footprint('landmark', sizes) + rand() * 4;
        const x = Math.sin(a) * d;
        const z = Math.cos(a) * d;
        return { x, z, rot: facing(x, z, 0, 0) };
      });
  if (!landmark) {
    // Where the well stood: always room, the square being kept for it.
    spots.landmark.push({ x: 0, z: -3, rot: 0 });
    taken.push({ x: 0, z: -3, r: footprint('landmark', sizes) });
  }

  // The buildings, which is what the style is about.
  // A street runs along one of the roads out and on through the square, which is where a street would be.
  const streetAngle = (Math.floor(rand() * 4) / 8) * Math.PI * 2;
  const sector = rand() * Math.PI * 2;
  const sectorHalf = between(rand, 1, 1.6);
  const building = (slot: 'house' | 'hall') => (): HubSpot => {
    const r = footprint(slot, sizes);
    const near = SQUARE_RADIUS + r;
    if (style === 'street') {
      // Both sides of the street, facing across it.
      const ax = Math.sin(streetAngle);
      const az = Math.cos(streetAngle);
      const t = between(rand, -radius, radius);
      const side = rand() < 0.5 ? -1 : 1;
      const off = between(rand, 3.5, 5.5) + r;
      const x = ax * t + az * off * side;
      const z = az * t - ax * off * side;
      return { x, z, rot: facing(x, z, ax * t, az * t) + between(rand, -0.08, 0.08) };
    }
    const a = style === 'cluster' ? sector + between(rand, -sectorHalf, sectorHalf) : rand() * Math.PI * 2;
    const d = between(rand, near, radius);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const turn = style === 'scatter' ? between(rand, -0.7, 0.7) : between(rand, -0.25, 0.25);
    return { x, z, rot: facing(x, z, 0, 0) + turn };
  };
  const halls = count(rand, 1, 3);
  for (let i = 0; i < halls; i++) place('hall', building('hall'));
  const houses = count(rand, 2, 6);
  for (let i = 0; i < houses; i++) place('house', building('house'));

  // A stall or two and a cart or two at the square's edge, turned to it.
  const edge = (slot: HubSlot, turn: number) => (): HubSpot => {
    const a = rand() * Math.PI * 2;
    const d = SQUARE_RADIUS + footprint(slot, sizes) + rand() * 6;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    return { x, z, rot: facing(x, z, 0, 0) + between(rand, -turn, turn) };
  };
  for (let i = count(rand, 1, 2); i > 0; i--) place('stall', edge('stall', 0.3));
  for (let i = count(rand, 1, 2); i > 0; i--) place('cart', edge('cart', Math.PI));

  // Goods beside the buildings, on the side toward the square, or by the stalls.
  const beside = (['hall', 'house', 'stall'] as const).flatMap((slot) => spots[slot].map((s) => ({ ...s, r: footprint(slot, sizes) })));
  const goodsR = footprint('goods', sizes);
  for (let i = count(rand, 2, 5); i > 0 && beside.length; i--) {
    const b = pick(rand, beside);
    place('goods', () => {
      const a = Math.atan2(-b.x, -b.z) + between(rand, -1.2, 1.2);
      const d = b.r + goodsR + GAP + rand() * 1.5;
      return { x: b.x + Math.sin(a) * d, z: b.z + Math.cos(a) * d, rot: rand() * Math.PI * 2 };
    });
  }

  // Lamps: round the square, or along the roads out.
  const lampsByRoads = rand() < 0.5;
  const lamps = count(rand, 3, 7);
  const lampTurn = rand() * Math.PI * 2;
  for (let i = 0; i < lamps; i++) {
    place(
      'lamp',
      () => {
        if (lampsByRoads) {
          const a = (Math.floor(rand() * 8) / 8) * Math.PI * 2;
          const along = between(rand, SQUARE_RADIUS + 1, radius - 1);
          const side = (rand() < 0.5 ? -1 : 1) * between(rand, 2.4, 3.2);
          const x = Math.sin(a) * along + Math.cos(a) * side;
          const z = -Math.cos(a) * along + Math.sin(a) * side;
          return { x, z, rot: facing(x, z, 0, 0) };
        }
        const a = lampTurn + ((i + rand() * 0.5) / lamps) * Math.PI * 2;
        const d = SQUARE_RADIUS + 0.9;
        const x = Math.sin(a) * d;
        const z = Math.cos(a) * d;
        return { x, z, rot: facing(x, z, 0, 0) };
      },
      { onRoads: lampsByRoads },
    );
  }

  // Trees in the village wherever the rest leaves room.
  const trees = count(rand, 3, 9);
  for (let i = 0; i < trees; i++) {
    place('tree', () => {
      const a = rand() * Math.PI * 2;
      const d = between(rand, SQUARE_RADIUS + 3, radius + 3);
      return { x: Math.sin(a) * d, z: Math.cos(a) * d, rot: rand() * Math.PI * 2 };
    });
  }

  return {
    key: `${worldId} ${JSON.stringify(sizes ?? null)}`,
    style,
    radius,
    spots,
    forest: forestLayout(rand, radius + 6),
  };
}

/**
 * The forest: some trees in groves, the rest anywhere, outside the village. How many, how many
 * groves, how tight and how much of it is grove are the world's own.
 */
function forestLayout(rand: () => number, clear: number): ForestTree[] {
  const total = count(rand, 280, 460);
  const groves = Array.from({ length: count(rand, 4, 12) }, () => {
    const a = rand() * Math.PI * 2;
    const d = between(rand, clear + 10, MAP_HALF);
    return { x: Math.sin(a) * d, z: Math.cos(a) * d, spread: between(rand, 8, 24) };
  });
  const inGroves = between(rand, 0.3, 0.85);
  const out: ForestTree[] = [];
  for (let i = 0; i < total; i++) {
    let x: number;
    let z: number;
    if (rand() < inGroves) {
      const g = pick(rand, groves);
      // Roughly normal around the grove's middle (the sum of two uniforms), so it thins at its edge.
      x = g.x + (rand() + rand() - 1) * g.spread;
      z = g.z + (rand() + rand() - 1) * g.spread;
    } else {
      x = (rand() - 0.5) * MAP_HALF * 2;
      z = (rand() - 0.5) * MAP_HALF * 2;
    }
    if (Math.hypot(x, z) < clear || Math.abs(x) > MAP_HALF || Math.abs(z) > MAP_HALF) continue;
    out.push({ x, z, scale: 0.7 + rand() * 0.9 });
  }
  return out;
}
