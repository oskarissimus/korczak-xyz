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
  placeFromMiddles,
  placePosition,
  settleParts,
  type LandmarkPart,
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

describe('placeFromMiddles', () => {
  const hut = {
    name: 'Mszary',
    direction: 'south',
    biome: 'swamp',
    landmark: {
      name: 'chatka na palach',
      parts: [
        { shape: 'cylinder', size: [0.4, 3, 0.4], at: [-2, 1.5, -2], material: 'wood' },
        { shape: 'box', size: [5, 0.3, 5], at: [0, 3.15, 0], material: 'wood' },
        { shape: 'box', size: [4.6, 3, 4.6], at: [0, 4.8, 0], material: 'wall' },
        { shape: 'box', size: [11, 0.6, 0.2], at: [0, 6, 2.8], material: 'wood', spin: 'z' },
        { shape: 'box', size: [2, 4, 1], at: [0, 2, 0], tilt: [0, 90], material: 'stone' },
      ],
    },
  };

  it('stands the hut on its stilts: each part from its middle to its base, a spinning one kept', () => {
    const parts = parsePlace(placeFromMiddles(hut))!.landmark!.parts;
    expect(parts.map((p) => p.at[1])).toEqual([0, 3, 3.3, 6, expect.any(Number)]);
    // Laid on its side about z: the base is half the height along x, not below.
    expect(parts[4].at[0]).toBeCloseTo(2);
    expect(parts[4].at[1]).toBeCloseTo(2);
  });

  it('leaves a place without a landmark alone', () => {
    const meadow = { name: 'Łąka', direction: 'north', biome: 'meadow' };
    expect(placeFromMiddles(meadow)).toBe(meadow);
  });
});

describe('settleParts', () => {
  const part = (p: Partial<LandmarkPart>): LandmarkPart => ({
    shape: 'box',
    size: [1, 1, 1],
    at: [0, 0, 0],
    turn: 0,
    tilt: [0, 0],
    material: 'wood',
    color: null,
    spin: null,
    ...p,
  });

  it("lowers the long house's tilted roof until it lands on what is under it (owner's screenshot)", () => {
    // As stored from the model's answer on 21 Oct 2026, `placeFromMiddles` already applied.
    const parts = [
      part({ size: [12, 0.5, 12], at: [0, 0, 0], material: 'dark' }),
      part({ size: [0.6, 4, 0.6], at: [-4, 0.25, -2] }),
      part({ size: [0.6, 4, 0.6], at: [4, 0.25, -2] }),
      part({ shape: 'wedge', size: [10, 3, 10], at: [0, 3.5904610688211376, 1.486969785011497], tilt: [20, 0], material: 'roof' }),
    ];
    const settled = settleParts(parts);
    expect(settled.slice(0, 3)).toEqual(parts.slice(0, 3));
    const drop = parts[3].at[1] - settled[3].at[1];
    // It hung 1.4 m over the floor at its low edge; it comes down onto the pillars or the floor.
    expect(drop).toBeGreaterThan(0.3);
    expect(drop).toBeLessThan(1.45);
  });

  it('leaves alone what already rests on something, or hangs from it', () => {
    const house = [
      part({ size: [8, 4, 6], at: [0, 0, 0], material: 'wall' }),
      part({ shape: 'wedge', size: [9, 3, 7], at: [0, 4, 0], material: 'roof' }),
      part({ size: [0.8, 2, 0.8], at: [2, 5.5, 0], material: 'stone' }),
      part({ shape: 'cylinder', size: [0.2, 5, 0.2], at: [6, 0, 0] }),
      part({ size: [1, 1.5, 0.05], at: [6.6, 2.5, 0], material: 'cloth' }),
    ];
    expect(settleParts(house)).toEqual(house);
  });

  it('drops a block left in the air to the ground, and keeps sails and glow where they are', () => {
    const parts = [
      part({ size: [2, 2, 2], at: [0, 3, 0] }),
      part({ size: [0.6, 11, 0.2], at: [0, 6, 2.8], spin: 'z' }),
      part({ shape: 'sphere', size: [1, 1, 1], at: [0, 8, 0], material: 'glow' }),
    ];
    const settled = settleParts(parts);
    expect(settled[0].at[1]).toBeCloseTo(0, 5);
    expect(settled[1]).toEqual(parts[1]);
    expect(settled[2]).toEqual(parts[2]);
  });
});
