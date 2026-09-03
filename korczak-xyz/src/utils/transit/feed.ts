/*
 * The corpus, arranged for the screen.
 *
 * Three sections in a fixed order, and they are the app's whole argument: what is on the journey,
 * what is on the lines the journey uses, and what else the feed carried. The first two are exactly
 * the two notification kinds, drawn from the same `impactOf` call the notifier makes — so the
 * screen can be checked against the phone, which is the only way to find out that a filter is
 * lying.
 *
 * The third section, `other`, is the falsifiability half and it is off by default. A route filter
 * is otherwise unprovable: a communiqué that was correctly judged irrelevant and one that was
 * silently dropped look identical from the outside, and the whole point of an app that decides what
 * not to tell you is being able to see what it decided. That is the argument the events app makes
 * for its `Filtered out` view, and it is the same one.
 */

import { impactOf } from './impact';
import { hashOfExtract } from './normalize';
import type { FeedKind, ImpactVerdict, TransitItem, WatchedSegment } from './types';

export type SectionKey = 'route' | 'line' | 'other';

export const SECTION_ORDER: readonly SectionKey[] = ['route', 'line', 'other'];

export interface FeedRow {
  item: TransitItem;
  /** Null for an item touching no watched line. Always drawn, never inferred from the section. */
  verdict: ImpactVerdict | null;
}

export interface FeedSection {
  key: SectionKey;
  rows: FeedRow[];
}

export interface FeedOptions {
  now: number;
  /** How far back to look. Days. */
  maxAgeDays?: number;
  /** `undefined` for both feeds — the ordinary case, since a closure and a reroute are one worry. */
  feed?: FeedKind;
  /** Whether to include items that touch no watched line at all. */
  includeOther?: boolean;
}

export interface TransitFeed {
  sections: FeedSection[];
  /** Every metro item in the window, whether or not it is on a watched line. For the counts line. */
  metroCount: number;
  /** How many of those the extractor has read, so a dead extractor is visible rather than inferred. */
  extractedCount: number;
  /** The whole window, buses and trams included. What `other` would show. */
  totalCount: number;
}

const DEFAULT_MAX_AGE_DAYS = 14;

export function buildTransitFeed(
  items: TransitItem[],
  segments: WatchedSegment[],
  options: FeedOptions,
): TransitFeed {
  const horizon = options.now - (options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 86400000;

  const inWindow = items
    .filter((item) => item.publishedAt >= horizon)
    .filter((item) => options.feed === undefined || item.feed === options.feed)
    // Newest first. A communiqué is news, and the useful ordering for news is the obvious one.
    .sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));

  const rows: FeedRow[] = inWindow.map((item) => ({ item, verdict: impactOf(item, segments) }));

  const bucket: Record<SectionKey, FeedRow[]> = { route: [], line: [], other: [] };
  for (const row of rows) {
    if (row.verdict?.impact === 'route') bucket.route.push(row);
    else if (row.verdict?.impact === 'line') bucket.line.push(row);
    else bucket.other.push(row);
  }

  const sections = SECTION_ORDER.filter(
    (key) => key !== 'other' || options.includeOther === true,
  ).map((key) => ({ key, rows: bucket[key] }));

  /*
   * The metro tally counts what an extractor *should* have read, which is items naming a metro line
   * — not items that reached a watched segment. Measured over the matched rows it could never
   * expose the failure it exists to expose: an item nobody read has no verdict, so a stopped
   * extractor makes the numerator and the denominator fall together.
   */
  const metro = rows.filter((row) => isMetro(row.item));

  return {
    sections,
    metroCount: metro.length,
    extractedCount: metro.filter((row) => row.item.extractHash !== undefined).length,
    totalCount: rows.length,
  };
}

/** Whether the extractor was ever supposed to look at this item. See `EXTRACTED_LINES`. */
export function isMetro(item: TransitItem): boolean {
  return item.titleLines.some((line) => line === 'M1' || line === 'M2') || (item.lines?.length ?? 0) > 0;
}

/**
 * Whether this item's reading is older than its text — WTP edited it and nobody has re-read it.
 *
 * Compares only the content half of the stored hash: the version prefix means "the prompt changed",
 * which is a fact about a build and not something to tell the reader their communiqué was edited
 * about. See `hashOfExtract`. Never read at all is a third state and returns false here — the card
 * draws that one from `extractHash === undefined`, and the two must not share a badge.
 */
export function extractionIsStale(item: TransitItem): boolean {
  return item.extractHash !== undefined && hashOfExtract(item.extractHash) !== item.contentHash;
}
