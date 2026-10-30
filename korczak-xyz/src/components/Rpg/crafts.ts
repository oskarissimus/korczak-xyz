/*
 * The workplaces and tools of `utils/rpg/craft.ts`, built from primitives like the hand-built well:
 * low-poly, a silhouette that says "anvil" from across the square. A station is built round its own
 * origin with its working side toward +Z, which the scene turns to face the character's home, so
 * they work at it from the side they come from. A tool is built with the fist at the origin and the
 * handle along +Z, the way the hero's sword is held (`RpgScene.gripSword`).
 */

import * as THREE from 'three';

import type { Craft, Tool } from '../../utils/rpg/craft';
import type { Rig } from './characters';
import { surfaceMat } from './surfaces';

const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.3, roughness: 0.55 });
const steel = new THREE.MeshStandardMaterial({ color: 0xa8aeb6, metalness: 0.3, roughness: 0.35 });
const glow = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 1.6 });
const flame = new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xffa020, emissiveIntensity: 2 });
const wood = surfaceMat('planks', 1, 1, { color: 0xb08860, roughness: 0.9 });
const bark = surfaceMat('bark', 1, 1, { roughness: 1 });
const stone = surfaceMat('stone', 1, 1, { roughness: 1 });
const rock = surfaceMat('rock', 1, 1, { color: 0x8a8580, roughness: 1 });
const handle = new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.9 });
const cloth = new THREE.MeshStandardMaterial({ color: 0xb8433a, roughness: 0.95, side: THREE.DoubleSide });
const straw = new THREE.MeshStandardMaterial({ color: 0xd8b860, roughness: 1 });
const leaf = new THREE.MeshStandardMaterial({ color: 0x4f8a3a, roughness: 1 });
const soil = surfaceMat('dirt', 1, 1, { color: 0x6b5038, roughness: 1 });
const paper = new THREE.MeshStandardMaterial({ color: 0xece0c0, roughness: 0.9 });
const wax = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.8 });
const flask = [0x58d0a0, 0xc070e0, 0xf0c050].map(
  (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, transparent: true, opacity: 0.85, roughness: 0.2 }),
);
const goods = [0xc8a040, 0x9a3a30, 0x5a7a3a, 0xd8c8a0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));

type Part = [THREE.BufferGeometry, THREE.Material, number, number, number, number?];

