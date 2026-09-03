/*
 * The watched stretches of line, and the one choke point every one of them goes through.
 *
 * A segment is two station names and a line, and both names have to be spellings this app can find
 * on that line — otherwise `stationsBetween` returns nothing and the segment is a rule that matches
 * nothing forever, with an entry in the UI insisting it is watching something. So `normalizeSegment`
 * is where a draft becomes a segment, and it is the only way one is made: the same role
 * `newInterest` plays for the events app's country codes.
 */

import type { MetroLine, WatchedSegment } from './types';
import { canonicalStation, stationsBetween } from './lines';
import { METRO_LINES } from './types';

export interface SegmentDraft {
  label: string;
  line: MetroLine;
  from: string;
  to: string;
  muted?: boolean;
}

/**
 * A draft made safe, or null.
 *
 * Null for an endpoint that is not on that line — including the case that will actually happen,
 * which is a station belonging to the *other* line. Świętokrzyska is on both; Imielin is on M1 and
 * Rondo Daszyńskiego is on M2, and a segment claiming to run between those two is not a journey,
 * it is a change at Świętokrzyska and belongs in the app as two rows.
 *
 * Endpoints are stored canonicalised, so what the matcher compares and what the editor prints are
 * the same string. That is the rule `cityKey` keeps for the events app's city picker, and it is
 * what stops a segment saved as `swietokrzyska` from looking, months later, like a station this
 * build has never heard of.
 */
export function normalizeSegment(draft: SegmentDraft): Omit<SegmentDraft, 'muted'> & { muted?: boolean } | null {
  if (!METRO_LINES.includes(draft.line)) return null;
  const from = canonicalStation(draft.line, draft.from ?? '');
  const to = canonicalStation(draft.line, draft.to ?? '');
  if (!from || !to) return null;
  return {
    label: (draft.label ?? '').trim().slice(0, 80) || defaultLabel(draft.line, from, to),
    line: draft.line,
    from,
    to,
    ...(draft.muted ? { muted: true } : {}),
  };
}

/**
 * The name a segment gets when the reader does not type one.
 *
 * Language-neutral on purpose: this string is stored on the document and is read back by both
 * locales and by the Cloud Function, which has none. `M2 · Rondo Daszyńskiego → Świętokrzyska` says
 * everything the row needs without a word in it that would have to be translated.
 */
export function defaultLabel(line: MetroLine, from: string, to: string): string {
  return `${line} · ${from} → ${to}`;
}

/** The stations a segment covers, endpoints included. Empty only for a segment that skipped the gate. */
export function segmentStations(segment: Pick<WatchedSegment, 'line' | 'from' | 'to'>): string[] {
  return stationsBetween(segment.line, segment.from, segment.to);
}

/** How many stops it is. Shown on the row so a one-stop hop and half the line do not look alike. */
export function segmentLength(segment: Pick<WatchedSegment, 'line' | 'from' | 'to'>): number {
  return Math.max(0, segmentStations(segment).length);
}

export function newSegment(draft: SegmentDraft, id: string, writerId: string, now: number): WatchedSegment | null {
  const safe = normalizeSegment(draft);
  if (!safe) return null;
  return {
    id,
    rev: 1,
    updatedAt: now,
    writerId,
    createdAt: now,
    ...safe,
  };
}

export function reviseSegment(
  previous: WatchedSegment,
  draft: SegmentDraft,
  writerId: string,
  now: number,
): WatchedSegment | null {
  const safe = normalizeSegment(draft);
  if (!safe) return null;
  return {
    ...previous,
    ...safe,
    // A revise that drops the flag has to clear it, and spreading `safe` only sets it when true.
    muted: safe.muted ?? false,
    rev: previous.rev + 1,
    updatedAt: now,
    writerId,
  };
}

export function tombstoneSegment(previous: WatchedSegment, writerId: string, now: number): WatchedSegment {
  return { ...previous, deleted: true, rev: previous.rev + 1, updatedAt: now, writerId };
}

/**
 * The journey the app is seeded with: the way home.
 *
 * Two rows rather than one, because it is two rides with a change at Świętokrzyska — and that is
 * not a modelling nicety, it is the difference between being told about a closure at Rondo ONZ
 * (first leg, M2) and one at Wilanowska (second leg, M1). A single segment cannot span two lines,
 * and pretending otherwise would mean either missing half the journey or watching the whole of both.
 *
 * Seeded rather than assumed: they are ordinary rows in the editor, so the first thing the reader
 * does with a new commute is edit them, and nothing in the matcher treats them as special.
 */
export const SEED_SEGMENTS: ReadonlyArray<{ id: string } & SegmentDraft> = [
  {
    id: 'seed-m2-daszynskiego-swietokrzyska',
    label: 'Way home · leg 1',
    line: 'M2',
    from: 'Rondo Daszyńskiego',
    to: 'Świętokrzyska',
  },
  {
    id: 'seed-m1-swietokrzyska-imielin',
    label: 'Way home · leg 2',
    line: 'M1',
    from: 'Świętokrzyska',
    to: 'Imielin',
  },
];

/**
 * The seeds an account is missing, as full records.
 *
 * Keyed by id and never editing an existing row, exactly as `withMissingSeeds` is for the events
 * app's interests: a seed the reader deleted stays deleted, because its tombstone is a row with
 * that id, and a seed they rewrote keeps their version.
 */
export function withMissingSeeds(existing: WatchedSegment[], writerId: string, now: number): WatchedSegment[] {
  const known = new Set(existing.map((segment) => segment.id));
  const added: WatchedSegment[] = [];
  for (const seed of SEED_SEGMENTS) {
    if (known.has(seed.id)) continue;
    const record = newSegment(seed, seed.id, writerId, now);
    // A seed that fails the gate is a station that has been renamed out from under this build. It
    // is dropped rather than thrown: the app is still usable, and `segments.test.ts` is where that
    // is supposed to be caught, at build time rather than on somebody's phone.
    if (record) added.push(record);
  }
  return added.length > 0 ? [...existing, ...added] : existing;
}
