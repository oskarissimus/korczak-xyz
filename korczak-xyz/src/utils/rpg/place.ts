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

export const DISTANCES = ['near', 'far'] as const;
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

export interface PlaceSpec {
  /** Shown in the journal and as a toast on arrival. */
  name: string;
  direction: Direction;
  distance: Distance;
  biome: Biome;
  features: Feature[];
  /** `#rrggbb`. The biome's own when the model gives none. */
  groundColor: string;
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

const DISTANCE_M: Record<Distance, number> = { near: 50, far: 85 };

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
