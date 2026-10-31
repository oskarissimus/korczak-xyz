import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { aimedLike, retargetClips, type PoseSkeleton } from './retarget';

/** Where each bone of `s` stands with these local rotations. */
function where(s: PoseSkeleton, local: number[][]): THREE.Vector3[] {
  const m: THREE.Matrix4[] = [];
  return s.names.map((_, i) => {
    const own = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(s.offset![i]), new THREE.Quaternion().fromArray(local[i]), new THREE.Vector3(1, 1, 1));
    m[i] = s.parent[i] < 0 ? own : m[s.parent[i]].clone().multiply(own);
    return new THREE.Vector3().setFromMatrixPosition(m[i]);
  });
}

describe('retargetClips', () => {
  // An arm held straight out along +x: shoulder, elbow, hand. The source's bones point their y axes
  // along the arm; the target's are the same arm with every bone rolled 90° about its own length,
  // and in centimetres — Meshy picking other axes for the same body.
  const along = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const source: PoseSkeleton = {
    names: ['LeftArm', 'LeftForeArm', 'LeftHand'],
    parent: [-1, 0, 1],
    local: [along.toArray() as [number, number, number, number], [0, 0, 0, 1], [0, 0, 0, 1]],
    offset: [
      [0, 1.4, 0],
      [0, 0.3, 0],
      [0, 0.25, 0],
    ],
  };
  const rolledWorld = along.clone().multiply(roll);
  const target: PoseSkeleton = {
    names: source.names,
    parent: source.parent,
    local: [rolledWorld.toArray() as [number, number, number, number], [0, 0, 0, 1], [0, 0, 0, 1]],
    offset: [
      [0, 140, 0],
      [0, 30, 0],
      [0, 25, 0],
    ],
  };
  // The elbow bends 90° about the source forearm's own x axis.
  const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).toArray();
  const clip = {
    name: 'Bend',
    duration: 1,
    tracks: [{ name: 'LeftForeArm.quaternion', type: 'quaternion' as const, times: [0, 1], values: [0, 0, 0, 1, ...bend] }],
  };
  const handDir = (s: PoseSkeleton, local: number[][]) => {
    const p = where(s, local);
    return p[2].clone().sub(p[1]).normalize();
  };
  const wanted = handDir(source, [source.local[0], bend, [0, 0, 0, 1]]);

  it('bends the elbow in the plane the clip was made in, whatever way the target’s bones are rolled', () => {
    const [moved] = retargetClips([clip], source, aimedLike(source, target), target);
    const track = moved.tracks.find((t) => t.name === 'LeftForeArm.quaternion')!;
    const end = track.values.slice(4, 8);
    const got = handDir(target, [target.local[0], end, [0, 0, 0, 1]]);
    expect(got.distanceTo(wanted)).toBeLessThan(1e-4);
  });

  it('where copying the rotation as it is bends it 90° off', () => {
    const got = handDir(target, [target.local[0], bend, [0, 0, 0, 1]]);
    expect(got.angleTo(wanted)).toBeGreaterThan(Math.PI / 2 - 0.01);
  });

  it('stands the source the way the target rests: an arm hanging down aimed out sideways', () => {
    const hanging: PoseSkeleton = { ...source, local: [new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)).toArray() as [number, number, number, number], [0, 0, 0, 1], [0, 0, 0, 1]] };
    const ref = aimedLike(hanging, target);
    const p = where(ref, ref.local);
    expect(p[1].clone().sub(p[0]).normalize().x).toBeCloseTo(1, 4);
  });
});
