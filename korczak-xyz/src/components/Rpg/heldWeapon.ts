/*
 * The hero's generated weapon as the hand holds it (`utils/rpg/weapon.ts`): TRELLIS's unit box stood
 * on its length, the handle end at the origin and the blade up +Y, sized to the world's length in
 * metres. `RpgScene` puts it in the hand the way it put the kit's bronze sword, whose blade is +Y too.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { loadLandmarkBytes } from '../../utils/rpg/landmark3d';
import { weaponAxis } from '../../utils/rpg/weapon';
import { dropFloor } from './hubModels';

export async function loadWeapon(url: string, length: number): Promise<THREE.Group> {
  const bytes = await loadLandmarkBytes(url);
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const model = gltf.scene;
  // A sheet under a thing standing on its end is as likely as under one lying down.
  dropFloor(model);
  const turn = new THREE.Group();
  turn.add(model);
  const first = new THREE.Box3().setFromObject(turn).getSize(new THREE.Vector3());
  const axis = weaponAxis(first);
  // Lying down: its length turned onto +Y, the +X (or +Z) end up — a guess; the one FLUX axe TRELLIS
  // laid flat had its head toward +X.
  if (axis === 0) turn.rotation.z = Math.PI / 2;
  else if (axis === 2) turn.rotation.x = -Math.PI / 2;
  turn.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(turn);
  const size = box.getSize(new THREE.Vector3());
  const scale = length / Math.max(size.y, 1e-6);
  const centre = box.getCenter(new THREE.Vector3());
  turn.scale.setScalar(scale);
  turn.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    // TRELLIS writes no metallic factor, which glTF reads as fully metal: black without an environment map.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (typeof std.metalness === 'number') std.metalness = std.metalnessMap ? Math.min(std.metalness, 0.35) : 0.2;
    }
  });
  const group = new THREE.Group();
  group.add(turn);
  return group;
}
