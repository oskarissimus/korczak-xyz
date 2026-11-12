/*
 * A ragdoll on a skinned body (owner, 12 Nov 2026: "Dodajmy ragdoll jak jest fragowane"): whoever is
 * killed falls as a body does, wherever the blow sends them, instead of playing the same `Death01`.
 *
 * The points are the skeleton's joints where the body stood at that moment, with the blow given to
 * them as velocities (`utils/rpg/ragdoll.ts` does the physics); every frame each bone is turned so the
 * segment it owns points where its points have fallen. A segment's turn since the moment of death
 * (`delta`) is put on every bone under it that is not a segment itself — the fingers turn with the
 * hand, the clavicles with the chest — so any skeleton with the dozen big joints works: the donor's
 * (generated people, Meshy's rig under the same names) and Quaternius's (the kit's people).
 *
 * The animation mixer is simply no longer updated: the bones keep what this writes.
 */

import * as THREE from 'three';
import { kick, makeBody, point, stepBody, type Body, type StickSpec, type Vec3 } from '../../utils/rpg/ragdoll';

/** The joints the body is made of, by the donor's names and Quaternius's. */
const JOINTS = {
  pelvis: ['Hips', 'pelvis'],
  chest: ['Spine', 'spine_03'],
  neck: ['neck', 'neck_01'],
  head: ['Head'],
  armL: ['LeftArm', 'upperarm_l'],
  foreL: ['LeftForeArm', 'lowerarm_l'],
  handL: ['LeftHand', 'hand_l'],
  armR: ['RightArm', 'upperarm_r'],
  foreR: ['RightForeArm', 'lowerarm_r'],
  handR: ['RightHand', 'hand_r'],
  thighL: ['LeftUpLeg', 'thigh_l'],
  calfL: ['LeftLeg', 'calf_l'],
  footL: ['LeftFoot', 'foot_l'],
  thighR: ['RightUpLeg', 'thigh_r'],
  calfR: ['RightLeg', 'calf_r'],
  footR: ['RightFoot', 'foot_r'],
} as const;
type Joint = keyof typeof JOINTS;
const NAMES = Object.keys(JOINTS) as Joint[];
/** Points: the joints, then the crown of the head (a point of our own, above the head bone). */
const P = Object.fromEntries([...NAMES, 'crown'].map((n, i) => [n, i])) as Record<Joint | 'crown', number>;

/**
 * Each segment: the bone it turns, how its direction is read (from → to), the points across it whose
 * line fixes its twist (torso and head), or else the segment whose turn it carries before swinging
 * to its own direction (a limb: an upper arm turns with the chest, then points at its elbow).
 */
interface Segment {
  bone: Joint;
  from: number;
  to: number;
  across?: [number, number];
  parent?: number;
}
const SEGMENTS: Segment[] = [
  { bone: 'pelvis', from: P.pelvis, to: P.chest, across: [P.thighR, P.thighL] },
  { bone: 'chest', from: P.pelvis, to: P.chest, across: [P.armR, P.armL] },
  { bone: 'neck', from: P.chest, to: P.head, across: [P.armR, P.armL] },
  { bone: 'head', from: P.head, to: P.crown, across: [P.armR, P.armL] },
  { bone: 'armL', from: P.armL, to: P.foreL, parent: 1 },
  { bone: 'foreL', from: P.foreL, to: P.handL, parent: 4 },
  { bone: 'armR', from: P.armR, to: P.foreR, parent: 1 },
  { bone: 'foreR', from: P.foreR, to: P.handR, parent: 6 },
  { bone: 'thighL', from: P.thighL, to: P.calfL, parent: 0 },
  { bone: 'calfL', from: P.calfL, to: P.footL, parent: 8 },
  { bone: 'thighR', from: P.thighR, to: P.calfR, parent: 0 },
  { bone: 'calfR', from: P.calfR, to: P.footR, parent: 10 },
];

