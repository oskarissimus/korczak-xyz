/*
 * The lie of the land (owner, 31 Oct 2026: "let's make some generated terrain"): hills, valleys and
 * a ridge round the edge of the map in place of the flat board every world stood on.
 *
 * Drawn from the world's id, like its village (`hubLayout.ts`), so a world has the same hills on
 * every load and every device and nothing is asked of a model or stored. How tall they grow is the
 * world's `relief` (`WorldLook.relief`, from genesis); a world kept before there was one gets a
 * relief from its id too.
 *
 * **Everything the game builds stands at height 0, so 0 is kept wherever it builds** (`Clearing`):
 * the village, every place that stands and the road to each. The hills rise everywhere else, and a
 * road cuts through them as a level way between banks. The land is worked out again when a place
 * is added or taken down (`RpgScene.refreshTerrain`), and only ever comes down to 0 under the new
 * one, so nothing already standing on 0 moves. The land never goes below 0: a place's ground disc,
 * its frayed edge and its road lie at 0, and a hill rising over the edge of a disc hides it, where
 * a dip under it would have left it hanging in the air.
 *
 * `heightAt` is the height of the drawn mesh, not of the noise: the heights are worked out on the
 * mesh's grid once, and between grid points it interpolates on the same two triangles a
 * `THREE.PlaneGeometry` cell is split into, so whoever stands on it stands on what is drawn.
 *
 * Plain numbers, no Three.js, so it can be tested.
 */

import type { Ground } from './trail';

export const RELIEFS = ['flat', 'rolling', 'hilly', 'rugged'] as const;
export type Relief = (typeof RELIEFS)[number];

/** The tallest the hills between the places grow, and the ridge at the map's edge, in metres. */
export const RELIEF_HEIGHT: Record<Relief, { hills: number; rim: number }> = {
  flat: { hills: 1.2, rim: 4 },
  rolling: { hills: 6, rim: 12 },
  hilly: { hills: 12, rim: 20 },
  rugged: { hills: 20, rim: 30 },
};

/** Kept flat round the village: its widest layout is 34 m with its pieces (`hubLayout.ts`). */
export const VILLAGE_FLAT = 40;
/** Kept flat round a place: `PLACE_RADIUS` (24 m, everything a place builds) and a step. */
export const PLACE_FLAT = 26;
/** Kept flat either side of a road's middle: its 3 m ribbon and a shoulder. */
export const ROAD_FLAT = 3;
/** Over how many metres past the flat the land comes up to its full height. */
export const RISE = 14;
/**
 * The noise is let in only this far past a flat, so that the grid's cells, whose corners are up to
 * a diagonal (2.8 m) apart, are level right to the flat's edge once drawn.
 */
const GRID_MARGIN = 3;
/** The ridge starts this far from the middle (on the square's edge, not the circle's) and tops at the map's edge. */
const RIM_FROM = 138;
const RIM_TO = 178;

/** Where the game builds, kept at 0: round spots (the village, each place) and the roads' middle lines. */
export interface Clearing {
  spots: { x: number; z: number; r: number }[];
  roads: Ground[][];
}

/** The village alone, before any place stands. */
export const VILLAGE_ONLY: Clearing = { spots: [{ x: 0, z: 0, r: VILLAGE_FLAT }], roads: [] };

/** The same hash as `placeBuilder.hashString`, here so this file needs no Three.js. */
export function terrainSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return Math.abs(h) || 1;
}

