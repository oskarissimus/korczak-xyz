/*
 * What the map already knows, so that most moves do not have to ask Overpass anything.
 *
 * The world is cut into the same grid the map tiles use, at one fixed zoom, and every Overpass
 * answer is filed under the grid squares it was asked about. A new viewport is then two
 * questions: which of its squares are already here - drawn at once, with no request - and which
 * are not, which are fetched as one rectangle. Zooming in, and panning a street or two, are then
 * free, and the shared endpoint hears about each square once per visit rather than once per move.
 *
 * Squares, not "the last box plus a margin": a margin is one box, and walking back to where you
 * were a minute ago has already fallen out of it. The grid also pads a query without anyone
 * choosing a margin - asking for a square answers the parts of it just off the screen.
 *
 * `TILE_ZOOM` is 15: a square about 750m wide in Poland, so a phone at the zoom the app opens
 * on needs two to six of them, and the rectangle it asks for is not much more than the screen.
 * A coarser grid makes the first answer - the one somebody is waiting for - several times the area.
 *
 * Pure, so the grid arithmetic can be tested without a map.
 */

import type { Attraction, Bounds } from './types';

export const TILE_ZOOM = 15;

/**
 * Squares kept, oldest-used forgotten first. A square is a handful of attractions, so this is a
 * few hundred kilobytes at most - a long afternoon's walk, and several cities' worth of panning.
 */
export const MAX_CACHED_TILES = 1500;

const N = 2 ** TILE_ZOOM;
/** Web Mercator stops here; Leaflet reports latitudes past it when zoomed out over a pole. */
const MAX_LAT = 85.05112878;

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
const clampIndex = (i: number) => Math.max(0, Math.min(N - 1, i));

export function tileX(lon: number): number {
  return clampIndex(Math.floor(((Math.max(-180, Math.min(180, lon)) + 180) / 360) * N));
}

export function tileY(lat: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return clampIndex(Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * N));
}

const lonOf = (x: number) => (x / N) * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;

export const tileKey = (x: number, y: number) => `${x}/${y}`;

/** An inclusive rectangle of squares. `y` grows southwards, as it does in the tile scheme. */
export interface TileRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function tilesCovering(bounds: Bounds): TileRange {
  return {
    minX: tileX(bounds.west),
    maxX: tileX(bounds.east),
    minY: tileY(bounds.north),
    maxY: tileY(bounds.south),
  };
}

export function* tilesIn(range: TileRange): Generator<[number, number]> {
  for (let x = range.minX; x <= range.maxX; x++) {
    for (let y = range.minY; y <= range.maxY; y++) yield [x, y];
  }
}

/** The geographic rectangle a range of squares covers, edge to edge. */
export function boundsOfTiles(range: TileRange): Bounds {
  return {
    south: latOf(range.maxY + 1),
    west: lonOf(range.minX),
    north: latOf(range.minY),
    east: lonOf(range.maxX + 1),
  };
}

function contains(bounds: Bounds, a: Attraction): boolean {
  return a.lat >= bounds.south && a.lat <= bounds.north && a.lon >= bounds.west && a.lon <= bounds.east;
}

export interface CacheLookup {
  /** Everything known inside the bounds - from the squares that are here. */
  attractions: Attraction[];
  /** The smallest rectangle of squares holding every one that is not here; null when none. */
  missing: TileRange | null;
  /** How many squares in view are not here - fewer than `missing` covers when it has holes. */
  missingCount: number;
}

export class AttractionCache {
  private readonly tiles = new Map<string, Attraction[]>();

  constructor(private readonly capacity = MAX_CACHED_TILES) {}

  get size(): number {
    return this.tiles.size;
  }

  lookup(bounds: Bounds): CacheLookup {
    const attractions: Attraction[] = [];
    let missing: TileRange | null = null;
    let missingCount = 0;

    for (const [x, y] of tilesIn(tilesCovering(bounds))) {
      const key = tileKey(x, y);
      const found = this.tiles.get(key);
      if (!found) {
        missingCount++;
        missing = missing
          ? {
              minX: Math.min(missing.minX, x),
              maxX: Math.max(missing.maxX, x),
              minY: Math.min(missing.minY, y),
              maxY: Math.max(missing.maxY, y),
            }
          : { minX: x, maxX: x, minY: y, maxY: y };
        continue;
      }
      // Touch it, so the squares being looked at are the last to be forgotten.
      this.tiles.delete(key);
      this.tiles.set(key, found);
      for (const a of found) if (contains(bounds, a)) attractions.push(a);
    }

    return { attractions, missing, missingCount };
  }

  /**
   * File an answer for a range of squares. Every square in the range is recorded, empty ones
   * included - an empty square is an answer, and without it the square would be asked about again
   * on every move. An attraction is filed under the one square its point falls in, so a building
   * astride a boundary is one pin, not two; one whose point falls outside the range (a way that
   * reaches into the box from beyond it) is left for its own square's answer.
   */
  store(range: TileRange, attractions: Attraction[]): void {
    const filed = new Map<string, Attraction[]>();
    for (const [x, y] of tilesIn(range)) filed.set(tileKey(x, y), []);
    for (const a of attractions) filed.get(tileKey(tileX(a.lon), tileY(a.lat)))?.push(a);

    for (const [key, list] of filed) {
      this.tiles.delete(key);
      this.tiles.set(key, list);
    }
    while (this.tiles.size > this.capacity) {
      const oldest = this.tiles.keys().next().value as string;
      this.tiles.delete(oldest);
    }
  }
}

/**
 * The `limit` attractions nearest the middle of the screen. What the map can draw is capped (see
 * `MAX_MARKERS`), and when there is more than that, the ones worth drawing are the ones somebody
 * is looking at rather than whichever came first in the answer.
 */
export function nearestToCentre(attractions: Attraction[], bounds: Bounds, limit: number): Attraction[] {
  if (attractions.length <= limit) return attractions;
  const lat = (bounds.north + bounds.south) / 2;
  const lon = (bounds.east + bounds.west) / 2;
  const squeeze = Math.cos((lat * Math.PI) / 180) ** 2;
  const d = (a: Attraction) => (a.lat - lat) ** 2 + (a.lon - lon) ** 2 * squeeze;
  return [...attractions].sort((a, b) => d(a) - d(b)).slice(0, limit);
}
