import { describe, expect, it } from 'vitest';

import { EMPTY_LAYOUT, fitScale, hubFit, hubLayout, roadDistance, SPAWN_AT, SIZE_BIAS, SQUARE_RADIUS, VILLAGE_STANDS, WIDTH_SLACK } from './hubLayout';
import type { HubSlot } from './landmark3d';

const ids = Array.from({ length: 60 }, (_, i) => `world-${i}-${(i * 7919).toString(36)}`);
const placed = (id: string) => {
  const layout = hubLayout(id);
  return (Object.entries(layout.spots) as [HubSlot, { x: number; z: number }[]][]).flatMap(([slot, list]) =>
    list.map((s) => ({ slot, ...s, r: (hubFit(slot, undefined).width * SIZE_BIAS) / 2 + 0.3 })),
  );
};

describe('hubLayout', () => {
  it('is the same village for the same world, and another for another', () => {
    expect(hubLayout('abc')).toEqual(hubLayout('abc'));
    expect(hubLayout('abc').spots).not.toEqual(hubLayout('abd').spots);
    expect(new Set(ids.map((id) => hubLayout(id).style)).size).toBeGreaterThan(2);
  });

  it('has a landmark, a house or a hall, and a forest in every world', () => {
    for (const id of ids) {
      const layout = hubLayout(id);
      expect(layout.spots.landmark).toHaveLength(1);
      expect(layout.spots.house.length + layout.spots.hall.length).toBeGreaterThan(0);
      expect(layout.forest.length).toBeGreaterThan(200);
    }
  });

  it('keeps the pieces apart, and off the square but for the landmark', () => {
    for (const id of ids) {
      const all = placed(id);
      for (let i = 0; i < all.length; i++) {
        const a = all[i];
        if (a.slot !== 'landmark') expect(Math.hypot(a.x, a.z) - a.r).toBeGreaterThanOrEqual(SQUARE_RADIUS - 1e-9);
        for (const b of all.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.r + b.r);
      }
    }
  });

  it('leaves where the characters stand and the hunter starts free', () => {
    for (const id of ids) {
      for (const p of placed(id)) {
        for (const s of [...VILLAGE_STANDS, SPAWN_AT]) expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(p.r);
      }
    }
  });

  it('builds nothing on the roads out', () => {
    for (const id of ids) {
      for (const p of placed(id)) {
        if (p.slot === 'lamp' || p.slot === 'landmark') continue;
        expect(roadDistance(p.x, p.z)).toBeGreaterThan(p.r);
      }
    }
  });

  it('grows the forest outside the village and inside the map', () => {
    for (const id of ids.slice(0, 10)) {
      const layout = hubLayout(id);
      for (const t of layout.forest) {
        expect(Math.hypot(t.x, t.z)).toBeGreaterThanOrEqual(layout.radius + 6);
        expect(Math.max(Math.abs(t.x), Math.abs(t.z))).toBeLessThanOrEqual(160);
      }
    }
  });

  it('makes room for a world whose pieces are bigger', () => {
    const sizes = { hall: { height: 9, width: 9 }, house: { height: 6, width: 7.5 } };
    const layout = hubLayout('big', sizes);
    const halls = layout.spots.hall;
    for (let i = 0; i < halls.length; i++)
      for (const b of halls.slice(i + 1)) expect(Math.hypot(halls[i].x - b.x, halls[i].z - b.z)).toBeGreaterThanOrEqual(9.6);
    expect(layout.key).not.toBe(hubLayout('big').key);
  });

  it('has an empty board with nothing on it', () => {
    expect(Object.values(EMPTY_LAYOUT.spots).flat()).toHaveLength(0);
    expect(EMPTY_LAYOUT.forest).toHaveLength(0);
  });
});

describe('roadDistance', () => {
  it('is how far off the nearest road out a point is', () => {
    expect(roadDistance(0, -20)).toBeCloseTo(0, 6); // north
    expect(roadDistance(3, -20)).toBeCloseTo(3, 6);
    expect(roadDistance(0, 2)).toBe(Infinity); // inside the square, where no road is yet
  });
});

describe('fitScale', () => {
  it('stands a piece by its height, a little over it', () => {
    // A stall drawn with a deep awning: as wide as it is tall, wider than the 3 m it was described.
    const stall = { x: 1, y: 1, z: 0.6 };
    expect(fitScale(stall, { height: 3, width: 3 }) * stall.y).toBeCloseTo(3 * SIZE_BIAS);
    expect(fitScale(stall, { height: 3, width: 2.2 }) * stall.y).toBeCloseTo(3 * SIZE_BIAS);
  });

  it('lets the length decide only when the model came out far wider than described', () => {
    const slab = { x: 4, y: 1, z: 1 };
    const scale = fitScale(slab, { height: 2, width: 2 });
    expect(scale * slab.x).toBeCloseTo(2 * SIZE_BIAS * WIDTH_SLACK);
    expect(scale * slab.y).toBeLessThan(2);
  });
});

describe('hubFit', () => {
  it('raises a size kept under older floors to today\'s', () => {
    expect(hubFit('stall', { stall: { height: 1.6, width: 2 } }).height).toBeGreaterThanOrEqual(2.6);
    expect(hubFit('stall', { stall: { height: 3.2, width: 3 } })).toEqual({ height: 3.2, width: 3 });
    expect(hubFit('tree2', undefined)).toEqual(hubFit('tree2', {}));
  });
});
