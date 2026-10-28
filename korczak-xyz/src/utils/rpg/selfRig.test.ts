import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDonor, selfRig } from './selfRig';

const read = (name: string) => {
  const b = readFileSync(new URL(`../../assets/rpg/people/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('selfRig', () => {
  const donor = parseDonor(read('donor_male.bin'));

  it('reads a donor: Meshy’s 24 bones, parents first, and weights that sum to one', () => {
    expect(donor.bones).toHaveLength(24);
    expect(donor.bones[0].name).toBe('Hips');
    donor.bones.forEach((b, i) => expect(b.parent).toBeLessThan(i));
    const n = donor.positions.length / 3;
    expect(n).toBeGreaterThan(1000);
    for (let i = 0; i < n; i += 97) {
      const sum = [0, 1, 2, 3].reduce((s, a) => s + donor.skinWeight[i * 4 + a], 0);
      expect(sum).toBeCloseTo(1, 1);
    }
  });

  it('rigs a body like the donor’s, in TRELLIS’s unit box, with the donor’s joints and weights', () => {
    // The donor itself, squeezed into a unit box the way TRELLIS answers, a little stockier.
    const p = donor.positions;
    const target = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      target[i] = p[i] * 0.62;
      target[i + 1] = p[i + 1] * 0.55 - 0.5;
      target[i + 2] = p[i + 2] * 0.6;
    }
    const height = 1.75;
    const rig = selfRig(donor, target, height);
    expect(rig.positions).toHaveLength(p.length);
    expect(rig.joints).toHaveLength(donor.bones.length * 3);

    // Feet on the ground, the head at the height asked for.
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < rig.positions.length; i += 3) {
      minY = Math.min(minY, rig.positions[i]);
      maxY = Math.max(maxY, rig.positions[i]);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(height, 5);

    // The hips stay about where the donor’s are, as a share of the height; a hand stays beside the hip.
    const at = (name: string) => {
      const b = donor.bones.findIndex((x) => x.name === name);
      return [rig.joints[b * 3], rig.joints[b * 3 + 1], rig.joints[b * 3 + 2]];
    };
    const donorHeight = Math.max(...Array.from({ length: p.length / 3 }, (_, i) => p[i * 3 + 1]));
    expect(at('Hips')[1] / height).toBeCloseTo(donor.bones[0].world[1] / donorHeight, 1);
    expect(at('LeftHand')[0]).toBeGreaterThan(0.1);
    expect(at('RightHand')[0]).toBeLessThan(-0.1);
    expect(at('Head')[1]).toBeGreaterThan(at('neck')[1]);

    // Most vertices take the bone that moved them on the donor.
    let same = 0;
    const n = p.length / 3;
    for (let i = 0; i < n; i++) {
      let top = 0;
      for (let a = 1; a < 4; a++) if (donor.skinWeight[i * 4 + a] > donor.skinWeight[i * 4 + top]) top = a;
      if (rig.skinIndex[i * 4] === donor.skinIndex[i * 4 + top]) same++;
    }
    expect(same / n).toBeGreaterThan(0.8);
    for (let i = 0; i < n; i += 53) {
      const sum = [0, 1, 2, 3].reduce((s, a) => s + rig.skinWeight[i * 4 + a], 0);
      expect(sum).toBeCloseTo(1, 4);
    }
  });
});
