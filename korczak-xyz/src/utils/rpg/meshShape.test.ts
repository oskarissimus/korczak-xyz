import { describe, expect, it } from 'vitest';

import { cardShare, floorTriangles, glbTriangles, isCard } from './meshShape';
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

/** A small box (a thing) standing in the middle of a unit footprint, `y` its bottom and `t` its top. */
function thing(y: number, t: number, w = 0.25): number[][][] {
  return [
    [[-w, y, w], [w, y, w], [w, t, w], [-w, t, w]],
    [[-w, y, -w], [-w, t, -w], [w, t, -w], [w, y, -w]],
    [[w, y, -w], [w, t, -w], [w, t, w], [w, y, w]],
    [[-w, y, -w], [-w, y, w], [-w, t, w], [-w, t, -w]],
    [[-w, t, -w], [-w, t, w], [w, t, w], [w, t, -w]],
    [[-w, y, -w], [w, y, -w], [w, y, w], [-w, y, w]],
  ];
}
/** A sheet across the whole unit footprint at height `y`, both ways round, `gap` between its faces. */
function sheet(y: number, gap = 0.003): number[][][] {
  return [
    [[-h, y, -h], [-h, y, h], [h, y, h], [h, y, -h]],
    [[-h, y - gap, -h], [h, y - gap, -h], [h, y - gap, h], [-h, y - gap, h]],
  ];
}
const tris = (quads: number[][][]) => glbTriangles(makeGlb(quads))!;

describe('floorTriangles', () => {
  it('finds the black square under a flat thing, and only it', () => {
    const t = tris([...sheet(-0.08), ...thing(-0.077, 0.09)]);
    // The sheet's four triangles, and the thing's underside lying on it.
    expect(floorTriangles(t).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 14, 15]);
  });

  it('finds it through the middle of a thing, as under the canister', () => {
    const t = tris([...thing(-0.16, 0.16), ...sheet(0.0)]);
    expect(floorTriangles(t).sort((a, b) => a - b)).toEqual([12, 13, 14, 15]);
  });

  it('finds it written once, facing down', () => {
    expect(floorTriangles(tris([sheet(-0.08)[1], ...thing(-0.077, 0.09)]))).toContain(0);
  });

  it('leaves a box alone: its top and bottom are its own', () => {
    expect(floorTriangles(tris(box))).toEqual([]);
  });

  it('leaves a sheet alone that is the thing itself: a mat, a lid as wide as the chest', () => {
    expect(floorTriangles(tris([...sheet(0.1), ...thing(-0.5, 0.1, 0.5)]))).toEqual([]);
  });

  it('leaves a small thing with no floor alone', () => {
    expect(floorTriangles(tris(thing(-0.1, 0.1)))).toEqual([]);
  });
});