function parts(list: Part[]): THREE.Group {
  const g = new THREE.Group();
  for (const [geometry, material, x, y, z, turn = 0] of list) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.y = turn;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (top: number, bottom: number, h: number, n = 10) => new THREE.CylinderGeometry(top, bottom, h, n);

/** A log lying along x. */
function log(x: number, y: number, z: number, length: number, r: number, turn = 0): Part {
  const g = cyl(r, r, length, 8).rotateZ(Math.PI / 2);
  return [g, bark, x, y, z, turn];
}

const BUILD: Record<Craft, () => THREE.Group> = {
  smith: () =>
    parts([
      // The anvil on its stump, the forge behind it with its coals glowing.
      [cyl(0.32, 0.38, 0.5), bark, 0, 0.25, 0],
      [box(0.28, 0.16, 0.22), metal, 0, 0.58, 0],
      [box(0.55, 0.14, 0.28), metal, 0.04, 0.73, 0],
      [cyl(0.0, 0.1, 0.24, 6).rotateZ(Math.PI / 2), metal, -0.34, 0.74, 0],
      [box(1.3, 0.75, 0.9), stone, 0, 0.375, -1.1],
      [box(1.0, 0.08, 0.6), glow, 0, 0.78, -1.1],
      [box(0.4, 1.6, 0.4), stone, 0.35, 1.5, -1.3],
      [cyl(0.05, 0.05, 0.9), metal, -0.75, 0.45, -0.7],
    ]),
  carpenter: () =>
    parts([
      [box(0.08, 0.7, 0.6), wood, -0.55, 0.35, 0],
      [box(0.08, 0.7, 0.6), wood, 0.55, 0.35, 0],
      [box(1.6, 0.05, 0.32), wood, 0, 0.73, 0],
      [box(1.4, 0.3, 0.5), wood, 0.2, 0.15, -1.1],
      [box(1.4, 0.06, 0.5), wood, 0.2, 0.33, -1.1, 0.1],
      [box(0.5, 0.5, 0.5), wood, -0.9, 0.25, -0.8, 0.4],
    ]),
  woodcutter: () =>
    parts([
      [cyl(0.36, 0.42, 0.55), bark, 0, 0.275, 0],
      [cyl(0.14, 0.14, 0.4), bark, 0.05, 0.75, 0],
      log(0, 0.18, -1.1, 1.6, 0.18),
      log(0.05, 0.18, -1.48, 1.6, 0.18),
      log(0.02, 0.48, -1.29, 1.6, 0.18),
      log(-1.0, 0.16, -0.4, 1.2, 0.16, 1.2),
    ]),
  miner: () =>
    parts([
      [new THREE.DodecahedronGeometry(0.75, 0).scale(1.2, 0.8, 1), rock, 0, 0.45, -0.3],
      [new THREE.DodecahedronGeometry(0.45, 0), rock, 0.8, 0.25, 0.2],
      [new THREE.DodecahedronGeometry(0.3, 0), rock, -0.7, 0.18, 0.3],
      [new THREE.OctahedronGeometry(0.16, 0), flask[0], 0.25, 0.9, 0.1],
      [new THREE.OctahedronGeometry(0.12, 0), flask[0], -0.3, 0.8, 0.2],
      [box(0.7, 0.35, 0.5), wood, -1.0, 0.18, -0.9, 0.3],
    ]),
  farmer: () => {
    const list: Part[] = [[box(2.4, 0.08, 1.8), soil, 0, 0.04, -0.3]];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5; i++) list.push([new THREE.ConeGeometry(0.12, 0.45, 5), leaf, -0.96 + i * 0.48, 0.3, -0.9 + row * 0.55]);
    list.push([box(0.9, 0.55, 0.6), straw, 1.6, 0.275, -0.9, 0.3]);
    return parts(list);
  },
  cook: () =>
    parts([
      // A cauldron on a tripod over a fire.
      [new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, Math.PI / 2.6, Math.PI / 1.6), metal, 0, 0.62, 0],
      [cyl(0.36, 0.36, 0.04, 12), new THREE.MeshStandardMaterial({ color: 0x8a6a30, roughness: 0.4 }), 0, 0.9, 0],
      [new THREE.ConeGeometry(0.3, 0.45, 6), flame, 0, 0.22, 0],
      log(0, 0.08, 0.15, 0.8, 0.08, 0.6),
      log(0, 0.08, -0.15, 0.8, 0.08, -0.6),
      [cyl(0.03, 0.03, 1.6, 5).rotateZ(0.35), metal, -0.45, 0.75, 0],
      [cyl(0.03, 0.03, 1.6, 5).rotateZ(-0.35), metal, 0.45, 0.75, 0],
      [cyl(0.03, 0.03, 1.0, 5).rotateZ(Math.PI / 2), metal, 0, 1.48, 0],
    ]),
  alchemist: () =>
    parts([
      [box(1.4, 0.06, 0.7), wood, 0, 0.82, 0],
      ...[-0.6, 0.6].flatMap((x): Part[] => [
        [box(0.07, 0.8, 0.07), wood, x, 0.4, 0.28],
        [box(0.07, 0.8, 0.07), wood, x, 0.4, -0.28],
      ]),
      [new THREE.SphereGeometry(0.11, 10, 8), flask[0], -0.4, 0.96, -0.1],
      [cyl(0.03, 0.03, 0.14, 6), flask[0], -0.4, 1.1, -0.1],
      [cyl(0.07, 0.07, 0.26, 8), flask[1], -0.1, 0.98, -0.15],
      [new THREE.ConeGeometry(0.1, 0.24, 8), flask[2], 0.15, 0.97, -0.1],
      [cyl(0.12, 0.09, 0.14, 10), stone, 0.45, 0.92, 0.05],
      [box(0.3, 0.04, 0.22), paper, -0.1, 0.87, 0.18, 0.2],
    ]),
  trader: () =>
    parts([
      [box(1.8, 0.08, 0.8), wood, 0, 0.85, 0],
      [box(1.8, 0.8, 0.06), wood, 0, 0.42, 0.37],
      ...[-0.85, 0.85].flatMap((x): Part[] => [[box(0.08, 2.1, 0.08), wood, x, 1.05, -0.35]]),
      [box(2.0, 0.04, 1.1), cloth, 0, 2.05, 0.05],
      ...goods.map((m, i): Part => [box(0.28, 0.2, 0.28), m, -0.6 + i * 0.4, 1.0, -0.05, i * 0.3]),
      [cyl(0.2, 0.16, 0.35, 10), goods[0], -1.25, 0.18, 0.2],
    ]),
  priest: () =>
    parts([
      [box(1.1, 0.8, 0.55), stone, 0, 0.4, 0],
      [box(1.25, 0.08, 0.65), stone, 0, 0.84, 0],
      [box(0.12, 0.9, 0.12), stone, 0, 1.33, -0.15],
      [box(0.5, 0.12, 0.12), stone, 0, 1.55, -0.15],
      ...[-0.4, -0.25, 0.3, 0.42].map((x, i): Part => [cyl(0.03, 0.03, 0.14 + i * 0.03, 6), wax, x, 0.95 + i * 0.015, 0.12]),
      ...[-0.4, -0.25, 0.3, 0.42].map((x, i): Part => [new THREE.SphereGeometry(0.025, 6, 4), flame, x, 1.04 + i * 0.03, 0.12]),
    ]),
  guard: () =>
    parts([
      [cyl(0.05, 0.05, 1.0, 6), metal, 0, 0.5, 0],
      [cyl(0.3, 0.18, 0.25, 10), metal, 0, 1.1, 0],
      [new THREE.ConeGeometry(0.22, 0.4, 6), flame, 0, 1.4, 0],
      [box(0.9, 0.08, 0.08), wood, 0.9, 0.9, -0.3, 0.3],
      [box(0.08, 1.0, 0.08), wood, 0.55, 0.5, -0.4, 0.3],
      [box(0.08, 1.0, 0.08), wood, 1.25, 0.5, -0.2, 0.3],
    ]),
  scribe: () =>
    parts([
      [box(0.12, 1.0, 0.12), wood, 0, 0.5, 0],
      [box(0.4, 0.06, 0.4), wood, 0, 0.03, 0],
      [box(0.6, 0.04, 0.45).rotateX(-0.45), wood, 0, 1.08, 0],
      [box(0.5, 0.03, 0.36).rotateX(-0.45), paper, 0, 1.11, 0.01],
      [box(0.5, 0.5, 0.4), wood, 0.9, 0.25, -0.6, 0.3],
      [box(0.35, 0.08, 0.26), paper, 0.9, 0.54, -0.6, 0.5],
    ]),
};