/** The sticks: bones held, a torso that bends a little and does not twist apart, and the limits that keep a limb from folding into itself. */
const STICKS: StickSpec[] = [
  // The torso: hips and shoulders each a rigid bar, joined to the spine.
  [P.pelvis, P.chest, 1],
  [P.thighL, P.thighR, 1],
  [P.pelvis, P.thighL, 1],
  [P.pelvis, P.thighR, 1],
  [P.armL, P.armR, 1],
  [P.chest, P.armL, 1],
  [P.chest, P.armR, 1],
  // Bends a little at the waist, twists hardly at all.
  [P.pelvis, P.armL, 0.9, 1.04],
  [P.pelvis, P.armR, 0.9, 1.04],
  [P.chest, P.thighL, 0.9, 1.04],
  [P.chest, P.thighR, 0.9, 1.04],
  [P.armL, P.thighR, 0.92, 1.04],
  [P.armR, P.thighL, 0.92, 1.04],
  [P.armL, P.thighL, 0.85, 1.04],
  [P.armR, P.thighR, 0.85, 1.04],
  // Neck and head: the head is rigid, the neck lets it loll but not fold into the chest.
  [P.chest, P.neck, 1],
  [P.neck, P.head, 1],
  [P.head, P.crown, 1],
  [P.chest, P.head, 0.9, 1],
  [P.chest, P.crown, 0.8, 1],
  [P.armL, P.head, 0.8, Infinity],
  [P.armR, P.head, 0.8, Infinity],
  [P.pelvis, P.crown, 0.9, Infinity],
  // Limbs.
  [P.armL, P.foreL, 1],
  [P.foreL, P.handL, 1],
  [P.armR, P.foreR, 1],
  [P.foreR, P.handR, 1],
  [P.thighL, P.calfL, 1],
  [P.calfL, P.footL, 1],
  [P.thighR, P.calfR, 1],
  [P.calfR, P.footR, 1],
  // No elbow folds flat, no knee folds the heel into the hip, no thigh goes up through the chest.
  [P.armL, P.handL, 0.45, Infinity],
  [P.armR, P.handR, 0.45, Infinity],
  [P.thighL, P.footL, 0.55, Infinity],
  [P.thighR, P.footR, 0.55, Infinity],
  [P.chest, P.calfL, 0.6, Infinity],
  [P.chest, P.calfR, 0.6, Infinity],
  [P.calfL, P.calfR, 0.4, Infinity],
];

const v = new THREE.Vector3();
const w = new THREE.Vector3();
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();

/** A rotation matrix's quaternion for an aim (its y) and the line across it (its x). */
function frame(aim: THREE.Vector3, across: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const y = aim.clone().normalize();
  const x = across.clone().addScaledVector(y, -across.dot(y));
  if (x.lengthSq() < 1e-10) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(m);
}

