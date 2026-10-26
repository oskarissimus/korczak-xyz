/*
 * The hub's landmark, from the GLB fal.ai made for the world (`utils/rpg/landmark3d.ts`), sized to
 * stand where the well stands. TRELLIS answers in a unit box, centred on the origin, Y up and the
 * picture's front toward +Z, so the model is scaled to `HEIGHT` (or narrower, to `WIDTH`, for a wide
 * one), stood on the ground and left facing +Z: toward the spawn, which is where the hero first
 * looks from.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { loadLandmarkBytes } from '../../utils/rpg/landmark3d';

/** Metres: twice the houses' eaves, a thing seen over the roofs from the edge of the village. */
const HEIGHT = 6.5;
/** Metres across at most: the square's walkway around it is ~5 m before the first villager. */
const WIDTH = 5;

export interface HubLandmark {
  group: THREE.Group;
  /** The circle it blocks walking in. */
  radius: number;
}

export async function loadHubLandmark(url: string): Promise<HubLandmark> {
  const bytes = await loadLandmarkBytes(url);
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(HEIGHT / Math.max(size.y, 1e-3), WIDTH / Math.max(size.x, size.z, 1e-3));
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
  group.name = 'hub-landmark';
  group.add(model);
  return { group, radius: (Math.max(size.x, size.z) * scale) / 2 + 0.3 };
}

export function disposeHubLandmark(group: THREE.Object3D): void {
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
