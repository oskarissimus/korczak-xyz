/*
 * Builds a place's landmark (`utils/rpg/place.ts`, `Landmark`) from the parts a model wrote: each
 * part a primitive scaled to its size, standing on its base, turned and leant, in a material of
 * the world's palette. Low-poly on purpose — the silhouette is what says "mill".
 *
 * The materials come from the world (`WorldLook`): "wall" is the world's wall colour on its wall
 * surface, "roof" its roof, "plant" its foliage, "glow" its accent, lit from inside. A part's own
 * colour wins over the material's. So the same mill is whitewashed in one world and black glass in
 * another, without the model knowing anything about textures.
 */

import * as THREE from 'three';

import { CLASSIC_LOOK, type WorldLook } from '../../utils/rpg/genesis';
import { settleParts, type Landmark, type LandmarkPart, type PartMaterial, type PartShape } from '../../utils/rpg/place';
import { recolor } from './atmosphere';
import type { Obstacle } from './placeBuilder';
import { surfaceMat, type Surface } from './surfaces';

/** A part that turns: the object to rotate and its axis. */
export interface Spinner {
  object: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  speed: number;
}

export interface BuiltLandmark {
  group: THREE.Group;
  obstacles: Obstacle[];
  spinners: Spinner[];
  /** The circle on the ground it stands in, in its own coordinates: nothing else is put there. */
  footprint: { x: number; z: number; r: number };
}

/** Unit shapes, base on y = 0, one metre each way, so a part is its shape scaled by its size. */
function unitGeometry(shape: PartShape): THREE.BufferGeometry {
  switch (shape) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 18).translate(0, 0.5, 0);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 18).translate(0, 0.5, 0);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 18, 12).translate(0, 0.5, 0);
    case 'dome':
      return new THREE.SphereGeometry(0.5, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1);
    case 'pyramid':
      return new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    case 'torus':
      // Standing up like a wheel, in the x–y plane; depth is the rim's thickness.
      return new THREE.TorusGeometry(0.4, 0.1, 8, 28).scale(1, 1, 5).translate(0, 0.5, 0);
    case 'wedge': {
      // A gable: a triangle across x, rising to a ridge that runs along z.
      const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
      return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
    }
  }
}

const WALL_SURFACE: Record<WorldLook['wallSurface'], Surface> = { plaster: 'plaster', stone: 'stone', planks: 'planks', rock: 'rock' };
const ROOF_SURFACE: Record<WorldLook['roofSurface'], Surface> = { thatch: 'thatch', planks: 'planks', stone: 'stone', leaves: 'leaves' };

/** One material per kind, colour and tiling within a landmark; the place disposes them with it. */
class Palette {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(private look: WorldLook) {}

  get(kind: PartMaterial, color: string | null, tiles: [number, number]): THREE.MeshStandardMaterial {
    const key = `${kind}|${color}|${tiles.join('x')}`;
    let m = this.cache.get(key);
    if (!m) {
      m = this.make(kind, color, tiles);
      this.cache.set(key, m);
    }
    return m;
  }

  private textured(surface: Surface, tint: string, tiles: [number, number], amount = 0.75, gain = 2) {
    const m = surfaceMat(surface, tiles[0], tiles[1], { roughness: 0.95 });
    recolor(m, tint, amount, gain);
    return m;
  }

  private make(kind: PartMaterial, color: string | null, tiles: [number, number]): THREE.MeshStandardMaterial {
    const look = this.look;
    switch (kind) {
      case 'wall':
        return this.textured(WALL_SURFACE[look.wallSurface], color ?? look.wall, tiles, 0.6);
      case 'roof':
        return this.textured(ROOF_SURFACE[look.roofSurface], color ?? look.roof, tiles);
      case 'wood':
        return this.textured('planks', color ?? '#8a6a48', tiles, color ? 0.7 : 0);
      case 'stone':
        return this.textured('stone', color ?? '#9a948a', tiles, color ? 0.7 : 0);
      case 'plant':
        return this.textured('leaves', color ?? look.foliage, tiles, 0.8, 3.2);
      case 'metal':
        return new THREE.MeshStandardMaterial({ color: color ?? '#8a8f96', metalness: 0.3, roughness: 0.45 });
      case 'glass':
        return new THREE.MeshStandardMaterial({ color: color ?? '#a8d8ff', roughness: 0.1, transparent: true, opacity: 0.45 });
      case 'water':
        return new THREE.MeshStandardMaterial({ color: color ?? '#3f6f8f', roughness: 0.15, transparent: true, opacity: 0.8 });
      case 'cloth':
        return new THREE.MeshStandardMaterial({ color: color ?? look.accent, roughness: 1, side: THREE.DoubleSide });
      case 'glow': {
        const c = color ?? look.accent;
        return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2, roughness: 0.6 });
      }
      case 'dark':
        return new THREE.MeshStandardMaterial({ color: color ?? '#2a2622', roughness: 0.9 });
    }
  }
}

