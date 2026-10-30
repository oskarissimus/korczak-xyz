#!/usr/bin/env node
/**
 * Adds the jump to the generated people's clip library (`src/assets/rpg/people/people_clips.json`):
 * Quaternius's Jump_Start, Jump_Loop and Jump_Land (Universal Animation Library, CC0 — the same
 * pack `rpg-characters.mjs` takes the kit people's clips from), moved onto the Meshy donor's
 * skeleton. Meshy's own library was bought clip by clip (`rpg-people.mjs`) and has no jump in it;
 * this is a retarget instead of another purchase.
 *
 *   npm i --no-save @gltf-transform/core@4
 *   node scripts/rpg-people-jump.mjs "/path/to/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"
 *
 * The two skeletons do not share rest poses or bone axes (Quaternius stands in a T, the donor in an
 * A, and each bone's local frame is its exporter's), so local rotations cannot be copied across. What
 * is copied is each bone's rotation in the world, measured from a pose both rigs share: each at
 * rest, with the donor's limbs then turned bone by bone, from the hips out, to point where
 * Quaternius's do. For every bone, `C = Q_rest⁻¹ · M_rest` (world rotations) is what turns a
 * Quaternius bone into the donor's in that pose; the donor's bone at any frame of a jump is then
 * `Q(t) · C`, and its local rotation follows from its parent's. Both rigs face +Z with their left on
 * +X, so no frame change is needed between them.
 *
 * Not the two Idle_Loops, which was the first try: Meshy's idle stands turned 42° at the hips, and
 * calibrating on it twisted every bone once the pose left the idle's.
 *
 * The hips' height is kept as a share of the rest's, as `rpg-people.mjs` stores it. Quaternius's
 * jumps carry no rise of their own (the pelvis stays at standing height in the air): the scene
 * lifts the whole body, these only tuck the legs and swing the arms.
 */
import { NodeIO } from '@gltf-transform/core';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/rpg-people-jump.mjs <UAL1_Standard.glb>');
  process.exit(1);
}
const people = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'rpg', 'people');

const JUMPS = ['Jump_Start', 'Jump_Loop', 'Jump_Land'];

/** The donor's bones by Quaternius's names. Meshy counts the spine down from the neck. */
const BONES = {
  Hips: 'pelvis',
  Spine02: 'spine_01',
  Spine01: 'spine_02',
  Spine: 'spine_03',
  neck: 'neck_01',
  Head: 'Head',
  LeftShoulder: 'clavicle_l',
  LeftArm: 'upperarm_l',
  LeftForeArm: 'lowerarm_l',
  LeftHand: 'hand_l',
  RightShoulder: 'clavicle_r',
  RightArm: 'upperarm_r',
  RightForeArm: 'lowerarm_r',
  RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l',
  LeftLeg: 'calf_l',
  LeftFoot: 'foot_l',
  LeftToeBase: 'ball_l',
  RightUpLeg: 'thigh_r',
  RightLeg: 'calf_r',
  RightFoot: 'foot_r',
  RightToeBase: 'ball_r',
};

/** The bone each one points at, which gives it its direction. */
const NEXT = {
  Hips: 'Spine02',
  Spine02: 'Spine01',
  Spine01: 'Spine',
  Spine: 'neck',
  neck: 'Head',
  LeftShoulder: 'LeftArm',
  LeftArm: 'LeftForeArm',
  LeftForeArm: 'LeftHand',
  RightShoulder: 'RightArm',
  RightArm: 'RightForeArm',
  RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg',
  LeftLeg: 'LeftFoot',
  LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg',
  RightLeg: 'RightFoot',
  RightFoot: 'RightToeBase',
};

// Quaternius: the skeleton as three objects, and its clips as three clips.
const doc = await new NodeIO().read(src);
const root = doc.getRoot();
const objects = new Map();
const build = (node) => {
  const o = new THREE.Object3D();
  o.name = node.getName();
  o.position.fromArray(node.getTranslation());
  o.quaternion.fromArray(node.getRotation());
  o.scale.fromArray(node.getScale());
  objects.set(node, o);
  for (const child of node.listChildren()) o.add(build(child));
  return o;
};
const quaternius = new THREE.Group();
for (const node of root.listScenes()[0].listChildren()) quaternius.add(build(node));
const qBone = (name) => quaternius.getObjectByName(name);

