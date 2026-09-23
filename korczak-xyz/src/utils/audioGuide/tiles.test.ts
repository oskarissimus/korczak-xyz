import { describe, expect, it } from "vitest";
import {
  AttractionCache,
  boundsOfTiles,
  nearestToCentre,
  tileX,
  tileY,
  tilesCovering,
} from "./tiles";
import type { Attraction, Bounds } from "./types";

const place = (id: number, lat: number, lon: number): Attraction => ({
  id,
  type: "node",
  key: `node/${id}`,
  name: `P${id}`,
  lat,
  lon,
  category: "museum",
  tags: {},
});

// Warsaw's old town, the map's opening view, about one phone screen across.
const oldTown: Bounds = {
  south: 52.245,
  west: 21.005,
  north: 52.255,
  east: 21.02,
};

describe("the grid", () => {
  it("matches the slippy map scheme", () => {
    // z15 tile holding the Royal Castle - checked against the asinh form of the same formula.
    expect([tileX(21.0136), tileY(52.2479)]).toEqual([18296, 10787]);
  });

  it("a range's bounds contain every point of the viewport it came from", () => {
    const b = boundsOfTiles(tilesCovering(oldTown));
    expect(b.south).toBeLessThanOrEqual(oldTown.south);
    expect(b.west).toBeLessThanOrEqual(oldTown.west);
    expect(b.north).toBeGreaterThanOrEqual(oldTown.north);
    expect(b.east).toBeGreaterThanOrEqual(oldTown.east);
  });

  it("survives a world-wide view without running off the grid", () => {
    const r = tilesCovering({ south: -90, west: -200, north: 90, east: 200 });
    expect(r.minX).toBe(0);
    expect(r.minY).toBe(0);
    expect(r.maxX).toBe(2 ** 15 - 1);
    expect(r.maxY).toBe(2 ** 15 - 1);
  });
});

describe("AttractionCache", () => {
  it("asks for everything at first, and for nothing once answered", () => {
    const cache = new AttractionCache();
    const first = cache.lookup(oldTown);
    expect(first.attractions).toEqual([]);
    expect(first.missing).toEqual(tilesCovering(oldTown));

    cache.store(first.missing!, [place(1, 52.2479, 21.0136)]);
    const again = cache.lookup(oldTown);
    expect(again.missing).toBeNull();
    expect(again.attractions.map((a) => a.key)).toEqual(["node/1"]);
  });

  it("answers a zoom-in from what the wider view fetched", () => {
    const cache = new AttractionCache();
    cache.store(tilesCovering(oldTown), [
      place(1, 52.2479, 21.0136),
      place(2, 52.2535, 21.006),
    ]);
    const closer = cache.lookup({
      south: 52.247,
      west: 21.012,
      north: 52.249,
      east: 21.015,
    });
    expect(closer.missing).toBeNull();
    expect(closer.attractions.map((a) => a.key)).toEqual(["node/1"]);
  });

  it("remembers an empty square, so it is not asked about again", () => {
    const cache = new AttractionCache();
    cache.store(tilesCovering(oldTown), []);
    expect(cache.lookup(oldTown)).toEqual({ attractions: [], missing: null });
  });

  it("asks only for the squares a pan uncovered", () => {
    const cache = new AttractionCache();
    cache.store(tilesCovering(oldTown), []);
    const east = { ...oldTown, west: oldTown.east - 0.005, east: oldTown.east + 0.02 };
    const { missing } = cache.lookup(east);
    expect(missing).not.toBeNull();
    expect(missing!.minX).toBe(tilesCovering(oldTown).maxX + 1);
  });

  it("files an attraction under one square only, so a boundary does not draw it twice", () => {
    const cache = new AttractionCache();
    const range = tilesCovering(oldTown);
    const outside = place(9, 60, 30);
    cache.store(range, [place(1, 52.2479, 21.0136), outside]);
    expect(cache.lookup(oldTown).attractions).toHaveLength(1);
  });

  it("forgets the least recently looked-at squares first", () => {
    const cache = new AttractionCache(2);
    const r = (x: number) => ({ minX: x, maxX: x, minY: 10784, maxY: 10784 });
    const view = (x: number) => boundsOfTiles(r(x));
    const shrink = (b: Bounds): Bounds => ({
      south: b.south + 1e-4,
      west: b.west + 1e-4,
      north: b.north - 1e-4,
      east: b.east - 1e-4,
    });
    cache.store(r(1), []);
    cache.store(r(2), []);
    cache.lookup(shrink(view(1)));
    cache.store(r(3), []);
    expect(cache.size).toBe(2);
    expect(cache.lookup(shrink(view(1))).missing).toBeNull();
    expect(cache.lookup(shrink(view(2))).missing).not.toBeNull();
  });
});

describe("nearestToCentre", () => {
  it("keeps the ones in the middle of the screen when there are too many", () => {
    const centre = place(1, 52.25, 21.0125);
    const edge = place(2, 52.2549, 21.0055);
    expect(nearestToCentre([edge, centre], oldTown, 1)).toEqual([centre]);
  });

  it("leaves a short list alone", () => {
    const list = [place(1, 0, 0), place(2, 1, 1)];
    expect(nearestToCentre(list, oldTown, 5)).toBe(list);
  });
});
