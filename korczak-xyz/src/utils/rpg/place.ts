/*
 * A quest's place, as a model describes it and the scene builds it.
 *
 * Since Oct 2026 the model invents where the quest happens rather than picking one of three fixed
 * places. It still cannot write geometry: it names the place and chooses from closed vocabularies
 * — a direction and a distance from the village, a biome, up to four features, a ground colour —
 * and `RpgScene` assembles that from primitives (`components/Rpg/placeBuilder.ts`). The same for
 * what lives or lies there: a shape from a short list, a colour, a size.
 *
 * So a new kind of place is a new word here, a builder for it, and a line in the prompt; nothing
 * a model writes reaches the scene without passing through `parsePlace` or `parseLook`.
 */

export const DIRECTIONS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DISTANCES = ['near', 'far', 'distant'] as const;
export type Distance = (typeof DISTANCES)[number];

export const BIOMES = ['forest', 'swamp', 'ruins', 'graveyard', 'meadow', 'lakeshore', 'rocky_hills'] as const;
export type Biome = (typeof BIOMES)[number];

export const FEATURES = [
  'pines',
  'dead_trees',
  'rocks',
  'pillars',
  'graves',
  'water',
  'campfire',
  'huts',
  'mushrooms',
  'standing_stones',
] as const;
export type Feature = (typeof FEATURES)[number];

export const ENEMY_SHAPES = ['humanoid', 'beast', 'blob'] as const;
export const ITEM_SHAPES = ['crystal', 'flower', 'chest', 'skull', 'scroll'] as const;
export type EnemyShape = (typeof ENEMY_SHAPES)[number];
export type ItemShape = (typeof ITEM_SHAPES)[number];

/*
 * THE LANDMARK: what makes a mill a mill (owner, Oct 2026: "we have a mill, but it is only a round
 * patch of the map with trees; if there is a mill, something that looks like a mill should be
 * built"). The model writes it as up to `MAX_PARTS` primitives — a box, a cylinder, a cone… — each
 * with a size, a position, a turn and a material from the world's palette, the way a child builds
 * a mill from blocks. Low-poly by design (the owner: "low-poly buildings are fine"); it is the
 * silhouette that tells a mill from a tower, and a model can write a silhouette.
 *
 * In metres, centred on the landmark's own spot, y up from the ground. Everything is clamped here,
 * so whatever the model writes stays a thing of house-to-tower size beside the place's middle.
 */
export const PART_SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'dome', 'pyramid', 'torus', 'wedge'] as const;
export type PartShape = (typeof PART_SHAPES)[number];

export const PART_MATERIALS = ['wall', 'roof', 'wood', 'stone', 'metal', 'glass', 'cloth', 'glow', 'water', 'plant', 'dark'] as const;
export type PartMaterial = (typeof PART_MATERIALS)[number];

export const MAX_PARTS = 36;
/** How far from the landmark's own centre a part may stand, and how high anything may reach. */
export const LANDMARK_REACH = 9;
export const LANDMARK_HEIGHT = 24;

export interface LandmarkPart {
  shape: PartShape;
  /** Width (x), height (y), depth (z), metres. A cylinder's or cone's diameter is the width. */
  size: [number, number, number];
  /**
   * The centre of the part's base, or of the part itself when it spins: x, y above the ground, z.
   * A model writes every part by its middle; `placeFromMiddles` turns that into this.
   */
  at: [number, number, number];
  /** Degrees about the vertical. */
  turn: number;
  /** Degrees of lean about x and z: a sail, a fallen column, a slanted roof. */
  tilt: [number, number];
  material: PartMaterial;
  /** `#rrggbb` over the material's own colour, or none. */
  color: string | null;
  /** Turns slowly about its own centre on this axis: sails, wheels, a beacon. */
  spin: 'x' | 'y' | 'z' | null;
}

export interface Landmark {
  /** What it is, in a few words: "the old water mill". */
  name: string;
  parts: LandmarkPart[];
}

export interface PlaceSpec {
  /** Shown in the journal and as a toast on arrival. */
  name: string;
  direction: Direction;
  distance: Distance;
  biome: Biome;
  features: Feature[];
  /** `#rrggbb`. The biome's own when the model gives none. */
  groundColor: string;
  /** The building or thing that makes the place what it is, when it has one. */
  landmark?: Landmark | null;
}

export interface TargetLook {
  shape: EnemyShape | ItemShape;
  /** `#rrggbb`. */
  color: string;
  /** 0.5–2, a multiplier on the shape's own size. */
  size: number;
}

