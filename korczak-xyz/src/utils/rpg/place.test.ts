import { describe, expect, it } from 'vitest';

import {
  DIRECTIONS,
  LANDMARK_HEIGHT,
  LANDMARK_REACH,
  MAX_PARTS,
  PLACE_SPACING,
  freeSlot,
  parseLandmark,
  parseLook,
  parsePlace,
  placePosition,
} from './place';

describe('placePosition', () => {
  it('puts north at −z and east at +x, far beyond near', () => {
    expect(placePosition({ direction: 'north', distance: 'far' })).toEqual({ x: 0, z: -85 });
    expect(placePosition({ direction: 'east', distance: 'near' })).toEqual({ x: 50, z: -0 });
  });

  it('keeps every place clear of the village', () => {
    for (const direction of DIRECTIONS) {
      const { x, z } = placePosition({ direction, distance: 'near' });
      expect(Math.hypot(x, z)).toBeGreaterThan(45);
    }
  });
});

describe('parsePlace', () => {
  it('fills features and colour from the biome', () => {
    expect(parsePlace({ name: 'Bagno', direction: 'south', biome: 'swamp' })).toMatchObject({
      distance: 'far',
      features: ['dead_trees', 'water', 'mushrooms'],
      groundColor: '#4a4f2a',
    });
  });

  it('caps the features at four and drops repeats', () => {
    const place = parsePlace({
      name: 'X',
      direction: 'west',
      biome: 'forest',
      features: ['pines', 'pines', 'rocks', 'huts', 'campfire', 'graves'],
    });
    expect(place?.features).toEqual(['pines', 'rocks', 'huts', 'campfire']);
  });

  it('accepts "rocky hills" for rocky_hills', () => {
    expect(parsePlace({ name: 'X', direction: 'west', biome: 'Rocky Hills' })?.biome).toBe('rocky_hills');
  });
});

describe('parseLook', () => {
  it('defaults sensibly when the model says nothing', () => {
    expect(parseLook(undefined, 'collect')).toEqual({ shape: 'crystal', color: '#9be36b', size: 1 });
    expect(parseLook({ color: 'red' }, 'slay')).toEqual({ shape: 'humanoid', color: '#3f5a4a', size: 1 });
  });
});

describe('freeSlot', () => {
  it('moves a place off one already standing, and leaves a clear one alone', () => {
    const keep = parsePlace({ name: 'Keep', direction: 'north', distance: 'far', biome: 'ruins' })!;
    const clash = parsePlace({ name: 'Hill', direction: 'north', distance: 'far', biome: 'graveyard' })!;
    const moved = freeSlot(clash, [keep]);
    const a = placePosition(moved);
    const b = placePosition(keep);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(PLACE_SPACING);
    const south = parsePlace({ name: 'Bog', direction: 'south', biome: 'swamp' })!;
    expect(freeSlot(south, [keep])).toBe(south);
  });
});

describe('parseLandmark', () => {
  it('keeps the parts it can build and clamps them to a building beside the place', () => {
    const l = parseLandmark({
      name: 'the old mill',
      parts: [
        { shape: 'Cylinder', size: [5, 7, 5], at: [0, 0, 0], material: 'wall' },
        { shape: 'box', size: [400, 90, 1], at: [50, -3, 2], material: 'unobtainium', spin: 'Z', color: '#ABCDEF' },
        { shape: 'teapot', size: [1, 1, 1], at: [0, 0, 0] },
        'a door',
      ],
    });
    expect(l?.name).toBe('the old mill');
    expect(l?.parts).toHaveLength(2);
    expect(l?.parts[0]).toMatchObject({ shape: 'cylinder', size: [5, 7, 5], material: 'wall', spin: null, color: null });
    const big = l!.parts[1];
    expect(big.size).toEqual([2 * LANDMARK_REACH, LANDMARK_HEIGHT, 1]);
    expect(big.at).toEqual([LANDMARK_REACH, 0, 2]);
    expect(big).toMatchObject({ material: 'wall', spin: 'z', color: '#abcdef' });
  });

  it('is no landmark without a part, and a place keeps it', () => {
    expect(parseLandmark({ name: 'x', parts: [] })).toBeNull();
    const place = parsePlace({
      name: 'Młyn',
      direction: 'north',
      biome: 'meadow',
      landmark: { name: 'młyn', parts: [{ shape: 'box', size: [4, 4, 4], at: [0, 0, 0], material: 'wood' }] },
    });
    expect(place?.landmark?.parts).toHaveLength(1);
    expect(parsePlace({ name: 'Łąka', direction: 'north', biome: 'meadow' })?.landmark).toBeNull();
  });

  it('caps the parts and keeps a part on top under the height limit', () => {
    const parts = Array.from({ length: 80 }, () => ({ shape: 'box', size: [1, 10, 1], at: [0, 20, 0] }));
    const l = parseLandmark({ parts })!;
    expect(l.parts).toHaveLength(MAX_PARTS);
    expect(l.parts[0].at[1] + l.parts[0].size[1]).toBeLessThanOrEqual(LANDMARK_HEIGHT);
  });
});
