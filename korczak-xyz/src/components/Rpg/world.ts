/*
 * The world's furniture: Quaternius's Medieval Village, Stylized Nature and Fantasy Props kits
 * (CC0), cut down by `scripts/rpg-world.mjs` into three files whose top-level nodes are the
 * pieces, by their source names. Houses are built here out of the village kit's walls, corner
 * posts, gables and roofs, the way the kit is meant to be used; trees, bushes, rocks and props
 * are the pieces as they come.
 *
 * Like the people, none of it is waited for: the scene stands up out of primitives first and
 * swaps these in when `ready` resolves, and keeps the primitives if it never does.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import natureUrl from '../../assets/rpg/nature.glb?url';
import propsUrl from '../../assets/rpg/props.glb?url';
import villageUrl from '../../assets/rpg/village.glb?url';

export const TREES = ['Pine_1', 'Pine_2', 'Pine_3', 'CommonTree_1', 'CommonTree_2', 'CommonTree_3'] as const;
export const DEAD_TREES = ['DeadTree_1', 'DeadTree_2', 'DeadTree_3'] as const;
export const ROCKS = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'] as const;
export const GROUND_COVER = ['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Tall', 'Fern_1', 'Bush_Common', 'Bush_Common_Flowers', 'Flower_3_Group'] as const;

/** Wall modules are 2 m wide and 3.12 m high; a house's footprint is whole modules. */
const MODULE = 2;
const WALL_H = 3.12;

export type HouseKind = 'small' | 'large';

/** How far a house's walls reach from its middle, for the obstacle that stands in for it. */
export const HOUSE_RADIUS: Record<HouseKind, number> = { small: 3.4, large: 4.8 };

export class WorldKit {
  private pieces = new Map<string, THREE.Object3D>();
  readonly ready: Promise<void>;
  loaded = false;

  constructor() {
    const loader = new GLTFLoader();
    this.ready = Promise.all([villageUrl, natureUrl, propsUrl].map((url) => loader.loadAsync(url))).then((kits) => {
      for (const kit of kits) {
        for (const piece of [...kit.scene.children]) {
          piece.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              // Every copy shares this mesh's geometry and material: nobody disposes them.
              o.userData.shared = true;
              o.castShadow = true;
              o.receiveShadow = true;
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
              // As with the outfits: nothing to reflect, so metal would be black.
              m.metalness = Math.min(m.metalness, 0.3);
            }
          });
          this.pieces.set(piece.name, piece);
        }
      }
      this.loaded = true;
    });
  }

  /** One of the kits' materials by name (`Leaves_Pine`, `MI_Plaster`), for a world to recolour. */
  material(name: string): THREE.Material | null {
    if (!this.materials) {
      this.materials = new Map();
      for (const piece of this.pieces.values()) {
        piece.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.materials!.set(m.name, m);
        });
      }
    }
    return this.materials.get(name) ?? null;
  }

  private materials: Map<string, THREE.Material> | null = null;

  has(name: string): boolean {
    return this.pieces.has(name);
  }

  /** A copy of a piece; meshes, geometry and materials are shared with every other copy. */
  piece(name: string): THREE.Object3D {
    const p = this.pieces.get(name);
    if (!p) throw new Error(`no piece ${name}`);
    return p.clone();
  }

  /** The meshes of a piece with their transforms relative to it, for instancing. */
  parts(name: string): { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] {
    const p = this.pieces.get(name);
    if (!p) return [];
    p.updateMatrixWorld(true);
    const inv = p.matrixWorld.clone().invert();
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] = [];
    p.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) out.push({ geometry: mesh.geometry, material: mesh.material as THREE.Material, matrix: inv.clone().multiply(mesh.matrixWorld) });
    });
    return out;
  }

  /**
   * A timber-framed house, its door on +z, standing on y = 0 and centred on the origin: a small
   * one is 4 × 6 m under the 4×6 tiled roof, a large one 6 × 8 m under the 6×8.
   */
  house(kind: HouseKind, rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const [w, d] = kind === 'small' ? [2, 3] : [3, 4]; // modules across (x) and deep (z)
    const hw = (w * MODULE) / 2;
    const hd = (d * MODULE) / 2;
    const brick = rand() < 0.4;
    const plain = brick ? 'Wall_UnevenBrick_Straight' : rand() < 0.5 ? 'Wall_Plaster_Straight' : 'Wall_Plaster_WoodGrid';
    const window = brick ? 'Wall_UnevenBrick_Window_Wide_Flat' : 'Wall_Plaster_Window_Wide_Flat';

    const wall = (name: string, x: number, z: number, rot: number) => {
      const p = this.piece(name);
      p.position.set(x, 0, z);
      p.rotation.y = rot;
      g.add(p);
      return p;
    };
    // A wall module's outside is its +z face; each side is turned to face outward.
    const doorAt = Math.floor(w / 2);
    for (let i = 0; i < w; i++) {
      const x = -hw + MODULE / 2 + i * MODULE;
      if (i === doorAt) {
        wall('Wall_Plaster_Door_Flat', x, hd, 0);
        const door = this.piece('Door_1_Flat');
        door.position.set(x - 0.53, 0, hd - 0.02);
        g.add(door);
      } else {
        wall(window, x, hd, 0);
        this.windowAt(g, x, hd, 0);
      }
      wall(i % 2 ? window : plain, -x, -hd, Math.PI);
      if (i % 2) this.windowAt(g, -x, -hd, Math.PI);
    }
    for (let i = 0; i < d; i++) {
      const z = -hd + MODULE / 2 + i * MODULE;
      const lit = i % 2 === 1;
      wall(lit ? window : plain, hw, z, Math.PI / 2);
      if (lit) this.windowAt(g, hw, z, Math.PI / 2);
      wall(lit ? plain : window, -hw, -z, -Math.PI / 2);
      if (!lit) this.windowAt(g, -hw, -z, -Math.PI / 2);
    }
    for (const [x, z] of [
      [hw, hd],
      [-hw, hd],
      [hw, -hd],
      [-hw, -hd],
    ]) {
      const post = this.piece(brick ? 'Corner_Exterior_Brick' : 'Corner_Exterior_Wood');
      post.position.set(x, 0, z);
      post.rotation.y = Math.atan2(x, z) - Math.PI / 4;
      g.add(post);
    }
    const gable = kind === 'small' ? 'Roof_Front_Brick4' : 'Roof_Front_Brick6';
    wall(gable, 0, hd, 0).position.y = WALL_H;
    wall(gable, 0, -hd, Math.PI).position.y = WALL_H;
    const roof = this.piece(kind === 'small' ? 'Roof_RoundTiles_4x6' : 'Roof_RoundTiles_6x8');
    roof.position.y = WALL_H;
    g.add(roof);
    if (rand() < 0.6) {
      const chimney = this.piece('Prop_Chimney');
      chimney.position.set(hw * 0.45, WALL_H + (kind === 'small' ? 0.9 : 1.2), -hd * 0.4);
      g.add(chimney);
    }
    return g;
  }

  private windowAt(g: THREE.Group, x: number, z: number, rot: number) {
    const glass = this.piece('Window_Wide_Flat1');
    glass.position.set(x, 0, z);
    glass.rotation.y = rot;
    g.add(glass);
  }
}
