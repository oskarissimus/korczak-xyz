/*
 * Merging two devices' drilling.
 *
 * The typing trainer reconciles by lineage because its progress is a mutable document that two
 * devices can genuinely branch: the same field, edited twice, and somebody's edit has to lose.
 * This data is not that shape, so it does not need that machinery — and pretending it does
 * would import a conflict model, and a conflict dialog, for a conflict that cannot happen.
 *
 * Two facts do the work:
 *
 *   1. An answer is immutable and uniquely identified. Two devices never write the same event,
 *      so merging their logs is a union by id. Nothing is overwritten, so nothing is lost.
 *   2. Card state is a pure fold of the answers applied to it — `rate()` takes `now` rather
 *      than reading the clock, precisely so this holds. The deck is therefore derived, and the
 *      merged deck is what you get by folding the merged log.
 *
 * The deck is still cached, because the log it was folded from gets pruned once its sessions
 * are safely in the cloud. `foldedThrough` records how far the cache has consumed, which is
 * what distinguishes "these events go on top" from "the fold has to start again".
 */

import { createCard, rate } from './srs';
import type { Deck, DeckCache, ReviewEvent } from './types';

export function emptyCache(): DeckCache {
  return { version: 1, deck: {}, foldedThrough: 0, logComplete: true };
}

export function foldEvent(deck: Deck, event: ReviewEvent): Deck {
  const card = deck[event.cardId] ?? createCard(event.cardId);
  return { ...deck, [event.cardId]: rate(card, event.rating, event.at, event.ms) };
}

const byTime = (a: ReviewEvent, b: ReviewEvent) => a.at - b.at || a.id.localeCompare(b.id);

/**
 * Fold events onto a deck in time order. Sorting here is what makes the result order-free.
 *
 * One copy of the deck, then mutated in place. `foldEvent` spreads a fresh deck per answer,
 * which is right for a single answer and quadratic for a rebuild — a year of practice is tens
 * of thousands of answers across 150-odd cards.
 */
export function foldEvents(deck: Deck, events: ReviewEvent[]): Deck {
  if (events.length === 0) return deck;
  const next = { ...deck };
  for (const event of [...events].sort(byTime)) {
    const card = next[event.cardId] ?? createCard(event.cardId);
    next[event.cardId] = rate(card, event.rating, event.at, event.ms);
  }
  return next;
}

export function rebuildDeck(events: ReviewEvent[]): Deck {
  return foldEvents({}, events);
}

/** Union by id, in time order. Duplicates keep the copy already held. */
export function mergeEvents(known: ReviewEvent[], incoming: ReviewEvent[]): ReviewEvent[] {
  const byId = new Map(known.map((e) => [e.id, e]));
  for (const event of incoming) if (!byId.has(event.id)) byId.set(event.id, event);
  return [...byId.values()].sort(byTime);
}

export function newestAt(events: ReviewEvent[]): number {
  return events.reduce((max, e) => Math.max(max, e.at), 0);
}

export type ReconcileMode = 'unchanged' | 'append' | 'rebuild' | 'append-late';

export interface ReconcileResult {
  cache: DeckCache;
  events: ReviewEvent[];
  novel: ReviewEvent[];
  mode: ReconcileMode;
}

/**
 * Take in events from elsewhere and bring the cached deck up to date.
 *
 * Three outcomes:
 *
 *   - **append** — everything new happened after the cache's high-water mark, so it folds
 *     straight on top. The ordinary case: this device drilled, then another one did.
 *   - **rebuild** — the new events interleave with ones already folded (both devices drilled
 *     while offline). The local log is complete, so the honest answer is to fold the union
 *     from scratch, which is what a single device doing both sittings would have produced.
 *   - **append-late** — they interleave but the local log has been pruned, so there is nothing
 *     to rebuild from. The events are folded on top anyway: a schedule computed from an older
 *     `now` lands a due date in the past, which costs the card an early appearance and nothing
 *     else. The caller can avoid this entirely by handing over the full cloud log, which is
 *     never pruned.
 */
export function reconcileDeck(
  cache: DeckCache,
  known: ReviewEvent[],
  incoming: ReviewEvent[],
  options: { completeLog?: boolean } = {}
): ReconcileResult {
  const knownIds = new Set(known.map((e) => e.id));
  const novel = incoming.filter((e) => !knownIds.has(e.id));
  if (novel.length === 0) {
    return { cache, events: known, novel: [], mode: 'unchanged' };
  }

  const events = mergeEvents(known, novel);
  const interleaved = novel.some((e) => e.at <= cache.foldedThrough);
  // Whether the union about to be folded is the entire history. The caller may know it is even
  // though the stored log has been pruned — a pull of the whole account is exactly that. It is
  // the log being folded that has to be complete, not the log on disk.
  const complete = options.completeLog ?? cache.logComplete;

  if (interleaved && complete) {
    return {
      cache: {
        version: 1,
        deck: rebuildDeck(events),
        foldedThrough: newestAt(events),
        logComplete: true,
      },
      events,
      novel,
      mode: 'rebuild',
    };
  }

  return {
    cache: {
      ...cache,
      deck: foldEvents(cache.deck, novel),
      foldedThrough: Math.max(cache.foldedThrough, newestAt(novel)),
    },
    events,
    novel,
    mode: interleaved ? 'append-late' : 'append',
  };
}

/** Fold this device's own answers in. They are always the newest thing the cache has seen. */
export function recordLocal(cache: DeckCache, events: ReviewEvent[]): DeckCache {
  if (events.length === 0) return cache;
  return {
    ...cache,
    deck: foldEvents(cache.deck, events),
    foldedThrough: Math.max(cache.foldedThrough, newestAt(events)),
  };
}