export function buildStation(craft: Craft): THREE.Group {
  const g = BUILD[craft]();
  g.userData.station = craft;
  return g;
}

/** A tool, fist at the origin, handle along +Z, its head at the far end. */
export function buildTool(tool: Tool): THREE.Group {
  const shaft = (length: number, r = 0.022): Part => [cyl(r, r, length, 6).rotateX(Math.PI / 2), handle, 0, 0, length / 2 - 0.08];
  switch (tool) {
    case 'hammer':
      return parts([shaft(0.42), [box(0.07, 0.16, 0.07), steel, 0, 0, 0.36]]);
    case 'axe':
      return parts([shaft(0.7), [box(0.03, 0.18, 0.12), steel, 0, 0.08, 0.56]]);
    case 'pickaxe':
      return parts([shaft(0.75), [cyl(0.015, 0.03, 0.55, 5), steel, 0, 0, 0.62]]);
    case 'hoe':
      return parts([shaft(1.2), [box(0.16, 0.02, 0.14), steel, 0, 0.07, 1.06]]);
    case 'ladle':
      return parts([shaft(0.8, 0.015), [new THREE.SphereGeometry(0.07, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steel, 0, -0.02, 0.72]]);
    case 'pestle':
      return parts([[cyl(0.02, 0.035, 0.24, 6).rotateX(Math.PI / 2), stone, 0, 0, 0.06]]);
    case 'spear':
      return parts([shaft(1.9), [new THREE.ConeGeometry(0.04, 0.24, 5).rotateX(Math.PI / 2), steel, 0, 0, 1.9]]);
    case 'quill':
      return parts([[box(0.01, 0.05, 0.26), paper, 0, 0.02, 0.1]]);
  }
}

/**
 * Puts a tool in a character's right hand, worked out from the hand's bones as the hero's sword is:
 * the kit's people have fingers to aim it by; a generated person has a wrist and its rest pose.
 */
export function holdTool(rig: Rig, tool: THREE.Object3D): boolean {
  const hand = rig.hand;
  if (!hand) return false;
  let along: THREE.Vector3;
  let grip: THREE.Vector3;
  let scale = 1;
  if (hand.name === 'RightHand') {
    let mesh: THREE.SkinnedMesh | null = null;
    rig.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
    });
    const skinned = mesh as THREE.SkinnedMesh | null;
    const i = skinned ? skinned.skeleton.bones.findIndex((b) => b.name === hand.name) : -1;
    const rest = new THREE.Quaternion();
    if (skinned && i >= 0) new THREE.Matrix4().copy(skinned.skeleton.boneInverses[i]).invert().decompose(new THREE.Vector3(), rest, new THREE.Vector3());
    along = new THREE.Vector3(0, 0, 1).applyQuaternion(rest.invert()).normalize();
    grip = new THREE.Vector3(0, 0.08, 0);
  } else {
    const index = rig.model.getObjectByName('index_01_r');
    const pinky = rig.model.getObjectByName('pinky_01_r');
    const middle = rig.model.getObjectByName('middle_01_r');
    if (!index || !pinky || !middle) return false;
    rig.model.updateMatrixWorld(true);
    const local = (o: THREE.Object3D) => hand.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    along = local(index).sub(local(pinky)).normalize();
    grip = local(middle).multiplyScalar(0.55);
    // The kit's rig is in centimetres under a 0.01 armature; the tool is in metres.
    scale = 1 / hand.getWorldScale(new THREE.Vector3()).x;
  }
  tool.scale.setScalar(scale);
  tool.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
  tool.position.copy(grip);
  hand.add(tool);
  return true;
}

/** Frees a station's or a tool's geometry; the materials are shared and stay. */
export function disposeCraft(object: THREE.Object3D) {
  object.removeFromParent();
  object.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}