/** What each biome looks like when the model names nothing else. */
export const BIOME_DEFAULTS: Record<Biome, { features: Feature[]; groundColor: string }> = {
  forest: { features: ['pines', 'rocks', 'mushrooms'], groundColor: '#3f5a2c' },
  swamp: { features: ['dead_trees', 'water', 'mushrooms'], groundColor: '#4a4f2a' },
  ruins: { features: ['pillars', 'rocks'], groundColor: '#6f6a55' },
  graveyard: { features: ['graves', 'dead_trees'], groundColor: '#4b4a3c' },
  meadow: { features: ['rocks', 'campfire'], groundColor: '#7c9a48' },
  lakeshore: { features: ['water', 'rocks'], groundColor: '#5d7a45' },
  rocky_hills: { features: ['rocks', 'standing_stones'], groundColor: '#77705f' },
};

const DISTANCE_M: Record<Distance, number> = { near: 50, far: 85, distant: 125 };

/** Where a place stands, in the scene's metres: north is −z, east is +x. */
export function placePosition(place: Pick<PlaceSpec, 'direction' | 'distance'>): { x: number; z: number } {
  const i = DIRECTIONS.indexOf(place.direction);
  const angle = (i / DIRECTIONS.length) * Math.PI * 2;
  const d = DISTANCE_M[place.distance];
  return { x: Math.round(Math.sin(angle) * d), z: Math.round(-Math.cos(angle) * d) };
}

function oneOf<T extends string>(value: unknown, list: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  // "North-West", "north west" and "northwest" are one direction; "Rocky Hills" is rocky_hills.
  const key = value.toLowerCase().replace(/[^a-z]/g, '');
  return list.find((item) => item.replace(/_/g, '') === key) ?? null;
}

