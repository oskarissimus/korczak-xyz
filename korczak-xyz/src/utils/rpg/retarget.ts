/*
 * Clips moved onto a skeleton whose bones point their axes another way (owner, 31 Oct 2026: "even
 * with Meshy's paid rig the arms bend strangely when walking, the hands the strangest").
 *
 * The clip library was made on one Meshy rig, the male donor's, and a clip sets every bone's local
 * rotation outright. Copied as they are onto another rig, the rotations mean the same thing only if
 * each bone's rest frame is the same as the donor's — the same direction along the bone *and the
 * same roll about it*. Meshy picks a rig's bone frames from the mesh it is given, so on a T-posed
 * model they are not: measured on a blacksmith Meshy rigged in a palms-down T-pose (31 Oct 2026),
 * against the donor stood in the same T-pose, the upper arms are rolled ~60° about their own length,
 * the forearms ~70°, the hands 80–115°. A copied walk then bends each elbow in a plane turned that
 * far from the one it was made in, and turns each hand over — which is what was seen.
 *
 * So the clips are carried across in **world** space instead, from a pose both skeletons share: each
 * source bone's turn away from its reference pose is applied to the target bone's rest, and turned
 * back into a local rotation under the target's own parents. Which way a target bone's axes point no
 * longer matters, only that its rest pose is the source's reference pose — the donor as it stands for
 * an A-posed model, or stood in a T-pose (`tPoseDonor`, palms down) for a T-posed one.
 *
 * Pure (three's maths only), so it is tested.
 */
import * as THREE from 'three';

/** A skeleton's bones in parent-first order, with one local rotation each. */
export interface PoseSkeleton {
  names: string[];
  /** Index of each bone's parent in `names`, -1 at the root. */
  parent: number[];
  /** Local rotation of each bone, xyzw. */
  local: [number, number, number, number][];
  /** Local position of each bone under its parent; only `aimedLike` reads it. */
  offset?: [number, number, number][];
}

/** The limbs `aimedLike` points, each bone at the child it points to. */
export const LIMBS: readonly (readonly [string, string])[] = [
  ['LeftArm', 'LeftForeArm'],
  ['LeftForeArm', 'LeftHand'],
  ['RightArm', 'RightForeArm'],
  ['RightForeArm', 'RightHand'],
  ['LeftUpLeg', 'LeftLeg'],
  ['LeftLeg', 'LeftFoot'],
  ['RightUpLeg', 'RightLeg'],
  ['RightLeg', 'RightFoot'],
];

function placed(s: PoseSkeleton, local: THREE.Quaternion[], root: THREE.Matrix4): THREE.Matrix4[] {
  const m: THREE.Matrix4[] = [];
  const one = new THREE.Vector3(1, 1, 1);
  s.parent.forEach((p, i) => {
    const own = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(s.offset?.[i] ?? [0, 0, 0]), local[i], one);
    m[i] = (p < 0 ? root.clone() : m[p].clone()).multiply(own);
  });
  return m;
}

/**
 * `source` stood the way `target` rests: each limb bone of `source` turned, parent first, by the
 * shortest arc that points it where the same bone of `target` points. That is the pose the two share
 * for `retargetClips` — a T-pose for a T-posed model, an A-pose for an A-posed one, the elbows as
 * bent as the target's — whatever the target's bones' own axes are. Only directions are read, so the
 * two may differ in size and units. `targetRoot` places the target's root bone in the world.
 */
export function aimedLike(source: PoseSkeleton, target: PoseSkeleton, targetRoot: THREE.Matrix4 = new THREE.Matrix4()): PoseSkeleton {
  const sIndex = new Map(source.names.map((n, i) => [n, i]));
  const tIndex = new Map(target.names.map((n, i) => [n, i]));
  const tPlaced = placed(target, target.local.map(quat), targetRoot);
  const local = source.local.map(quat);
  const at = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
  for (const [bone, child] of LIMBS) {
    const sb = sIndex.get(bone), sc = sIndex.get(child), tb = tIndex.get(bone), tc = tIndex.get(child);
    if (sb === undefined || sc === undefined || tb === undefined || tc === undefined) continue;
    const want = at(tPlaced[tc]).sub(at(tPlaced[tb])).normalize();
    const m = placed(source, local, new THREE.Matrix4());
    const have = at(m[sc]).sub(at(m[sb])).normalize();
    if (want.lengthSq() < 0.5 || have.lengthSq() < 0.5) continue;
    const turn = new THREE.Quaternion().setFromUnitVectors(have, want);
    const world = new THREE.Quaternion().setFromRotationMatrix(m[sb]);
    const p = source.parent[sb];
    const parent = p < 0 ? new THREE.Quaternion() : new THREE.Quaternion().setFromRotationMatrix(m[p]);
    local[sb] = parent.invert().multiply(turn.multiply(world));
  }
  return { ...source, local: local.map((q) => q.toArray() as [number, number, number, number]) };
}

