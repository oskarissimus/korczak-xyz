/*
 * The hub's models, from the GLBs fal.ai made for the world (`utils/rpg/landmark3d.ts`), each sized
 * to the place it takes in the village (`HUB_FIT`). TRELLIS answers in a unit box, centred on the
 * origin, Y up and the picture's front toward +Z, so a model is scaled to its height (or narrower,
 * to its width, for a wide one), stood on the ground and left facing +Z; the scene turns +Z toward
 * the square, which is where its door was drawn.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { HubSize, HubSizes } from '../../utils/rpg/genesis';
import { loadLandmarkBytes, type HubSlot } from '../../utils/rpg/landmark3d';

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
 * building, and stood that truck 6 m tall (owner, 26 Oct 2026).
 */
export function hubFit(slot: HubSlot, sizes: HubSizes | undefined): { height: number; width: number } {
  // The forest's other trees have no size of their own: they are planted at the tree's (`setForest`).
  return (sizes as Partial<Record<HubSlot, HubSize>> | undefined)?.[slot] ?? HUB_FIT[slot];
}

export interface HubModel {
  /** Stood on the origin and sized; clone it for each spot, the clones sharing its geometry. */
  group: THREE.Group;
  /** The circle it blocks walking in. */
  radius: number;
}

export async function loadHubModel(url: string, fit: { height: number; width: number }): Promise<HubModel> {
  const bytes = await loadLandmarkBytes(url);
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(fit.height / Math.max(size.y, 1e-3), fit.width / Math.max(size.x, size.z, 1e-3));
  const centre = box.getCenter(new THREE.Vector3());
  model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  model.scale.setScalar(scale);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // TRELLIS writes no metallic factor, which glTF reads as fully metallic, and with no environment
    // map a fully metallic surface renders black. Its texture is the picture's colour and nothing
    // else, so the model is not metal at all.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (typeof std.metalness === 'number') std.metalness = std.metalnessMap ? Math.min(std.metalness, 0.3) : 0;
    }
  });
  const group = new THREE.Group();
  group.add(model);
  return { group, radius: (Math.max(size.x, size.z) * scale) / 2 + 0.3 };
}

export function disposeHubModel(group: THREE.Object3D): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

// --- the forest -------------------------------------------------------------------------------------

/**
 * A forest tree at scale 1, which the scene scales by 0.7–1.6 per tree as it did the kit's: the kit's
 * pines and broadleaf trees are ~7.4 m tall and 4–6.5 m across, so this one is too, unless the world
 * says how big its tree is (`WorldBible.sizes.tree`).
 */
export const FOREST_FIT: HubSize = { height: 7.4, width: 6.5 };

/**
 * Triangles a forest tree is simplified to. TRELLIS answers 7–15k at the most it simplifies, which is
 * right for five trees in the village and wrong for four hundred: ~60 stand in view, and each is drawn
 * again for the shadow. The kit's trees were 3.5–6.5k; 2,500 is fewer, and at a tree's distance the
 * difference is a few twigs (meshoptimizer: 25–200 ms a tree, once a session).
 */
const FOREST_TRIANGLES = 2500;

/** One instanced part of a forest tree: what `RpgScene.plantTrees` takes from the kit's trees too. */
export interface TreePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

/**
 * The world's tree as parts to instance: its meshes, each simplified to its share of
 * `FOREST_TRIANGLES`, stood on the origin and sized to `fit`. Owns its geometry and materials;
 * `disposeTreeParts` frees them.
 */
export async function loadForestTree(url: string, fit: HubSize = FOREST_FIT): Promise<TreePart[]> {
  const [bytes, { MeshoptSimplifier }] = await Promise.all([loadLandmarkBytes(url), import('meshoptimizer/simplifier')]);
  await MeshoptSimplifier.ready;
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(fit.height / Math.max(size.y, 1e-3), fit.width / Math.max(size.x, size.z, 1e-3));
  const centre = box.getCenter(new THREE.Vector3());
  const stand = new THREE.Matrix4().makeTranslation(-centre.x * scale, -box.min.y * scale, -centre.z * scale).multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const total = meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
  return meshes.map((mesh) => {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
    const share = Math.floor((index.length / 3 / total) * FOREST_TRIANGLES);
    const uv = geometry.attributes.uv;
    if (
      index.length / 3 > share &&
      position instanceof THREE.BufferAttribute &&
      position.array instanceof Float32Array &&
      uv instanceof THREE.BufferAttribute &&
      uv.array instanceof Float32Array
    ) {
      // TRELLIS cuts its texture into hundreds of small islands, and a simplifier that keeps every
      // island's edge stops a leafy crown at 9–16k triangles. `Permissive` lets it collapse across
      // them, weighing how far the texture would slide; at a tree's distance that is not seen.
      const [kept] = MeshoptSimplifier.simplifyWithAttributes(index, position.array, 3, uv.array, 2, [1, 1], null, share * 3, 0.05, ['Permissive']);
      if (kept.length >= 3) geometry.setIndex(new THREE.BufferAttribute(kept, 1));
    }
    const material = mesh.material as THREE.MeshStandardMaterial;
    // As in the hub: TRELLIS writes no metallic factor, and full metal renders black here.
    if (typeof material.metalness === 'number') material.metalness = 0;
    // TRELLIS writes no normals either, and flat shading is the low-poly look the hub's trees have too.
    if (!geometry.attributes.normal) material.flatShading = true;
    material.needsUpdate = true;
    return { geometry, material, matrix: stand.clone().multiply(mesh.matrixWorld) };
  });
}

export function disposeTreeParts(parts: TreePart[]): void {
  for (const { geometry, material } of parts) {
    geometry.dispose();
    for (const v of Object.values(material)) if (v instanceof THREE.Texture) v.dispose();
    material.dispose();
  }
}