function hex(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function triple(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function part(raw: unknown): LandmarkPart | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const shape = oneOf(r.shape, PART_SHAPES);
  if (!shape) return null;
  const size = triple(r.size);
  const at = triple(r.at);
  const tilt = triple(r.tilt);
  const w = num(size[0], 0.1, 2 * LANDMARK_REACH, 1);
  const h = num(size[1], 0.05, LANDMARK_HEIGHT, 1);
  const d = num(size[2] ?? size[0], 0.1, 2 * LANDMARK_REACH, w);
  const y = num(at[1], 0, LANDMARK_HEIGHT - 0.05, 0);
  const spin = typeof r.spin === 'string' && /^[xyz]$/i.test(r.spin.trim()) ? (r.spin.trim().toLowerCase() as 'x' | 'y' | 'z') : null;
  return {
    shape,
    size: [w, Math.min(h, LANDMARK_HEIGHT - y), d],
    at: [num(at[0], -LANDMARK_REACH, LANDMARK_REACH, 0), y, num(at[2], -LANDMARK_REACH, LANDMARK_REACH, 0)],
    turn: num(r.turn, -360, 360, 0),
    tilt: [num(tilt[0], -90, 90, 0), num(tilt[1], -90, 90, 0)],
    material: oneOf(r.material, PART_MATERIALS) ?? 'wall',
    color: hex(r.color),
    spin,
  };
}

/**
 * A model's place with its landmark's parts moved from their middles to their bases. The prompt
 * asks for middles (owner, Oct 2026, after a hut on stilts floated: the model had written
 * middles where the prompt asked for bases, and only a spinning part was a middle then, so it
 * had both conventions in one example); models place a block by its middle without being told,
 * as three.js does. What is stored, built and sent back stays a base, so a saved world needs no
 * migration and nothing but a model's own answer goes through this. A spinning part keeps its
 * middle, which is what it turns about. The base is the middle less half the height along the
 * part's own up, after its turn and lean (three.js's `YXZ` order, as `landmark.ts` builds it).
 */
export function placeFromMiddles(raw: unknown): unknown {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const landmark = r?.landmark && typeof r.landmark === 'object' ? (r.landmark as Record<string, unknown>) : null;
  if (!r || !landmark || !Array.isArray(landmark.parts)) return raw;
  const parts = landmark.parts.map((p) => {
    const part = p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
    if (!part || (typeof part.spin === 'string' && /^[xyz]$/i.test(part.spin.trim()))) return p;
    const at = triple(part.at).map(Number);
    const h = Number(triple(part.size)[1]);
    if (at.length < 3 || !at.every(Number.isFinite) || !Number.isFinite(h)) return p;
    const tilt = triple(part.tilt).map(Number);
    const tx = (Number.isFinite(tilt[0]) ? tilt[0] : 0) * (Math.PI / 180);
    const tz = (Number.isFinite(tilt[1]) ? tilt[1] : 0) * (Math.PI / 180);
    const ty = (Number.isFinite(Number(part.turn)) ? Number(part.turn) : 0) * (Math.PI / 180);
    // Up (0, 1, 0) turned by Rz, then Rx, then Ry.
    const ux0 = -Math.sin(tz);
    const uy = Math.cos(tz) * Math.cos(tx);
    const uz0 = Math.cos(tz) * Math.sin(tx);
    const ux = ux0 * Math.cos(ty) + uz0 * Math.sin(ty);
    const uz = -ux0 * Math.sin(ty) + uz0 * Math.cos(ty);
    const half = Math.max(0, h) / 2;
    return { ...part, at: [at[0] - ux * half, at[1] - uy * half, at[2] - uz * half] };
  });
  return { ...r, landmark: { ...landmark, parts } };
}

/*
 * A part that touches nothing falls until it does (owner, Oct 2026, a long house's burnt roof tilted
 * 20° in the air over its pillars: "it came out strange, and I thought we had solved this"). Middles
 * fixed the parts a model stacks straight; a leant part is beyond it, because where a tilted slab's
 * lowest edge ends up is trigonometry the model does not do. So the engine does it: each part is an
 * oriented box, and one whose box meets no other part's and stands off the ground is lowered until
 * it meets the first thing under it, or the ground. Bottom-up, so what holds a part settles first.
 *
 * Only what touches nothing moves: a banner on its pole, a chimney in its roof and a roof on its
 * walls all touch, and stay where the model put them. A spinning part keeps its place (sails need
 * not touch the mill), and so does a glowing one (a beacon's flame, a floating crystal).
 * Applied when a landmark is built, so places already in a saved world are settled too.
 */

type Vec = [number, number, number];

interface Box {
  c: Vec;
  /** Its own axes, in the landmark's coordinates. */
  u: [Vec, Vec, Vec];
  e: Vec;
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Ry · Rx · Rz, three.js's `YXZ`, as columns. */
function axes(p: LandmarkPart): [Vec, Vec, Vec] {
  const [a, b, c] = [p.turn * (Math.PI / 180), p.tilt[0] * (Math.PI / 180), p.tilt[1] * (Math.PI / 180)];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  const rx = (v: Vec): Vec => [v[0], cb * v[1] - sb * v[2], sb * v[1] + cb * v[2]];
  const ry = (v: Vec): Vec => [ca * v[0] + sa * v[2], v[1], -sa * v[0] + ca * v[2]];
  const r = (v: Vec): Vec => ry(rx([cc * v[0] - sc * v[1], sc * v[0] + cc * v[1], v[2]]));
  return [r([1, 0, 0]), r([0, 1, 0]), r([0, 0, 1])];
}

function box(p: LandmarkPart): Box {
  const u = axes(p);
  const e: Vec = [Math.max(0.01, p.size[0] / 2), Math.max(0.01, p.size[1] / 2), Math.max(0.01, p.size[2] / 2)];
  // `at` is the base: the middle is half the height up the part's own axis.
  const c: Vec = [p.at[0] + u[1][0] * e[1], p.at[1] + u[1][1] * e[1], p.at[2] + u[1][2] * e[1]];
  return { c, u, e };
}

function lowest(b: Box): number {
  return b.c[1] - b.e[0] * Math.abs(b.u[0][1]) - b.e[1] * Math.abs(b.u[1][1]) - b.e[2] * Math.abs(b.u[2][1]);
}

/** Whether two boxes meet, within `eps` (separating axes, Ericson's *Real-Time Collision Detection*). */
function meets(a: Box, b: Box, eps: number): boolean {
  const R: number[][] = [];
  const A: number[][] = [];
  for (let i = 0; i < 3; i++) {
    R.push([]);
    A.push([]);
    for (let j = 0; j < 3; j++) {
      R[i][j] = dot(a.u[i], b.u[j]);
      A[i][j] = Math.abs(R[i][j]) + 1e-6;
    }
  }
  const d: Vec = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]];
  const t: Vec = [dot(d, a.u[0]), dot(d, a.u[1]), dot(d, a.u[2])];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(t[i]) > a.e[i] + b.e[0] * A[i][0] + b.e[1] * A[i][1] + b.e[2] * A[i][2] + eps) return false;
  }
  for (let j = 0; j < 3; j++) {
    const ra = a.e[0] * A[0][j] + a.e[1] * A[1][j] + a.e[2] * A[2][j];
    if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > ra + b.e[j] + eps) return false;
  }
  for (let i = 0; i < 3; i++) {
    const [i1, i2] = [(i + 1) % 3, (i + 2) % 3];
    for (let j = 0; j < 3; j++) {
      const [j1, j2] = [(j + 1) % 3, (j + 2) % 3];
      const ra = a.e[i1] * A[i2][j] + a.e[i2] * A[i1][j];
      const rb = b.e[j1] * A[i][j2] + b.e[j2] * A[i][j1];
      if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb + eps) return false;
    }
  }
  return true;
}