const DEG = Math.PI / 180;

/** The circles a ground-level part blocks walking with, in the landmark's own coordinates. */
function blockers(p: LandmarkPart): Obstacle[] {
  const [w, h, d] = p.size;
  // Above head height, or flat on the ground (a pond, a floor), nobody walks into it.
  if (p.spin || p.at[1] > 1.8 || h < 0.4 || p.material === 'water') return [];
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const r = short / 2 + 0.3;
  const turn = p.turn * DEG;
  // Along the long side, circles of the short side's radius: a wall is a row of them, not one disc.
  const alongX = w >= d;
  const n = Math.max(1, Math.round(long / short));
  const out: Obstacle[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - short);
    const lx = alongX ? t : 0;
    const lz = alongX ? 0 : t;
    out.push({
      x: p.at[0] + lx * Math.cos(turn) + lz * Math.sin(turn),
      z: p.at[2] - lx * Math.sin(turn) + lz * Math.cos(turn),
      r: n === 1 && (p.shape === 'box' || p.shape === 'pyramid') ? (long / 2) * 1.05 + 0.2 : r,
    });
  }
  return out;
}

export function buildLandmark(landmark: Landmark, look: WorldLook = CLASSIC_LOOK): BuiltLandmark {
  const group = new THREE.Group();
  group.name = landmark.name;
  const palette = new Palette(look);
  const geometries = new Map<PartShape, THREE.BufferGeometry>();
  const obstacles: Obstacle[] = [];
  const spinners: Spinner[] = [];
  let footprint = 2;

  // Nothing the model left hanging in the air stays there (`settleParts`).
  for (const p of settleParts(landmark.parts)) {
    let geometry = geometries.get(p.shape);
    if (!geometry) {
      geometry = unitGeometry(p.shape);
      geometries.set(p.shape, geometry);
    }
    const [w, h, d] = p.size;
    const tiles: [number, number] = [Math.max(1, Math.round(Math.max(w, d) / 2.5)), Math.max(1, Math.round(h / 2.5))];
    const mesh = new THREE.Mesh(geometry, palette.get(p.material, p.color, tiles));
    mesh.scale.set(w, h, d);
    mesh.castShadow = p.material !== 'glass' && p.material !== 'water';
    mesh.receiveShadow = true;

    const holder = new THREE.Group();
    holder.position.set(p.at[0], p.at[1], p.at[2]);
    holder.rotation.set(p.tilt[0] * DEG, p.turn * DEG, p.tilt[1] * DEG, 'YXZ');
    if (p.spin) {
      // `at` is a spinning part's middle (the prompt says so), so parts that share it turn as one.
      const hub = new THREE.Group();
      mesh.position.y = -h / 2;
      hub.add(mesh);
      holder.add(hub);
      spinners.push({ object: hub, axis: p.spin, speed: p.spin === 'y' ? 0.6 : 0.45 });
    } else {
      holder.add(mesh);
    }
    group.add(holder);

    obstacles.push(...blockers(p));
    if (p.at[1] < 1.8) footprint = Math.max(footprint, Math.hypot(p.at[0], p.at[2]) + Math.max(w, d) / 2);
  }
  // Each geometry is shared by the parts of its shape; the place's teardown disposes it once per
  // mesh, which three.js tolerates.
  return { group, obstacles, spinners, footprint: { x: 0, z: 0, r: Math.min(12, footprint + 1) } };
}
