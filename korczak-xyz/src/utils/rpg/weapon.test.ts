import { describe, expect, it } from 'vitest';

import { WEAPON_LENGTH, weaponAxis, weaponGrip, weaponLength, weaponLook, weaponPrompt } from './weapon';

describe('weaponLength', () => {
  it('falls back without a length and clamps a silly one', () => {
    expect(weaponLength(undefined)).toBe(WEAPON_LENGTH.fallback);
    expect(weaponLength({})).toBe(WEAPON_LENGTH.fallback);
    expect(weaponLength({ weaponLength: 0.05 })).toBe(WEAPON_LENGTH.min);
    expect(weaponLength({ weaponLength: 9 })).toBe(WEAPON_LENGTH.max);
    expect(weaponLength({ weaponLength: 0.8 })).toBe(0.8);
  });
});

describe('weaponLook', () => {
  it("uses the world's own line", () => {
    expect(weaponLook({ weapon: ' a rusted wrench ', player: 'a mechanic', tech: '' })).toBe('a rusted wrench');
  });
  it('guesses from the player in a world from before it', () => {
    const look = weaponLook({ player: 'a salvager of the drowned city', tech: 'steam and clockwork' });
    expect(look).toContain('salvager of the drowned city');
    expect(look).toContain('steam and clockwork');
  });
});

describe('weaponPrompt', () => {
  it('asks for one upright weapon, grip at the bottom, on white', () => {
    const p = weaponPrompt('a bone club studded with teeth.', { accent: 'teal' });
    expect(p).toContain('a bone club studded with teeth.');
    expect(p).not.toContain('teeth..');
    expect(p).toContain('teal');
    expect(p).toMatch(/upright/);
    expect(p).toMatch(/handle at the bottom/);
    expect(p).toMatch(/white background/);
  });
});

describe('weaponGrip', () => {
  it('closes a hand above the pommel, or a third up a polearm', () => {
    expect(weaponGrip(1)).toBeCloseTo(0.12);
    expect(weaponGrip(0.3)).toBeCloseTo(0.075);
    expect(weaponGrip(2)).toBeCloseTo(0.66);
  });
});

describe('weaponAxis', () => {
  it('keeps Y for an upright weapon, even a wide-headed axe', () => {
    expect(weaponAxis({ x: 0.2, y: 1, z: 0.1 })).toBe(1);
    expect(weaponAxis({ x: 0.9, y: 1, z: 0.2 })).toBe(1);
  });
  it('finds the length of one that came back lying down', () => {
    expect(weaponAxis({ x: 1, y: 0.2, z: 0.1 })).toBe(0);
    expect(weaponAxis({ x: 0.1, y: 0.2, z: 1 })).toBe(2);
  });
});