function sub(body: Body, a: number, b: number, out: THREE.Vector3): THREE.Vector3 {
  const pa = point(body, a);
  const pb = point(body, b);
  return out.set(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
}

export interface Ragdoll {
  /** False once it has come to rest; it is then left as it lies. */
  readonly moving: boolean;
  update(dt: number): void;
  /** Puts every bone back as it was at the moment of death, for a hero who gets up again. */
  restore(): void;
}

/** The skeleton that moves the body: the skinned mesh with the most bones (the kit's hair has its own few). */
function skeletonOf(model: THREE.Object3D): THREE.Skeleton | null {
  let best: THREE.Skeleton | null = null;
  model.traverse((o) => {
    const s = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : null;
    if (s && (!best || s.bones.length > best.bones.length)) best = s;
  });
  return best;
}

/**
 * Makes `model`'s skeleton go limp from where it stands now, thrown along `blow` (m/s, horizontal
 * mostly). Null when the skeleton lacks a joint it needs, so the caller can play the death clip.
 */
export function makeRagdoll(model: THREE.Object3D, blow: THREE.Vector3, groundAt: (x: number, z: number) => number): Ragdoll | null {
  const skeleton = skeletonOf(model);
  if (!skeleton) return null;
  const byName = new Map(skeleton.bones.map((b) => [b.name, b]));
  const bones = {} as Record<Joint, THREE.Bone>;
  for (const n of NAMES) {
    const bone = JOINTS[n].map((name) => byName.get(name)).find(Boolean);
    if (!bone) return null;
    bones[n] = bone;
  }
  model.updateWorldMatrix(true, true);
  const at = (o: THREE.Object3D): Vec3 => {
    o.getWorldPosition(v);
    return [v.x, v.y, v.z];
  };
  const points: Vec3[] = NAMES.map((n) => at(bones[n]));
  // The crown: as far above the head bone as the neck is long, twice, along the neck.
  const head = new THREE.Vector3(...points[P.head]);
  const neck = new THREE.Vector3(...points[P.neck]);
  const up = head.clone().sub(neck);
  if (up.length() < 0.02) up.set(0, 0.1, 0);
  const height = Math.max(0.5, head.y - Math.min(points[P.footL][1], points[P.footR][1]));
  points.push(head.clone().addScaledVector(up.normalize(), height * 0.11).toArray() as Vec3);
  const radius = [...NAMES, 'crown'].map((n) =>
    height * (n === 'pelvis' || n === 'chest' ? 0.07 : n === 'head' || n === 'crown' || n === 'neck' ? 0.055 : n.startsWith('arm') || n.startsWith('thigh') ? 0.05 : 0.035),
  );
  const body = makeBody(points, STICKS, radius);

  // The blow: the top of the body takes most of it, so it goes over backwards from the feet; a
  // little of it upward, and a little at random, so no two fall alike. The knees buckle the other
  // way, so the legs fold under it rather than the whole body falling like a plank.
  for (let i = 0; i < points.length; i++) {
    const share = Math.max(0, (points[i][1] - points[P.footL][1]) / height);
    const r = () => (Math.random() - 0.5) * 0.6;
    const knee = i === P.calfL || i === P.calfR ? -0.7 - Math.random() * 0.5 : 0;
    kick(body, i, [blow.x * (0.25 + share + knee) + r(), 0.4 + share * 0.7 + r() * 0.5 + knee, blow.z * (0.25 + share + knee) + r()]);
  }

  // Every bone under the pelvis, parents first, with the segment it turns with.
  const order: THREE.Bone[] = [];
  const segOf = new Map<THREE.Bone, number>();
  const segIndex = new Map(SEGMENTS.map((s, i) => [bones[s.bone], i]));
  const walk = (b: THREE.Object3D, seg: number) => {
    if (!(b as THREE.Bone).isBone) return;
    const own = segIndex.get(b as THREE.Bone) ?? seg;
    order.push(b as THREE.Bone);
    segOf.set(b as THREE.Bone, own);
    for (const c of b.children) walk(c, own);
  };
  walk(bones.pelvis, 0);
  const startWorld = new Map(order.map((b) => [b, b.getWorldQuaternion(new THREE.Quaternion())]));
  const startLocal = new Map(order.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const startFrame = SEGMENTS.map((s) =>
    s.across ? frame(sub(body, s.from, s.to, v), sub(body, s.across[0], s.across[1], w), new THREE.Quaternion()) : null,
  );
  const startAim = SEGMENTS.map((s) => sub(body, s.from, s.to, new THREE.Vector3()).normalize());
  // A body whose bones the scene culls by their rest box would vanish once it lies outside it.
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
  });

  const delta = SEGMENTS.map(() => new THREE.Quaternion());
  const world = new Map<THREE.Bone, THREE.Quaternion>(order.map((b) => [b, new THREE.Quaternion()]));
  const rootWorld = new THREE.Quaternion();

  const pose = () => {
    SEGMENTS.forEach((s, i) => {
      if (s.across) {
        frame(sub(body, s.from, s.to, v), sub(body, s.across[0], s.across[1], w), delta[i]);
        delta[i].multiply(q.copy(startFrame[i]!).invert());
      } else {
        // Carried by its parent's turn, then swung the shortest way onto where it points now.
        const carried = startAim[i].clone().applyQuaternion(delta[s.parent!]);
        const now = sub(body, s.from, s.to, v).normalize();
        delta[i].setFromUnitVectors(carried, now).multiply(delta[s.parent!]);
      }
    });
    const pelvis = bones.pelvis;
    const parent = pelvis.parent!;
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(rootWorld);
    for (const b of order) {
      const want = world.get(b)!.copy(delta[segOf.get(b)!]).multiply(startWorld.get(b)!);
      const above = b === pelvis ? rootWorld : world.get(b.parent as THREE.Bone) ?? rootWorld;
      b.quaternion.copy(q.copy(above).invert().multiply(want));
    }
    const p = point(body, P.pelvis);
    pelvis.position.copy(parent.worldToLocal(v.set(p[0], p[1], p[2])));
  };

  return {
    get moving() {
      return !body.asleep;
    },
    update(dt: number) {
      if (body.asleep) return;
      stepBody(body, dt, groundAt);
      pose();
    },
    restore() {
      for (const [b, s] of startLocal) {
        b.quaternion.copy(s.q);
        b.position.copy(s.p);
      }
    },
  };
}
