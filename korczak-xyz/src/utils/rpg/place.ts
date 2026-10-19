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
  /** The centre of the part's base, or of the part itself when it spins: x, y above the ground, z. */
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
