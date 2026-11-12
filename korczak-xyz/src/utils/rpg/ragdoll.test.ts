import { describe, expect, it } from 'vitest';
import { kick, makeBody, point, stepBody, toppleAngle, type Vec3 } from './ragdoll';

const flat = () => 0;

/** A standing stick figure: feet, knees, hips, chest, head in a column. */
function column() {
  const points: Vec3[] = [
    [0, 0.05, 0],
    [0, 0.5, 0],
    [0, 0.95, 0],
    [0, 1.4, 0],
    [0, 1.7, 0],
  ];
  return makeBody(points, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1]], 0.05);
}

describe('ragdoll', () => {
  it('falls and comes to rest on the ground, not under it', () => {
    const body = column();
    kick(body, 4, [2, 0, 0]);
    for (let t = 0; t < 6 && !body.asleep; t += 1 / 30) stepBody(body, 1 / 30, flat);
    expect(body.asleep).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(point(body, i)[1]).toBeGreaterThanOrEqual(0.05 - 1e-6);
      // Lying down: nothing is still up at a standing height.
      expect(point(body, i)[1]).toBeLessThan(0.4);
    }
  });

  it('keeps its bones their length', () => {
    const body = column();
    kick(body, 3, [0, 0, -3]);
    for (let t = 0; t < 2; t += 1 / 60) stepBody(body, 1 / 60, flat);
    for (const s of body.sticks) {
      const [a, b] = [point(body, s.a), point(body, s.b)];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(s.rest, 1);
    }
  });

  it('falls the way it was struck', () => {
    const body = column();
    kick(body, 4, [0, 0, 3]);
    kick(body, 3, [0, 0, 2]);
    for (let t = 0; t < 3; t += 1 / 30) stepBody(body, 1 / 30, flat);
    expect(point(body, 4)[2]).toBeGreaterThan(0.8);
  });

  it('falls the same at 30 and 144 frames a second', () => {
    const a = column();
    const b = column();
    kick(a, 4, [2, 0, 1]);
    kick(b, 4, [2, 0, 1]);
    for (let i = 0; i < 60; i++) stepBody(a, 1 / 30, flat);
    for (let i = 0; i < 288; i++) stepBody(b, 1 / 144, flat);
    expect(point(a, 4)[0]).toBeCloseTo(point(b, 4)[0], 1);
  });

  it('lies on a slope, over the ground there', () => {
    const slope = (x: number) => x * 0.3;
    const body = column();
    kick(body, 4, [2, 0, 0]);
    for (let t = 0; t < 4; t += 1 / 30) stepBody(body, 1 / 30, slope);
    for (let i = 0; i < 5; i++) {
      const [x, y] = point(body, i);
      expect(y).toBeGreaterThanOrEqual(slope(x) + 0.05 - 1e-6);
    }
  });

  it('a limit only pushes apart', () => {
    const body = makeBody(
      [
        [0, 1, 0],
        [1, 1, 0],
      ],
      [[0, 1, 0.5, Infinity]],
      0,
    );
    kick(body, 1, [3, 0, 0]);
    for (let i = 0; i < 10; i++) stepBody(body, 1 / 60, () => -10);
    expect(point(body, 1)[0] - point(body, 0)[0]).toBeGreaterThan(1.2);
  });
});

describe('toppleAngle', () => {
  it('starts upright, tips over and lands flat', () => {
    expect(toppleAngle(0, 1.8)).toBeLessThan(0.1);
    expect(toppleAngle(0.3, 1.8)).toBeLessThan(Math.PI / 2);
    expect(toppleAngle(3, 1.8)).toBeCloseTo(Math.PI / 2, 2);
  });
});
