/*
 * Which interests reach a source, and how much of it they let through.
 *
 * An interest is written once and applied to everything, which is right — "klezmer concerts" is not
 * a fact about a feed — but it is read in exactly one place: beside the rows it decides about. A
 * list of interests on a tab of its own says what you asked for; it cannot say that the tag you
 * narrowed on is stamped by no source you watch, or that the one interest reaching this magazine
 * keeps sixty-seven of its sixty-eight articles. Both of those are this app's actual failures, and
 * both are invisible from either side alone.
 *
 * So the Sources tab draws the filters under the source they act on, counted over that source's own
 * rows. The counts come from `matchesInterest`, which is the same call the feed and the collector
 * make — a second "would this match?" written for a summary would agree with the real one until the
 * first bug fix, which is the argument this whole directory exists for.
 *
 * **Counted over the rows the caller hands in**, which on the Sources tab is the feed pull: what is
 * upcoming or undated, not the whole corpus. That is the honest set for the question being asked —
 * "what does this interest currently get me from here" — and it is the same set the `n collected`
 * chip beside it counts, so the two numbers on one card cannot contradict each other.
 *
 * Portable: no DOM, no React, no prose.
 */

import { isInterestActive, matchesInterest } from './match';
import type { EventRecord, Interest } from './types';

export interface SourceFilter {
  interest: Interest;
  /** How many of this source's rows it keeps. Never zero — see `filteringOf`. */
  kept: number;
}

export interface SourceFiltering {
  /** This source's rows in the set handed in. */
  rows: number;
  /** How many of them at least one live interest keeps, which is what reaches the feed. */
  kept: number;
  /** The interests that reach this source, most rows first. */
  filters: SourceFilter[];
  /**
   * Live interests that keep nothing from this source.
   *
   * A count rather than a list, and that is the one real judgement in this file. Every interest
   * under every source is five copies of the same six rows, and the useful reading of a zero is not
   * per source at all: an interest matching nothing *anywhere* is a dead interest, which is a
   * question for the Interests tab. Here the number answers the narrower one — how much of what you
   * have asked for has anything to say about this page.
   */
  silent: number;
}

/**
 * What this account's interests do to one source's rows.
 *
 * `forPush: false` — a muted interest still filters the feed, so it still belongs in the list of
 * what reaches you. Muting says "do not wake me", and a summary that dropped muted interests would
 * report a source as unwatched when it is merely quiet.
 *
 * Deleted interests are gone by `isInterestActive`, tombstones included: they are rows the sync
 * still carries and nothing anybody asked for.
 */
export function filteringOf(events: EventRecord[], interests: Interest[]): SourceFiltering {
  const live = interests.filter((interest) => isInterestActive(interest, { forPush: false }));

  const counts = new Map<string, number>();
  let kept = 0;
  for (const event of events) {
    let matchedAny = false;
    for (const interest of live) {
      if (!matchesInterest(event, interest)) continue;
      matchedAny = true;
      counts.set(interest.id, (counts.get(interest.id) ?? 0) + 1);
    }
    if (matchedAny) kept += 1;
  }

  const filters = live
    .map((interest) => ({ interest, kept: counts.get(interest.id) ?? 0 }))
    .filter((row) => row.kept > 0)
    // Count first, then the name, so the list does not reshuffle between renders on a tie.
    .sort((a, b) => b.kept - a.kept || a.interest.label.localeCompare(b.interest.label));

  return { rows: events.length, kept, filters, silent: live.length - filters.length };
}

/**
 * The corpus split by the adapter that produced each row — the first half of every event id, and
 * what `eventSources` health and the source catalogue are both keyed on.
 *
 * One pass rather than a filter per source: the Sources tab draws five cards over two thousand
 * rows and asks each card three different questions about its own slice.
 */
export function bySource(events: EventRecord[]): Map<string, EventRecord[]> {
  const grouped = new Map<string, EventRecord[]>();
  for (const event of events) {
    const held = grouped.get(event.source);
    if (held) held.push(event);
    else grouped.set(event.source, [event]);
  }
  return grouped;
}
