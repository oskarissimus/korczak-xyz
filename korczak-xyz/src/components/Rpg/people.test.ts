import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { parseDonor } from '../../utils/rpg/selfRig';
import { armsOut, heads, tPoseDonor } from './people';

/** Boxes merged into one geometry, each as [x, y, width, height] with y the bottom. */
function body(...boxes: [number, number, number, number][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const [x, y, w, h] of boxes) {
    const g = new THREE.BoxGeometry(w, h, 0.2, 4, 8, 1).translate(x, y + h / 2, 0);
    positions.push(...(g.attributes.position.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

const person = (x: number, h = 1.8): [number, number, number, number][] => [
  [x - 0.12, 0, 0.12, h * 0.47], // legs, wide apart
  [x + 0.12, 0, 0.12, h * 0.47],
  [x, h * 0.45, 0.4, h * 0.38], // torso
  [x, h * 0.83, 0.22, h * 0.17], // head
];

describe('heads', () => {
  it('counts one for a person, however wide the stance or the arms', () => {
    expect(heads(body(...person(0)))).toBe(1);
    const tPose: [number, number, number, number] = [0, 1.8 * 0.76, 1.8, 0.1];
    expect(heads(body(...person(0), tPose, [-0.6, 0, 0.12, 0.85], [0.6, 0, 0.12, 0.85]))).toBe(1);
  });

  it('counts two for two people side by side, even of different heights', () => {
    expect(heads(body(...person(-0.4), ...person(0.4)))).toBe(2);
    expect(heads(body(...person(-0.4), ...person(0.4, 1.65)))).toBe(2);
  });
});

describe('tPoseDonor', () => {
  const file = readFileSync(new URL('../../assets/rpg/people/donor_male.bin', import.meta.url));
  const donor = parseDonor(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const at = (d: typeof donor, name: string) => d.bones.find((b) => b.name === name)!.world;

  it('holds both arms straight out at the shoulders, and leaves the rest of the body where it was', () => {
    const t = tPoseDonor(donor);
    for (const [arm, hand, side] of [['LeftArm', 'LeftHand', 1], ['RightArm', 'RightHand', -1]] as const) {
      const shoulder = at(t, arm);
      const h = at(t, hand);
      expect(Math.abs(h[1] - shoulder[1])).toBeLessThan(0.02);
      expect((h[0] - shoulder[0]) * side).toBeGreaterThan(0.35);
    }
    for (const still of ['Head', 'Hips', 'LeftFoot'])
      at(t, still).forEach((v, a) => expect(v).toBeCloseTo(at(donor, still)[a], 3));
  });

  it('carries the points with the arms: the posed body is most of its height across, and reads as arms out', () => {
    const t = tPoseDonor(donor);
    const width = (p: Float32Array) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < p.length; i += 3) (lo = Math.min(lo, p[i])), (hi = Math.max(hi, p[i]));
      return hi - lo;
    };
    expect(width(t.positions)).toBeGreaterThan(1.3);
    expect(width(donor.positions)).toBeLessThan(0.9);
    const geometry = (p: Float32Array) => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p, 3));
    expect(armsOut(geometry(t.positions))).toBe(true);
    expect(armsOut(geometry(donor.positions))).toBe(false);
  });
});
