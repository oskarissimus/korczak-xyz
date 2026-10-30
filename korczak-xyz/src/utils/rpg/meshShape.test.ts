import { describe, expect, it } from 'vitest';

import { cardShare, glbTriangles, isCard } from './meshShape';
import { box, crossed, makeGlb } from './meshShape.fixtures';

const h = 0.5;

describe('isCard', () => {
  it('reads the triangles of a plain GLB', () => {
    expect(glbTriangles(makeGlb(box))?.length).toBe(6 * 2 * 9);
  });

  it('knows crossed sheets for a card', () => {
    expect(cardShare(glbTriangles(makeGlb(crossed))!)).toBeCloseTo(2);
    expect(isCard(makeGlb(crossed))).toBe(true);
  });

  it('leaves a box alone: its walls are on the outside', () => {
    expect(isCard(makeGlb(box))).toBe(false);
  });

  it('leaves a table top alone: a horizontal sheet through the middle is not a card', () => {
    const top = [[[-h, 0, -h], [-h, 0, h], [h, 0, h], [h, 0, -h]]];
    expect(isCard(makeGlb([...box, ...top]))).toBe(false);
  });

  it('leaves a partition alone when it is a small part of the box', () => {
    const wall = [[[-0.1, -h, 0], [0.1, -h, 0], [0.1, -0.2, 0], [-0.1, -0.2, 0]]];
    expect(isCard(makeGlb([...box, ...wall]))).toBe(false);
  });

  it('says no when it cannot read the file', () => {
    expect(isCard(new TextEncoder().encode('{"model_mesh":{}}').buffer as ArrayBuffer)).toBe(false);
    expect(isCard(new ArrayBuffer(0))).toBe(false);
  });
});
