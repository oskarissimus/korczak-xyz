import { describe, expect, it } from 'vitest';

import { DIRECTIONS, parseLook, parsePlace, placePosition } from './place';

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