/** A world kept before genesis gave a relief: rolling or hilly, by its id. */
export function reliefFor(id: string, relief: Relief | undefined): Relief {
  if (relief && RELIEFS.includes(relief)) return relief;
  return terrainSeed(`relief:${id}`) % 3 === 0 ? 'hilly' : 'rolling';
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Value noise on a unit lattice, seeded: a hash per corner, eased between them. -1..1. */
function lattice(seed: number) {
  const corner = (ix: number, iz: number) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
  };
  return (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = corner(ix, iz);
    const b = corner(ix + 1, iz);
    const c = corner(ix, iz + 1);
    const d = corner(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}

/** Distance from (x, z) to the segment a–b. */
function toSegment(x: number, z: number, a: Ground, b: Ground): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = dx * dx + dz * dz;
  const t = len > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

/**
 * How much of the land's own height shows at each point: 0 on anything the game builds on, 1 clear
 * of it all. Each road is skipped where its box is too far off to matter, the grid being 32k points.
 */
export function openness(clearing: Clearing): (x: number, z: number) => number {
  const reach = ROAD_FLAT + GRID_MARGIN + RISE;
  const roads = clearing.roads
    .filter((r) => r.length > 1)
    .map((line) => ({
      line,
      minX: Math.min(...line.map((p) => p.x)) - reach,
      maxX: Math.max(...line.map((p) => p.x)) + reach,
      minZ: Math.min(...line.map((p) => p.z)) - reach,
      maxZ: Math.max(...line.map((p) => p.z)) + reach,
    }));
  return (x, z) => {
    let open = 1;
    for (const s of clearing.spots) {
      const d = Math.hypot(x - s.x, z - s.z);
      const r = s.r + GRID_MARGIN;
      if (d < r + RISE) open = Math.min(open, smooth(r, r + RISE, d));
      if (open === 0) return 0;
    }
    for (const road of roads) {
      if (x < road.minX || x > road.maxX || z < road.minZ || z > road.maxZ) continue;
      let d = Infinity;
      for (let i = 1; i < road.line.length; i++) d = Math.min(d, toSegment(x, z, road.line[i - 1], road.line[i]));
      const r = ROAD_FLAT + GRID_MARGIN;
      if (d < r + RISE) open = Math.min(open, smooth(r, r + RISE, d));
      if (open === 0) return 0;
    }
    return open;
  };
}

/** The land's height before it is laid on the grid: hills, the rim, and 0 where the game builds. */
export function heightField(seed: number, relief: Relief | 'none', clearing: Clearing = VILLAGE_ONLY): (x: number, z: number) => number {
  if (relief === 'none') return () => 0;
  const openAt = openness(clearing);
  const { hills, rim } = RELIEF_HEIGHT[relief];
  const n1 = lattice(seed);
  const n2 = lattice(seed + 1);
  const n3 = lattice(seed + 2);
  const n4 = lattice(seed + 3);
  return (x, z) => {
    const open = openAt(x, z);
    if (open === 0) return 0;
    // Hills ~70 m across, their shoulders ~30 m, and a roughness of a few metres over them.
    const n = 0.6 * n1(x / 70, z / 70) + 0.27 * n2(x / 31, z / 31) + 0.13 * n3(x / 13, z / 13);
    // Lowland where the noise is low, so between the hills there is level ground and not a dip.
    const hill = smooth(-0.45, 0.6, n);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const ridge = smooth(RIM_FROM, RIM_TO, edge) * (0.65 + 0.35 * n4(x / 40, z / 40));
    return open * (hills * hill + rim * ridge);
  };
}

export interface TerrainInfo {
  seed: number;
  /** `none` is no land at all: before any world, and under a flood. */
  relief: Relief | 'none';
  /** The highest point of the land, metres. */
  max: number;
  /** How much of the land is not flat, 0–1. */
  hilly: number;
  /** How long it took to work out, ms. */
  ms: number;
}

/**
 * The land, laid on a grid `step` metres apart over a square `half` metres from the middle each
 * way: vertex (ix, iz) is at x = ix·step − half, z = iz·step − half, which is the order a
 * `THREE.PlaneGeometry(2·half, 2·half, n, n)` turned flat by `rotateX(−π/2)` has them in.
 */
export class Terrain {
  readonly half: number;
  readonly step: number;
  /** Cells along a side. */
  readonly n: number;
  readonly heights: Float32Array;
  readonly info: TerrainInfo;

  constructor(seed: number, relief: Relief | 'none', clearing: Clearing = VILLAGE_ONLY, half = 180, step = 2) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.half = half;
    this.step = step;
    this.n = Math.round((half * 2) / step);
    const row = this.n + 1;
    this.heights = new Float32Array(row * row);
    let max = 0;
    let raised = 0;
    const field = heightField(seed, relief, clearing);
    for (let iz = 0; iz <= this.n; iz++) {
      for (let ix = 0; ix <= this.n; ix++) {
        const h = field(ix * step - half, iz * step - half);
        this.heights[iz * row + ix] = h;
        if (h > max) max = h;
        if (h > 0.05) raised++;
      }
    }
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    this.info = { seed, relief, max, hilly: raised / this.heights.length, ms };
  }

  /** Flat everywhere: before any world, and under a flood. */
  static flat(): Terrain {
    return new Terrain(0, 'none', VILLAGE_ONLY, 180, 180);
  }

  /** The height of the drawn ground at (x, z); outside the grid, its edge's. */
  heightAt(x: number, z: number): number {
    if (this.info.max === 0) return 0;
    const n = this.n;
    const gx = Math.min(n, Math.max(0, (x + this.half) / this.step));
    const gz = Math.min(n, Math.max(0, (z + this.half) / this.step));
    const ix = Math.min(n - 1, Math.floor(gx));
    const iz = Math.min(n - 1, Math.floor(gz));
    const fx = gx - ix;
    const fz = gz - iz;
    const row = n + 1;
    const h00 = this.heights[iz * row + ix];
    const h10 = this.heights[iz * row + ix + 1];
    const h01 = this.heights[(iz + 1) * row + ix];
    const h11 = this.heights[(iz + 1) * row + ix + 1];
    // A PlaneGeometry cell is two triangles split along (ix, iz+1)–(ix+1, iz).
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** How steep the ground is at (x, z): rise over run, 0 on the level. */
  slopeAt(x: number, z: number): number {
    const e = this.step / 2;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }
}
