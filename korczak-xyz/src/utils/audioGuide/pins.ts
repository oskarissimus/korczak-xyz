/*
 * The pins, read out of the weekly world archive instead of asked of Overpass.
 *
 * `audio-guide-pins/build.py` answers the app's one Overpass question for the whole planet once a
 * week and writes the answer into a PMTiles archive: one gzipped tile per zoom-13 tile, each
 * `{"elements": [...]}` in the shape of an Overpass answer, so `transformAttractions` reads both.
 * Here the browser reads the tile it needs with a range request - tens of milliseconds, against
 * the seconds to tens of seconds the public Overpass instance takes, and no rate limit.
 *
 * `latest.json` names the current archive; the archive itself is immutable under its dated name.
 * That is what makes a rebuild safe for a page that is already open: the page keeps reading the
 * archive it started with, and the builder keeps the previous one for a week.
 *
 * Overpass is still the fallback (see `useNearbyAttractions`): until the first build lands, when
 * the bucket cannot be reached, and when a tile fails to read. Nothing here decides that - it only
 * says "no archive" by answering null, or throws.
 */

import { PMTiles } from 'pmtiles';

import { describeError, log } from '../../lib/logger';
import { transformAttractions } from './overpass';
import { TILE_ZOOM, type TileRange } from './tiles';
import type { Attraction } from './types';

export const PINS_BASE = 'https://storage.googleapis.com/korczak-xyz-501720-audio-guide-pins/';

/** The archive's tile zoom. One of its tiles is `2^(15-13)` = 4 by 4 of the cache's squares. */
export const DATA_ZOOM = 13;
const SHIFT = TILE_ZOOM - DATA_ZOOM;

/**
 * Three missed weekly builds. Past this the archive still works - a church does not move - but
 * the build has plainly stopped, and that is worth an issue in Sentry rather than a guess later.
 */
export const STALE_AFTER_DAYS = 21;

export interface PinsPointer {
  archive: string;
  built: string;
}

/** `latest.json`, checked: an archive name that is not one of the builder's is not fetched. */
export function parsePointer(body: unknown): PinsPointer | null {
  const { archive, built } = (body ?? {}) as Record<string, unknown>;
  if (typeof archive !== 'string' || !/^pins-[\w-]+\.pmtiles$/.test(archive)) return null;
  if (typeof built !== 'string' || Number.isNaN(Date.parse(built))) return null;
  return { archive, built };
}

export function isStale(built: string, now = Date.now()): boolean {
  return now - Date.parse(built) > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** The archive tiles holding a range of the cache's squares. */
export function dataTilesFor(range: TileRange): TileRange {
  return {
    minX: range.minX >> SHIFT,
    maxX: range.maxX >> SHIFT,
    minY: range.minY >> SHIFT,
    maxY: range.maxY >> SHIFT,
  };
}

/** The cache's squares one archive tile answers - all of them, empty ones included. */
export function squaresOf(x: number, y: number): TileRange {
  const size = 1 << SHIFT;
  return { minX: x * size, maxX: x * size + size - 1, minY: y * size, maxY: y * size + size - 1 };
}

/** A tile's bytes, already un-gzipped by the PMTiles reader, to attractions. */
export function decodeTile(data: ArrayBuffer): Attraction[] {
  return transformAttractions(JSON.parse(new TextDecoder().decode(data)));
}

let opening: Promise<PMTiles | null> | null = null;

/**
 * The current archive, or null when there is none to read.
 *
 * Only an answer is remembered. A failed pointer fetch - offline for a moment, the bucket not
 * built yet - is asked again next time, so a page that opened in a tunnel does not stay on
 * Overpass for the rest of the walk.
 */
export function openPins(): Promise<PMTiles | null> {
  if (!opening) {
    opening = (async () => {
      try {
        const response = await fetch(`${PINS_BASE}latest.json`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`latest.json ${response.status}`);
        const pointer = parsePointer(await response.json());
        if (!pointer) throw new Error('latest.json is not a pointer');
        if (isStale(pointer.built)) {
          // An error, so it is an event in Sentry: nothing else says the weekly build stopped.
          log.error('audioGuide.pins.stale', { built: pointer.built, archive: pointer.archive });
        }
        return new PMTiles(`${PINS_BASE}${pointer.archive}`);
      } catch (e) {
        opening = null;
        log.warn('audioGuide.pins.unavailable', describeError(e));
        return null;
      }
    })();
  }
  return opening;
}

/**
 * Forget the archive after a failed read, so the next move opens it afresh.
 *
 * Needed because of how the PMTiles reader caches: an aborted directory fetch is dropped from its
 * cache, but a header fetch that fails - one flaky request on a phone - stays there as a rejected
 * promise, and every tile read after it rejects too. Without this, one bad moment would send the
 * rest of the session to Overpass.
 */
export function forgetPins(): void {
  opening = null;
}

/**
 * One archive tile's places. A tile the archive does not have is not an error: the builder writes
 * only tiles with something in them, so a missing one is an answer, and it is "nothing here".
 */
export async function readPinsTile(
  archive: PMTiles,
  x: number,
  y: number,
  signal: AbortSignal,
): Promise<Attraction[]> {
  const tile = await archive.getZxy(DATA_ZOOM, x, y, signal);
  return tile ? decodeTile(tile.data) : [];
}
