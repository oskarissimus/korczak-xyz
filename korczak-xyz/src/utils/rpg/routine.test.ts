import { describe, expect, it } from 'vitest';

import { HALT, REACH, Routine, tradeOf, type Spot, type Surroundings } from './routine';

const open = (spots: Spot[] = []): Surroundings => ({ spots: () => spots, clear: () => true });

/** Runs a routine for `seconds` in steps of a frame, collecting what it played. */
function run(r: Routine, around: Surroundings, seconds: number) {
  const clips = new Set<string>();
  const strikes: string[] = [];
  const at: { x: number; z: number }[] = [];
  for (let t = 0; t < seconds; t += 1 / 30) {
    const act = r.tick(1 / 30, around);
    clips.add(act.clip);
    if (act.strike) strikes.push(act.strike.clip);
    at.push({ x: r.x, z: r.z });
  }
  return { clips, strikes, at };
}

describe('tradeOf', () => {
  it('reads the trade off how a character is described', () => {
    expect(tradeOf('a burly blacksmith in a leather apron')).toBe('smith');
    expect(tradeOf('a grizzled guard captain in chainmail')).toBe('guard');
    expect(tradeOf('an old herbalist with a basket')).toBe('gatherer');
    expect(tradeOf('a plump innkeeper')).toBe('trader');
    expect(tradeOf('a hooded priestess')).toBe('holy');
    expect(tradeOf('a woodcutter with a red beard')).toBe('woodcutter');
    expect(tradeOf('a girl in a blue dress')).toBe('idler');
  });

  it('takes the appearance before the voice, and never the hero', () => {
    expect(tradeOf('a tall merchant\nan old voice, like a priest')).toBe('trader');
    expect(tradeOf('\nspeaks warily to the hunter')).toBe('idler');
  });
});

describe('Routine', () => {
  it('works at a spot that suits the trade, and strikes while there', () => {
    const anvil: Spot = { x: 4, z: 0, r: 1, kind: 'house' };
    const r = new Routine('Borys', 'a blacksmith', { x: 0, z: 0 });
    const { clips, strikes, at } = run(r, open([anvil, { x: -4, z: 0, r: 1, kind: 'tree' }]), 90);
    expect(clips.has('Walk_Loop')).toBe(true);
    expect(strikes).toContain('Sword_Attack');
    // At arm's length beside the house at some point, never at the tree.
    expect(at.some((p) => Math.abs(Math.hypot(p.x - anvil.x, p.z - anvil.z) - 1.7) < 0.05)).toBe(true);
  });

  it('never wanders further than its reach from home', () => {
    const r = new Routine('Ania', 'a girl', { x: 10, z: -5 });
    const { at } = run(r, open(), 300);
    for (const p of at) expect(Math.hypot(p.x - 10, p.z + 5)).toBeLessThanOrEqual(REACH + 0.01);
    expect(new Set(at.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`)).size).toBeGreaterThan(10);
  });

  it('does not walk where the way is blocked', () => {
    const r = new Routine('Ania', 'a girl', { x: 0, z: 0 });
    const { at } = run(r, { spots: () => [], clear: () => false }, 60);
    for (const p of at) expect(p).toEqual({ x: 0, z: 0 });
  });

  it('a guard walks a round and stands watch in a guard stance', () => {
    const r = new Routine('Wit', 'a guard', { x: 0, z: 0 });
    const { clips, at } = run(r, open(), 120);
    expect(clips.has('Sword_Idle')).toBe(true);
    const corners = new Set(at.filter((p) => Math.hypot(p.x, p.z) > REACH * 0.69).map((p) => `${Math.sign(p.x)},${Math.sign(p.z)}`));
    expect(corners.size).toBe(4);
  });

  it('stands where it is put, and lingers after a talk', () => {
    const r = new Routine('Ania', 'a girl', { x: 0, z: 0 });
    run(r, open(), 30);
    r.setHome({ x: 50, z: 50 });
    expect([r.x, r.z]).toEqual([50, 50]);
    r.linger(4);
    const { at } = run(r, open(), 3.9);
    for (const p of at) expect(p).toEqual({ x: 50, z: 50 });
    expect(HALT).toBeGreaterThan(3.2);
  });
});
