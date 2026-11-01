import { describe, expect, it } from 'vitest';

import { jointsFromPicture } from './pictureJoints';

/** A closed box as twelve triangles, positions and index. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const positions: number[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) positions.push(x, y, z);
  // Corner i: x = i>>2, y = (i>>1)&1, z = i&1.
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const index = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { positions: new Float32Array(positions), index };
}

describe('jointsFromPicture', () => {
  // A 1 m wide, 2 m tall block from z -0.1 to 0.3, drawn into a 100×200 picture's whole frame.
  const { positions, index } = box(-0.5, 0.5, 0, 2, -0.1, 0.3);
  const picture = { width: 100, height: 200, silhouette: { x0: 0, y0: 0, x1: 100, y1: 200 } };

  it('maps the picture box onto the mesh box, y flipped, and takes depth from the middle of the section', () => {
    const j = jointsFromPicture({ shoulderL: [75, 50], hipR: [25, 100] }, picture, positions, { index });
    expect(j.shoulderL![0]).toBeCloseTo(0.25);
    expect(j.shoulderL![1]).toBeCloseTo(1.5);
    expect(j.shoulderL![2]).toBeCloseTo(0.1);
    expect(j.hipR![0]).toBeCloseTo(-0.25);
    expect(j.hipR![1]).toBeCloseTo(1);
  });

  it('pulls a detected ankle down to just above the sole', () => {
    const j = jointsFromPicture({ ankleL: [60, 170] }, picture, positions, { index });
    expect(j.ankleL![1]).toBeCloseTo(0.09);
  });

  it('puts a straight leg’s knee between the hip’s and the ankle’s depth', () => {
    const j = jointsFromPicture({ hipL: [60, 100], kneeL: [60, 150], ankleL: [60, 190] }, picture, positions, { index });
    expect(j.kneeL![2]).toBeCloseTo(0.1);
  });
});
