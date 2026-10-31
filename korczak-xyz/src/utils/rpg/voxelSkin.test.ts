import { describe, expect, it } from 'vitest';

import { voxelSkin, type SkinBone } from './voxelSkin';

/** Closed boxes as one triangle list, the way a mesh made of separate parts comes. */
function boxes(list: [number, number, number, number, number, number][]) {
  const positions: number[] = [];
  const index: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of list) {
    const o = positions.length / 3;
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) positions.push(x, y, z);
    // Corner k is (x, y, z) by bits 4, 2, 1.
    const faces = [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ];
    for (const [a, b, c, d] of faces) index.push(o + a, o + b, o + c, o + a, o + c, o + d);
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

describe('voxelSkin', () => {
  // An upside-down U: two legs 4 cm apart, joined at the top. Each leg's bone runs down its middle.
  const { positions, index } = boxes([
    [0, 0, 0, 0.04, 0.5, 0.04],
    [0.08, 0, 0, 0.12, 0.5, 0.04],
    [0, 0.46, 0, 0.12, 0.5, 0.04],
  ]);
  const bones: SkinBone[] = [
    { bone: 7, from: [0.02, 0.48, 0.02], to: [0.02, 0, 0.02] },
    { bone: 9, from: [0.1, 0.48, 0.02], to: [0.1, 0, 0.02] },
  ];
  const skin = voxelSkin(positions, index, bones, { voxel: 0.01, falloff: 0.05 });
  const weightOf = (v: number, bone: number) => {
    let w = 0;
    for (let a = 0; a < 4; a++) if (skin.skinIndex[v * 4 + a] === bone) w += skin.skinWeight[v * 4 + a];
    return w;
  };
  const vertexAt = (x: number, y: number) => {
    for (let i = 0; i < positions.length / 3; i++) if (Math.abs(positions[i * 3] - x) < 1e-6 && Math.abs(positions[i * 3 + 1] - y) < 1e-6) return i;
    throw new Error('no vertex there');
  };

  it('answers four bones a vertex, by the skeleton’s own indices, summing to one', () => {
    for (let i = 0; i < positions.length / 3; i++) {
      const sum = [0, 1, 2, 3].reduce((s, a) => s + skin.skinWeight[i * 4 + a], 0);
      expect(sum).toBeCloseTo(1, 5);
      for (let a = 0; a < 4; a++) if (skin.skinWeight[i * 4 + a] > 0) expect([7, 9]).toContain(skin.skinIndex[i * 4 + a]);
    }
  });

  it('measures through the body, so a leg’s foot is not shared with the other leg 4 cm away through the air', () => {
    // The inner corner of the right foot is 6 cm from the left bone straight across, ~1 m round the U.
    expect(weightOf(vertexAt(0.08, 0), 9)).toBeGreaterThan(0.99);
    expect(weightOf(vertexAt(0.04, 0), 7)).toBeGreaterThan(0.99);
  });

  it('blends where the two bones meet, at the top of the U', () => {
    const top = weightOf(vertexAt(0, 0.5), 7);
    expect(top).toBeGreaterThan(0.5);
    expect(top).toBeLessThan(1);
  });
});
