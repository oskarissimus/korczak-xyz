import { describe, expect, it } from "vitest";
import { dataTilesFor, decodeTile, isStale, parsePointer, squaresOf, STALE_AFTER_DAYS } from "./pins";
import { tileX, tileY, tilesCovering } from "./tiles";

describe("the archive's grid", () => {
  it("a data tile holds exactly the squares whose points fall in it", () => {
    // The Royal Castle again: z15 square 18296/10787, so z13 tile 4574/2696.
    const x = tileX(21.0136);
    const y = tileY(52.2479);
    const tile = dataTilesFor({ minX: x, maxX: x, minY: y, maxY: y });
    expect(tile).toEqual({ minX: 4574, maxX: 4574, minY: 2696, maxY: 2696 });

    const squares = squaresOf(4574, 2696);
    expect(squares).toEqual({ minX: 18296, maxX: 18299, minY: 10784, maxY: 10787 });
    expect(x).toBeGreaterThanOrEqual(squares.minX);
    expect(y).toBeLessThanOrEqual(squares.maxY);
  });

  it("the old town on one screen is one or two tiles, not a dozen", () => {
    const range = dataTilesFor(tilesCovering({ south: 52.245, west: 21.005, north: 52.255, east: 21.02 }));
    const count = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    expect(count).toBeLessThanOrEqual(2);
  });
});

describe("latest.json", () => {
  it("is read when it names one of the builder's archives", () => {
    expect(parsePointer({ archive: "pins-20260926-020700.pmtiles", built: "2026-09-26T02:07:00Z", places: 3 })).toEqual({
      archive: "pins-20260926-020700.pmtiles",
      built: "2026-09-26T02:07:00Z",
    });
  });

  it("is refused when it names anything else", () => {
    expect(parsePointer({ archive: "../other-bucket/x.pmtiles", built: "2026-09-26T02:07:00Z" })).toBeNull();
    expect(parsePointer({ archive: "https://evil.example/pins-1.pmtiles", built: "2026-09-26T02:07:00Z" })).toBeNull();
    expect(parsePointer({ archive: "pins-1.pmtiles", built: "yesterday" })).toBeNull();
    expect(parsePointer(null)).toBeNull();
  });

  it("is stale after three missed weekly builds, not before", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    expect(isStale(new Date(now - (STALE_AFTER_DAYS - 1) * day).toISOString(), now)).toBe(false);
    expect(isStale(new Date(now - (STALE_AFTER_DAYS + 1) * day).toISOString(), now)).toBe(true);
  });
});

describe("a tile", () => {
  it("is an Overpass answer, and becomes the same attractions one would", () => {
    const body = JSON.stringify({
      elements: [
        { type: "way", id: 29702133, lat: 52.2478963, lon: 21.0151581, tags: { name: "Zamek Królewski", historic: "castle", wikidata: "Q756098" } },
        { type: "node", id: 1, lat: 52.1, lon: 21.1, tags: { historic: "boundary_stone" } },
      ],
    });
    const found = decodeTile(new TextEncoder().encode(body).buffer as ArrayBuffer);
    expect(found).toEqual([
      {
        id: 29702133,
        type: "way",
        key: "way/29702133",
        name: "Zamek Królewski",
        lat: 52.2478963,
        lon: 21.0151581,
        category: "historic:castle",
        // `name` is the attraction's name, not a story tag - storyTags() leaves it out.
        tags: { historic: "castle", wikidata: "Q756098" },
      },
    ]);
  });
});
