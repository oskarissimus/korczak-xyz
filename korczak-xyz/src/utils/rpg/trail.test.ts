import { describe, expect, it } from 'vitest';

import { footprints, nearestOnLine, ROAD_START, roadPoints, SQUARE_MIDDLE, trailPoints, TRAIL_MAX, wander } from './trail';

const length = (pts: { x: number; z: number }[]) =>
  pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.z - pts[i].z), 0);

describe('roadPoints', () => {
  it('starts at the edge of the square, stops short of the place, and is the same road every time', () => {
    const a = roadPoints(0, 100, 7, 24);
    expect(a[0].x).toBeCloseTo(0, 6);
    expect(a[0].z).toBeCloseTo(ROAD_START, 6);
    const end = a[a.length - 1];
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.z).toBeCloseTo(76, 6);
    expect(roadPoints(0, 100, 7, 24)).toEqual(a);
  });

  it('winds, but never further out than its swing', () => {
    const road = roadPoints(0, 125, 3, 24);
    const widest = Math.max(...road.map((p) => Math.abs(p.x)));
    expect(widest).toBeGreaterThan(0.5);
    expect(widest).toBeLessThanOrEqual(7.01);
  });
});

describe('trailPoints', () => {
  const road = roadPoints(0, 100, 11, 24);
  const goal = { x: 0, z: 100 };

  it('takes the road when the hunter is near it', () => {
    const trail = trailPoints({ x: 5, z: 10 }, goal, road, 1);
    expect(trail[0]).toEqual({ x: 5, z: 10 });
    expect(trail[trail.length - 1]).toEqual(goal);
    // Once on the road it stays on it to the end.
    const on = trail.findIndex((p) => nearestOnLine(p.x, p.z, road).d < 1e-6);
    expect(on).toBeGreaterThan(0);
    for (const p of trail.slice(on, -1)) expect(nearestOnLine(p.x, p.z, road).d).toBeLessThan(1e-6);
  });

  it('goes across the fields when the road is far away', () => {
    const trail = trailPoints({ x: 60, z: 20 }, goal, road, 1);
    expect(trail[trail.length - 1].x).toBeCloseTo(goal.x, 6);
    expect(trail.slice(1, -1).some((p) => nearestOnLine(p.x, p.z, road).d > 1)).toBe(true);
  });

  it('does not walk back to the road from inside the place', () => {
    const trail = trailPoints({ x: 3, z: 95 }, goal, road, 1);
    expect(length(trail)).toBeLessThan(10);
  });

  it('is cut at TRAIL_MAX', () => {
    const trail = trailPoints({ x: 0, z: 0 }, { x: 0, z: 400 }, null, 1);
    expect(length(trail)).toBeCloseTo(TRAIL_MAX, 3);
  });
});

describe('footprints', () => {
  it('alternates feet a stride apart along the line', () => {
    const prints = footprints(wander({ x: 0, z: 0 }, { x: 0, z: 10 }, 1, 0), 1);
    expect(prints).toHaveLength(10);
    expect(prints.map((p) => p.left)).toEqual([true, false, true, false, true, false, true, false, true, false]);
    expect(prints[0].angle).toBeCloseTo(0, 6);
    expect(Math.abs(prints[0].x)).toBeCloseTo(0.14, 6);
  });
});

describe('trailPoints joining the road', () => {
  it('joins ahead of the hunter, not behind him', () => {
    const road = roadPoints(0, 125, 5, 24);
    const from = { x: 8, z: 50 };
    const trail = trailPoints(from, { x: 0, z: 125 }, road, 1);
    const on = trail.findIndex((p) => nearestOnLine(p.x, p.z, road).d < 1e-6);
    expect(trail[on].z).toBeGreaterThan(from.z - 2);
    for (const p of trail.slice(on, -1)) expect(nearestOnLine(p.x, p.z, road).d).toBeLessThan(1e-6);
  });
});

describe('trailPoints round the square', () => {
  it('never walks through the well', () => {
    const trail = trailPoints({ x: 0, z: 8 }, { x: 0, z: -40 }, null, 2);
    expect(trail[trail.length - 1].x).toBeCloseTo(0, 6);
    expect(trail[trail.length - 1].z).toBeCloseTo(-40, 6);
    for (const p of trail) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(SQUARE_MIDDLE);
  });

  it('nor on the way onto a road that leaves the far side of the square', () => {
    const road = roadPoints(0, -100, 9, 24);
    const trail = trailPoints({ x: 1, z: 8 }, { x: 0, z: -100 }, road, 2);
    for (const p of trail) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(SQUARE_MIDDLE);
  });
});
