import { describe, expect, it } from 'vitest';

import { BITE_SECONDS, DEATH_SECONDS, gone, newCreature, pose, RUN_SPEED, step } from './creature';

/** Runs `seconds` at `speed`, collecting each frame's pose. */
function run(shape: 'beast' | 'blob', seconds: number, speed: number, height = 1) {
  const s = newCreature();
  const poses = [];
  for (let t = 0; t < seconds; t += 1 / 30) {
    step(s, 1 / 30, speed, height);
    poses.push(pose(s, shape, height));
  }
  return { s, poses };
}

describe('creature motion', () => {
  it('a beast swings its legs harder running than standing, and keeps its feet on the ground', () => {
    const still = run('beast', 2, 0).poses;
    const running = run('beast', 2, RUN_SPEED).poses;
    expect(Math.max(...running.map((p) => p.stride))).toBeGreaterThan(3 * Math.max(...still.map((p) => p.stride)));
    expect(Math.max(...running.map((p) => p.lift))).toBeLessThan(0.1);
    expect(Math.max(...still.map((p) => p.lift))).toBe(0);
  });

  it('a blob hops off the ground on the run and swings no legs', () => {
    const { poses } = run('blob', 2, RUN_SPEED);
    expect(Math.max(...poses.map((p) => p.lift))).toBeGreaterThan(0.2);
    expect(poses.every((p) => p.stride === 0)).toBe(true);
    expect(Math.min(...poses.map((p) => p.squash))).toBeLessThan(0.9);
  });

  it('a bite lunges forward nose down and is over after its time', () => {
    const s = newCreature();
    s.bite = 0;
    step(s, BITE_SECONDS / 2, 0, 1);
    const mid = pose(s, 'beast', 1);
    expect(mid.lunge).toBeGreaterThan(0.3);
    expect(mid.pitch).toBeGreaterThan(0.2);
    step(s, BITE_SECONDS, 0, 1);
    expect(s.bite).toBeNull();
  });

  it('a flinch throws it back', () => {
    const s = newCreature();
    s.flinch = 0.15;
    const p = pose(s, 'beast', 1);
    expect(p.lunge).toBeLessThan(0);
    expect(p.pitch).toBeLessThan(0);
  });

  it('dying, a beast rolls onto its side and sinks, a blob slumps, and both are gone at the end', () => {
    for (const shape of ['beast', 'blob'] as const) {
      const s = newCreature();
      s.death = 0;
      for (let t = 0; t < DEATH_SECONDS - 0.05; t += 1 / 30) step(s, 1 / 30, RUN_SPEED, 1);
      expect(gone(s)).toBe(false);
      const p = pose(s, shape, 1);
      expect(p.sink).toBeGreaterThan(0.8);
      expect(p.stride).toBe(0);
      if (shape === 'beast') expect(p.roll).toBeCloseTo(Math.PI / 2);
      else expect(p.squash).toBeLessThan(0.5);
      step(s, 0.1, 0, 1);
      expect(gone(s)).toBe(true);
    }
  });
});
