/*
 * Does this communiqué touch the journey?
 *
 * One function, used by the collector to decide what to push and by the app to decide how to draw a
 * card. Compiled into both runtimes for the reason the events app compiles its matcher into both:
 * if they answer differently, the phone rings about a disruption the screen files as somebody
 * else's, and the pair stop describing the same world.
 *
 * The interesting half is not the intersection test — that is four lines — but what happens when
 * the extractor has told us nothing, or has named a station this build does not know. **Absence of
 * evidence is resolved upward, never downward.** An unreadable communiqué about M1 is not a
 * communiqué about somebody else's line; it is one whose stations are unknown, and the only honest
 * thing to do with it is treat it as if it were about the route. The alternative — quietly filing
 * it as line-level, or dropping it — means the day the extractor breaks is the day the app stops
 * mentioning that the metro is shut, while continuing to look perfectly healthy. That is this app's
 * version of the silently empty feed the events app is arranged to prevent.
 *
 * The cost of that choice is bounded and worth naming: a handful of over-priority alerts on a line
 * the reader rides, on the days the model is down. `certain: false` travels with the verdict, so
 * the card and the push body can say which kind of answer this is.
 *
 * **`muted` is not read here.** A verdict is a statement about the world; muting is a statement
 * about what should ring, and it belongs to `notices.ts`. Folded in, a muted segment would make the
 * feed disagree with itself — the card would say the route is clear while the stop list on the same
 * card named a station in the middle of it.
 */

import { canonicalStation, metroLinesInTitle } from './lines';
import { segmentStations } from './segments';
import type { ImpactVerdict, MetroLine, TransitItem, WatchedSegment } from './types';
import { METRO_LINES } from './types';

/**
 * The verdict, or null when the item names no watched line at all.
 *
 * Null is the common case by a wide margin — WTP publishes about buses and trams all day — and it
 * is the answer that costs nothing to reach, which is why it is reached first and from the title
 * alone.
 */
export function impactOf(item: TransitItem, segments: WatchedSegment[]): ImpactVerdict | null {
  const live = segments.filter((segment) => !segment.deleted);
  if (live.length === 0) return null;

  const lines = affectedLines(item).filter((line) => live.some((segment) => segment.line === line));
  if (lines.length === 0) return null;

  const onLine = live.filter((segment) => lines.includes(segment.line));

  /*
   * Nobody has read the prose yet, or the reading failed. Uncertain, and resolved upward — see the
   * header. An item still in the extraction queue looks exactly like one the model failed on, and
   * both are things you would rather be told about.
   */
  if (item.closedStops === undefined && !item.wholeLine) {
    return { impact: 'route', certain: false, segmentIds: onLine.map((s) => s.id), lines, stops: [] };
  }

  // The whole line down. No station list to intersect and none needed: every segment on that line
  // is in it by definition.
  if (item.wholeLine) {
    return { impact: 'route', certain: true, segmentIds: onLine.map((s) => s.id), lines, stops: [] };
  }

  /*
   * Place every station the extractor named. A name this build cannot place — a station that has
   * just opened, a hand-typed spelling, a model inventing — means the app does not know where on
   * the line this is, so the item can be escalated but never cleared.
   */
  const placed = new Map<MetroLine, Set<string>>(lines.map((line) => [line, new Set<string>()]));
  const allPlaced = new Set<string>();
  let unresolved = false;

  for (const raw of item.closedStops ?? []) {
    let found = false;
    for (const line of lines) {
      const station = canonicalStation(line, raw);
      if (!station) continue;
      placed.get(line)!.add(station);
      allPlaced.add(station);
      found = true;
    }
    // Unresolved only when it sits on none of the affected lines. A station named in an M1-and-M2
    // communiqué that belongs to just one of them is placed, not missing.
    if (!found) unresolved = true;
  }

  const hitSegments: WatchedSegment[] = [];
  const hitStops = new Set<string>();
  for (const segment of onLine) {
    const covered = new Set(segmentStations(segment));
    const overlap = [...placed.get(segment.line)!].filter((station) => covered.has(station));
    if (overlap.length === 0) continue;
    hitSegments.push(segment);
    for (const station of overlap) hitStops.add(station);
  }

  if (hitSegments.length > 0) {
    return {
      impact: 'route',
      certain: !unresolved,
      segmentIds: hitSegments.map((s) => s.id),
      lines,
      stops: [...hitStops],
    };
  }

  /*
   * Nothing landed on the route. That is a *line*-level answer only if every name was placed —
   * otherwise the one station this build could not resolve is exactly the one that might have been
   * on it, and calling this line-level would be inventing the reassurance.
   */
  if (unresolved) {
    return { impact: 'route', certain: false, segmentIds: onLine.map((s) => s.id), lines, stops: [] };
  }

  return { impact: 'line', certain: true, segmentIds: [], lines, stops: [...allPlaced] };
}

/**
 * Which metro lines an item is about.
 *
 * The union of what WTP's headline says and what the extractor read, and the union is deliberate.
 * The headline is a statement of fact and is the gate that keeps the model's bill near zero; the
 * extractor occasionally finds a line the headline understates, and this is a question where more
 * is the safe direction. Restricted to the metro either way — the rest of the network is in the
 * corpus, but nothing extracts stop-level detail for it.
 */
export function affectedLines(item: TransitItem): MetroLine[] {
  const named = new Set<MetroLine>(metroLinesInTitle(item.title));
  for (const line of item.lines ?? []) {
    if (METRO_LINES.includes(line)) named.add(line);
  }
  return METRO_LINES.filter((line) => named.has(line));
}

/** Whether a verdict may ring the phone at route priority, given which segments are muted. */
export function audibleAtRoute(verdict: ImpactVerdict, segments: WatchedSegment[]): boolean {
  if (verdict.impact !== 'route') return false;
  const muted = new Set(segments.filter((s) => s.muted).map((s) => s.id));
  return verdict.segmentIds.some((id) => !muted.has(id));
}
