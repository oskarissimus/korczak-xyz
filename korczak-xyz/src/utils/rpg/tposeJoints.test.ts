import { describe, expect, it } from 'vitest';

import { tPoseJoints } from './tposeJoints';

/** A box's surface as points every 1 cm, the way a mesh's vertices cover a body. */
function box(out: number[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const s = 0.01;
  for (let x = x0; x <= x1 + 1e-9; x += s)
    for (let y = y0; y <= y1 + 1e-9; y += s)
      for (let z = z0; z <= z1 + 1e-9; z += s) {
        const edge = [x - x0 < s, x1 - x < s, y - y0 < s, y1 - y < s, z - z0 < s, z1 - z < s].some(Boolean);
        if (edge) out.push(x, y, z);
      }
}

/** A blocky 1.8 m person in a T-pose: legs apart to the crotch at 0.85 m, arms out at 1.42 m. */
function person({ skirt = false } = {}) {
  const p: number[] = [];
  box(p, -0.17, 0.17, 0.85, 1.48, -0.1, 0.1); // torso
  box(p, -0.06, 0.06, 1.48, 1.56, -0.05, 0.05); // neck
  box(p, -0.09, 0.09, 1.56, 1.8, -0.1, 0.1); // head
  box(p, 0.17, 0.8, 1.38, 1.46, -0.04, 0.04); // left arm
  box(p, -0.8, -0.17, 1.38, 1.46, -0.04, 0.04); // right arm
  box(p, 0.04, 0.16, 0.0, 0.85, -0.06, 0.06); // left leg
  box(p, -0.16, -0.04, 0.0, 0.85, -0.06, 0.06); // right leg
  if (skirt) box(p, -0.25, 0.25, 0.3, 0.9, -0.16, 0.16);
  return new Float32Array(p);
}

describe('tPoseJoints', () => {
  it('finds the armpit, and puts elbow and wrist along the arm at its height', () => {
    const { joints } = tPoseJoints(person(), 1.8);
    expect(joints.LeftArm[0]).toBeGreaterThan(0.1);
    expect(joints.LeftArm[0]).toBeLessThan(0.2);
    expect(joints.RightArm[0]).toBeLessThan(-0.1);
    for (const j of ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightForeArm']) expect(joints[j][1]).toBeCloseTo(1.42, 1);
    expect(joints.LeftForeArm[0]).toBeGreaterThan(joints.LeftArm[0]);
    expect(joints.LeftHand[0]).toBeGreaterThan(joints.LeftForeArm[0]);
    expect(joints.LeftHand[0]).toBeLessThan(0.8);
  });

  it('puts the legs’ joints inside the legs, the hips just under the crotch it can see', () => {
    const { joints, notes } = tPoseJoints(person(), 1.8);
    expect(notes.join(' ')).toMatch(/legs apart/);
    for (const side of ['Left', 'Right']) {
      const sign = side === 'Left' ? 1 : -1;
      for (const j of ['UpLeg', 'Leg', 'Foot']) {
        expect(sign * joints[side + j][0]).toBeGreaterThan(0.03);
        expect(sign * joints[side + j][0]).toBeLessThan(0.17);
      }
    }
    expect(joints.LeftUpLeg[1]).toBeGreaterThan(0.85);
    expect(joints.LeftUpLeg[1]).toBeLessThan(0.98);
    expect(joints.LeftLeg[1]).toBeLessThan(joints.LeftUpLeg[1]);
    expect(joints.LeftFoot[1]).toBeLessThan(joints.LeftLeg[1]);
  });

  it('under a skirt, takes the hips from the template and the feet from the stance', () => {
    const { joints, notes } = tPoseJoints(person({ skirt: true }), 1.8);
    expect(notes.join(' ')).toMatch(/skirt/);
    expect(joints.LeftUpLeg[1]).toBeCloseTo(0.51 * 1.8, 1);
    expect(Math.abs(joints.LeftFoot[0] - 0.1)).toBeLessThan(0.03);
    expect(joints.LeftLeg[0]).toBeGreaterThan(0);
  });

  it('runs the spine up the middle to the neck, and the head to the top', () => {
    const { joints } = tPoseJoints(person(), 1.8);
    const chain = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head'].map((j) => joints[j]);
    for (let i = 1; i < chain.length; i++) expect(chain[i][1]).toBeGreaterThan(chain[i - 1][1]);
    for (const j of chain) expect(Math.abs(j[0])).toBeLessThan(0.02);
    expect(joints.head_end[1]).toBeCloseTo(1.8, 2);
  });

  it('refuses a body with its arms down', () => {
    const p: number[] = [];
    box(p, -0.2, 0.2, 0, 1.8, -0.1, 0.1);
    expect(() => tPoseJoints(new Float32Array(p), 1.8)).toThrow(/T-pose/);
  });
});