export interface ClipTrack {
  name: string;
  type: 'quaternion' | 'vector';
  times: number[];
  values: number[];
}

export interface ClipLike {
  name: string;
  duration: number;
  tracks: ClipTrack[];
}

function worlds(s: PoseSkeleton, local: THREE.Quaternion[], root: THREE.Quaternion): THREE.Quaternion[] {
  const w: THREE.Quaternion[] = [];
  s.parent.forEach((p, i) => {
    w[i] = (p < 0 ? root.clone() : w[p].clone()).multiply(local[i]);
  });
  return w;
}

const quat = (q: [number, number, number, number]) => new THREE.Quaternion().fromArray(q);

/**
 * `clips`, authored on `source` (its own rest rotations, `source.local`), carried onto `target` (its
 * rest rotations, `target.local`), given the pose they share: `reference`, the source's bones'
 * local rotations in the pose the target rests in. `targetRoot` is the world rotation of whatever
 * holds the target's root bone (Meshy's armature node), identity if nothing turns it. Position tracks
 * pass through unchanged; bones the target lacks are dropped.
 */
export function retargetClips<C extends ClipLike>(
  clips: C[],
  source: PoseSkeleton,
  reference: PoseSkeleton,
  target: PoseSkeleton,
  targetRoot: THREE.Quaternion = new THREE.Quaternion(),
): C[] {
  const id = new THREE.Quaternion();
  const sIndex = new Map(source.names.map((n, i) => [n, i]));
  const sRest = source.local.map(quat);
  const refWorld = worlds(source, reference.local.map(quat), id);
  const refInv = refWorld.map((q) => q.clone().invert());
  const tRest = target.local.map(quat);
  const tRestWorld = worlds(target, tRest, targetRoot);
  // Each target bone's source bone, by name.
  const pair = target.names.map((n) => sIndex.get(n) ?? -1);

  return clips.map((clip) => {
    const rot = new Map<number, ClipTrack>();
    for (const t of clip.tracks) {
      if (t.type !== 'quaternion' || !t.name.endsWith('.quaternion')) continue;
      const i = sIndex.get(t.name.slice(0, -'.quaternion'.length));
      if (i !== undefined) rot.set(i, t);
    }
    const times = [...new Set([...rot.values()].flatMap((t) => t.times))].sort((a, b) => a - b);
    const sample = new Map(
      [...rot].map(([i, t]) => [i, new THREE.QuaternionLinearInterpolant(t.times, t.values, 4, new Float32Array(4))]),
    );
    const out = target.names.map(() => [] as number[]);
    const animated = target.names.map((_, ti) => {
      // A target bone moves if it or anything above it in the source is animated.
      for (let s = pair[ti]; s >= 0; s = source.parent[s]) if (rot.has(s)) return true;
      return false;
    });

    for (const time of times) {
      const sLocal = sRest.map((q, i) => {
        const f = sample.get(i);
        if (!f) return q;
        const v = f.evaluate(time) as ArrayLike<number>;
        return new THREE.Quaternion(v[0], v[1], v[2], v[3]).normalize();
      });
      const sWorld = worlds(source, sLocal, id);
      const tWorld: THREE.Quaternion[] = [];
      target.names.forEach((_, ti) => {
        const s = pair[ti];
        const p = target.parent[ti];
        const parentWorld = p < 0 ? targetRoot : tWorld[p];
        if (s < 0) {
          tWorld[ti] = parentWorld.clone().multiply(tRest[ti]);
          return;
        }
        // The source bone's turn from the shared pose, applied to the target bone's rest.
        tWorld[ti] = sWorld[s].clone().multiply(refInv[s]).multiply(tRestWorld[ti]);
        const local = parentWorld.clone().invert().multiply(tWorld[ti]);
        const prev = out[ti].length ? out[ti].slice(-4) : null;
        // Keep neighbouring keys on one hemisphere, so slerp takes the short way.
        if (prev && prev[0] * local.x + prev[1] * local.y + prev[2] * local.z + prev[3] * local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
        out[ti].push(local.x, local.y, local.z, local.w);
      });
    }

    const tracks: ClipTrack[] = [];
    for (const t of clip.tracks) if (t.type !== 'quaternion') tracks.push(t);
    target.names.forEach((n, ti) => {
      if (pair[ti] >= 0 && animated[ti] && out[ti].length) tracks.push({ name: `${n}.quaternion`, type: 'quaternion', times, values: out[ti] });
    });
    return { ...clip, tracks };
  });
}