const qClip = (name) => {
  const anim = root.listAnimations().find((a) => a.getName() === name);
  if (!anim) throw new Error(`no ${name} in ${src}`);
  const tracks = anim.listChannels().flatMap((ch) => {
    const node = ch.getTargetNode()?.getName();
    const s = ch.getSampler();
    const times = Array.from(s.getInput().getArray());
    const values = Array.from(s.getOutput().getArray());
    if (ch.getTargetPath() === 'rotation') return [new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, values)];
    if (ch.getTargetPath() === 'translation' && node === 'pelvis') return [new THREE.VectorKeyframeTrack(`${node}.position`, times, values)];
    return [];
  });
  return new THREE.AnimationClip(name, -1, tracks);
};
const qMixer = new THREE.AnimationMixer(quaternius);
const qPose = (clip, t) => {
  qMixer.stopAllAction();
  qMixer.uncacheRoot(quaternius);
  qMixer.clipAction(clip).play();
  qMixer.setTime(t);
  quaternius.updateMatrixWorld(true);
};
const worldQ = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const qHipsY = () => qBone('pelvis').getWorldPosition(new THREE.Vector3()).y;

// The donor: its bones from the .bin's header, at rest.
const bin = await readFile(join(people, 'donor_male.bin'));
const head = JSON.parse(bin.subarray(4, 4 + bin.readUInt32LE(0)).toString());
const donor = head.bones.map((b) => {
  const o = new THREE.Object3D();
  o.name = b.name;
  o.position.fromArray(b.position);
  o.quaternion.fromArray(b.quaternion);
  return o;
});
const meshy = new THREE.Group();
head.bones.forEach((b, i) => (b.parent < 0 ? meshy : donor[b.parent]).add(donor[i]));
const dBone = (name) => meshy.getObjectByName(name);

// The pose both rigs are measured from: each at rest, and the donor's limbs then turned, bone by
// bone from the hips out, to point where Quaternius's do. Each bone's rotation between that pose
// and its own frame is what `fit` keeps.
quaternius.updateMatrixWorld(true);
meshy.updateMatrixWorld(true);
const at = (o) => o.getWorldPosition(new THREE.Vector3());
for (const [d, next] of Object.entries(NEXT)) {
  const bone = dBone(d);
  const want = at(qBone(BONES[next])).sub(at(qBone(BONES[d]))).normalize();
  const have = at(dBone(next)).sub(at(bone)).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(have, want);
  bone.quaternion.copy(worldQ(bone.parent).invert().multiply(turn.multiply(worldQ(bone))));
  bone.updateMatrixWorld(true);
}
const fit = new Map(
  Object.entries(BONES).map(([d, q]) => [d, worldQ(qBone(q)).invert().multiply(worldQ(dBone(d)))]),
);
const qRestHipsY = at(qBone('pelvis')).y;

const clipsPath = join(people, 'people_clips.json');
const library = JSON.parse(await readFile(clipsPath, 'utf8')).filter((c) => !JUMPS.includes(c.name));

// Parents before children, so each bone's local rotation is taken against a parent already set.
const order = head.bones.map((b) => b.name).filter((n) => n in BONES);
const round = (x) => +x.toFixed(4);

for (const name of JUMPS) {
  const clip = qClip(name);
  const times = [...new Set(clip.tracks.flatMap((t) => Array.from(t.times)))].sort((a, b) => a - b);
  const rotations = new Map(order.map((n) => [n, []]));
  const hips = [];
  for (const t of times) {
    qPose(clip, t);
    for (const n of order) {
      const world = worldQ(qBone(BONES[n])).multiply(fit.get(n));
      const bone = dBone(n);
      const parent = worldQ(bone.parent).invert();
      bone.quaternion.copy(parent.multiply(world));
      bone.updateMatrixWorld(true);
      rotations.get(n).push(...bone.quaternion.toArray().map(round));
    }
    hips.push(0, round(qHipsY() / qRestHipsY), 0);
  }
  const at = times.map(round);
  library.push({
    name,
    duration: round(clip.duration),
    tracks: [
      ...order.map((n) => ({ name: `${n}.quaternion`, type: 'quaternion', times: at, values: rotations.get(n) })),
      { name: 'Hips.position', type: 'vector', times: at, values: hips },
    ],
  });
  console.log(`  ${name}: ${times.length} frames, ${round(clip.duration)} s`);
}

await writeFile(clipsPath, JSON.stringify(library));
console.log(`  ${clipsPath}`);