const TOUCH = 0.03;
const STEP = 0.05;

export function settleParts(parts: readonly LandmarkPart[]): LandmarkPart[] {
  const out = parts.map((p) => ({ ...p, at: [...p.at] as Vec }));
  const boxes = out.map(box);
  const solid = out.map((p) => p.spin === null);
  const order = out
    .map((p, i) => i)
    .filter((i) => out[i].spin === null && out[i].material !== 'glow')
    .sort((a, b) => lowest(boxes[a]) - lowest(boxes[b]));
  const touching = (i: number, b: Box) => boxes.some((other, j) => j !== i && solid[j] && meets(b, other, TOUCH));
  for (const i of order) {
    const floor = lowest(boxes[i]);
    if (floor <= TOUCH || touching(i, boxes[i])) continue;
    // Down a step at a time to the first thing it meets; the ground if nothing.
    let drop = floor;
    for (let d = STEP; d < floor; d += STEP) {
      const b = boxes[i];
      if (touching(i, { ...b, c: [b.c[0], b.c[1] - d, b.c[2]] })) {
        drop = d;
        break;
      }
    }
    out[i].at[1] -= drop;
    boxes[i] = box(out[i]);
  }
  return out;
}

/** A model's landmark, or null when it has no usable part. */
export function parseLandmark(raw: unknown): Landmark | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const parts = Array.isArray(r.parts)
    ? r.parts.slice(0, MAX_PARTS).map(part).filter((p): p is LandmarkPart => p !== null)
    : [];
  if (parts.length === 0) return null;
  return { name: typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '', parts };
}

/**
 * A model's place, or null when the scene could not build it. Name, direction and biome are
 * required; the rest falls back to the biome's own.
 */
export function parsePlace(raw: unknown): PlaceSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '';
  const direction = oneOf(r.direction, DIRECTIONS);
  const biome = oneOf(r.biome, BIOMES);
  if (!name || !direction || !biome) return null;
  const features = Array.isArray(r.features)
    ? [...new Set(r.features.map((f) => oneOf(f, FEATURES)).filter((f): f is Feature => f !== null))].slice(0, 4)
    : [];
  return {
    name,
    direction,
    distance: oneOf(r.distance, DISTANCES) ?? 'far',
    biome,
    features: features.length ? features : BIOME_DEFAULTS[biome].features,
    groundColor: hex(r.groundColor) ?? BIOME_DEFAULTS[biome].groundColor,
    landmark: parseLandmark(r.landmark),
  };
}

/** A model's look for the quest's targets; a shape that does not fit the objective gets the default. */
export function parseLook(raw: unknown, kind: 'collect' | 'slay'): TargetLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const shapes = kind === 'slay' ? ENEMY_SHAPES : ITEM_SHAPES;
  const size = Number(r.size);
  const shape = (oneOf(r.shape, shapes as readonly string[]) ?? shapes[0]) as TargetLook['shape'];
  return {
    shape,
    color: hex(r.color) ?? (kind === 'slay' ? '#3f5a4a' : '#9be36b'),
    size: Number.isFinite(size) ? Math.min(2, Math.max(0.5, size)) : 1,
  };
}

/** How far apart two places' centres must be for their builds not to overlap. */
export const PLACE_SPACING = 50;

/**
 * The place itself, or the same place moved to the nearest slot (by direction, near before far)
 * that keeps clear of the places already standing. A quest now has several places at once, and a
 * model asked for a new one will happily put it on top of the last.
 */
export function freeSlot(spec: PlaceSpec, taken: readonly PlaceSpec[]): PlaceSpec {
  const clear = (p: Pick<PlaceSpec, 'direction' | 'distance'>) => {
    const a = placePosition(p);
    return taken.every((t) => {
      const b = placePosition(t);
      return Math.hypot(a.x - b.x, a.z - b.z) >= PLACE_SPACING;
    });
  };
  if (clear(spec)) return spec;
  const start = DIRECTIONS.indexOf(spec.direction);
  for (let step = 1; step <= DIRECTIONS.length / 2; step++) {
    for (const turn of [step, -step]) {
      const direction = DIRECTIONS[(start + turn + DIRECTIONS.length) % DIRECTIONS.length];
      // The asked-for ring first, then the rings by how close they are to it.
      const rings = [...DISTANCES].sort((a, b) => Math.abs(DISTANCE_M[a] - DISTANCE_M[spec.distance]) - Math.abs(DISTANCE_M[b] - DISTANCE_M[spec.distance]));
      for (const distance of rings) {
        if (clear({ direction, distance })) return { ...spec, direction, distance };
      }
    }
  }
  for (const distance of DISTANCES) if (clear({ direction: spec.direction, distance })) return { ...spec, distance };
  return spec;
}
