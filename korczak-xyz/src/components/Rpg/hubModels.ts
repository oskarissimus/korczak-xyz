/*
 * The hub's models, from the GLBs fal.ai made for the world (`utils/rpg/landmark3d.ts`), each sized
 * to the place it takes in the village (`HUB_FIT`). TRELLIS answers in a unit box, centred on the
 * origin, Y up and the picture's front toward +Z, so a model is scaled to its height (or narrower,
 * to its width, for a wide one), stood on the ground and left facing +Z; the scene turns +Z toward
 * the square, which is where its door was drawn.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { loadLandmarkBytes, type HubSlot } from '../../utils/rpg/landmark3d';

/**
 * Metres, tallest and widest. The landmark is twice the houses' eaves, seen over the roofs from the
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
};

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
