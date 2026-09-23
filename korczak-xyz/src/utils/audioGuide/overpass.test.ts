import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  fetchAttractions,
  MAX_MARKERS,
  OverpassBusyError,
  overpassQuery,
  ranOutOfRoom,
  transformAttractions,
} from "./overpass";

describe("overpassQuery", () => {
  const bounds = { south: 52.2, west: 20.9, north: 52.3, east: 21.1 };

  it("puts the same box on every clause", () => {
    const boxes = overpassQuery(bounds).match(/\(52\.2,20\.9,52\.3,21\.1\)/g);
    expect(boxes).toHaveLength(3);
  });

  it("asks for centres, so a way or relation still yields one point", () => {
    expect(overpassQuery(bounds)).toContain("out center;");
  });
});

describe("transformAttractions", () => {
  it("drops elements with no name — most of OSM has none", () => {
    const out = transformAttractions({
      elements: [
        { id: 1, type: "node", lat: 1, lon: 2, tags: { historic: "wall" } },
        {
          id: 2,
          type: "node",
          lat: 1,
          lon: 2,
          tags: { historic: "wall", name: "Barbakan" },
        },
      ],
    });
    expect(out.map((a) => a.name)).toEqual(["Barbakan"]);
  });

  it("takes a way’s centre when it has no point of its own", () => {
    const [attraction] = transformAttractions({
      elements: [
        {
          id: 7,
          type: "way",
          center: { lat: 52.25, lon: 21.01 },
          tags: { name: "Zamek", historic: "castle" },
        },
      ],
    });
    expect(attraction).toMatchObject({
      lat: 52.25,
      lon: 21.01,
      category: "historic:castle",
    });
  });

  it("drops an element with neither a point nor a centre", () => {
    expect(
      transformAttractions({
        elements: [{ id: 8, type: "relation", tags: { name: "Nowhere" } }],
      }),
    ).toEqual([]);
  });

  it("keys by type and id, because OSM reuses ids across types", () => {
    const out = transformAttractions({
      elements: [
        {
          id: 42,
          type: "node",
          lat: 1,
          lon: 2,
          tags: { name: "A", tourism: "museum" },
        },
        {
          id: 42,
          type: "way",
          center: { lat: 3, lon: 4 },
          tags: { name: "B", tourism: "gallery" },
        },
      ],
    });
    expect(out.map((a) => a.key)).toEqual(["node/42", "way/42"]);
  });

  it("names the category from the most specific tag present", () => {
    const categories = transformAttractions({
      elements: [
        {
          id: 1,
          type: "node",
          lat: 0,
          lon: 0,
          tags: { name: "a", tourism: "museum" },
        },
        {
          id: 2,
          type: "node",
          lat: 0,
          lon: 0,
          tags: { name: "b", historic: "memorial" },
        },
        {
          id: 3,
          type: "node",
          lat: 0,
          lon: 0,
          tags: { name: "c", amenity: "place_of_worship" },
        },
        {
          id: 4,
          type: "node",
          lat: 0,
          lon: 0,
          tags: { name: "d", wikipedia: "x" },
        },
      ],
    }).map((a) => a.category);
    expect(categories).toEqual([
      "museum",
      "historic:memorial",
      "place_of_worship",
      "attraction",
    ]);
  });

  it("survives a response that is not one", () => {
    expect(transformAttractions(null)).toEqual([]);
    expect(transformAttractions({})).toEqual([]);
    expect(transformAttractions({ elements: "nope" })).toEqual([]);
  });
});

describe("backoffMs", () => {
  it("doubles, so three retries span seconds rather than milliseconds", () => {
    expect([0, 1, 2].map(backoffMs)).toEqual([1000, 2000, 4000]);
  });
});

it("caps the markers well under what a dense old town returns", () => {
  expect(MAX_MARKERS).toBe(100);
});

describe("fetchAttractions", () => {
  const bounds = { south: 52.2, west: 20.9, north: 52.21, east: 20.91 };
  const noSleep = () => Promise.resolve();

  afterEach(() => vi.unstubAllGlobals());

  function answer(...responses: Response[]) {
    const fetch = vi.fn();
    for (const r of responses) fetch.mockResolvedValueOnce(r);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });

  it("reads a 504 as a busy server and waits it out, not as a box too big", async () => {
    const fetch = answer(
      new Response("", { status: 504 }),
      ok({ elements: [] }),
    );
    await expect(
      fetchAttractions(bounds, new AbortController().signal, noSleep),
    ).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up on a server that stays busy, and says busy", async () => {
    answer(
      ...Array.from({ length: 4 }, () => new Response("", { status: 504 })),
    );
    const err = await fetchAttractions(
      bounds,
      new AbortController().signal,
      noSleep,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OverpassBusyError);
    expect((err as OverpassBusyError).kind).toBe("busy");
  });

  it("calls it too big only when Overpass says the query ran out of time, and does not retry", async () => {
    const fetch = answer(
      ok({
        elements: [],
        remark:
          'runtime error: Query timed out in "query" at line 3 after 26 seconds.',
      }),
    );
    const err = await fetchAttractions(
      bounds,
      new AbortController().signal,
      noSleep,
    ).catch((e: unknown) => e);
    expect((err as OverpassBusyError).kind).toBe("too-big");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("ranOutOfRoom", () => {
  it("matches a timeout or memory remark and nothing else", () => {
    expect(
      ranOutOfRoom({
        remark:
          "runtime error: Query run out of memory using about 2048 MB of RAM.",
      }),
    ).toBe(true);
    expect(
      ranOutOfRoom({
        remark: 'runtime error: Query timed out in "query" at line 3',
      }),
    ).toBe(true);
    expect(ranOutOfRoom({ elements: [] })).toBe(false);
    expect(ranOutOfRoom(null)).toBe(false);
  });
});
