import { describe, expect, it } from 'vitest';

import { cardShare, FLOOR_STANDING, floorTriangles, glbTriangles, isCard } from './meshShape';
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

describe('floorTriangles under what stands', () => {
  it('finds the black square under a tree or a landmark', () => {
    const t = tris([...sheet(-0.5), ...thing(-0.497, 0.5, 0.15)]);
    expect(floorTriangles(t, FLOOR_STANDING)).toContain(0);
  });

  it('leaves a pallet under crates alone: one closed slab, only a little wider than what is on it', () => {
    const slab = thing(-0.5, -0.46, 0.5);
    expect(floorTriangles(tris([...slab, ...thing(-0.46, 0.5, 0.42)]), FLOOR_STANDING)).toEqual([]);
  });

  it('leaves a building on a plinth alone, though its walls are well inside it', () => {
    const plinth = thing(-0.5, -0.46, 0.5);
    expect(floorTriangles(tris([...plinth, ...thing(-0.46, 0.5, 0.3)]), FLOOR_STANDING)).toEqual([]);
  });

  it('finds it through the middle, as through the dead tree whose roots hung below it', () => {
    expect(floorTriangles(tris([...thing(-0.5, 0.5, 0.15), ...sheet(-0.1)]), FLOOR_STANDING)).toContain(12);
  });

  it('leaves a thin slab alone though it is wide: its top and bottom are its thickness apart', () => {
    expect(floorTriangles(tris([...sheet(-0.44, 0.06), ...thing(-0.44, 0.5, 0.15)]), FLOOR_STANDING)).toEqual([]);
  });

  it('leaves a sheet alone that the thing nearly fills', () => {
    expect(floorTriangles(tris([...sheet(-0.5), ...thing(-0.497, 0.5, 0.42)]), FLOOR_STANDING)).toEqual([]);
  });
});
