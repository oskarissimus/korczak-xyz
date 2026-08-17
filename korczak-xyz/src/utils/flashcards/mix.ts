/*
 * One sitting drawn from both decks.
 *
 * **The whole point is that this is one `buildQueue` call, not two queues woven together.**
 * Selection there is by due date (see `src/utils/srs/queue.ts`), so a single call means the sitting
 * takes whatever has waited longest across both trainers: a deck left alone for a fortnight fills
 * the sitting, and one that is caught up contributes nothing. Two queues built to their own lengths
 * and interleaved would guarantee each deck a share of every sitting — which sounds fair and is
 * actually the scheduler being overruled twice, once in each direction.
 *
 * What each trainer still owns is its own scope (the cards it hands over) and its own spread key.
 * This module knows neither; it knows only that ids from the two have to be told apart, which is
 * `trainers.ts`'s job.
 */

import type { Card } from '../srs/scheduler';
import { buildQueue, spreadBy } from '../srs/queue';
import type { QueueOptions, QueueShape } from '../srs/queue';
import { qualify, unqualify, type TrainerId } from './trainers';

/** How many cards apart two cards about the same subject are kept. Both trainers ask for 3. */
export const MIN_MIXED_GAP = 3;

export interface MixSource {
  trainer: TrainerId;
  /** That trainer's `cardsInScope(...)` — the curriculum, in no particular order. */
  cards: Card[];
  /**
   * That trainer's spread key for one of its own (unqualified) ids: `positionSubject` for the
   * fretboard, `cardSubject` for the transposition trainer.
   */
  subjectOf: (cardId: string) => string;
}

/**
 * Spread a mixed queue, honouring each trainer's own idea of what answers what.
 *
 * The subject is namespaced by trainer, so a neck card is never held apart from a chord card —
 * they cannot give each other away, and pretending they can would push apart cards that were
 * already fine and clump the ones that were not.
 */
function mixedSpread(sources: MixSource[], gap: number): (queue: string[]) => string[] {
  const subjectFor = new Map(sources.map((s) => [s.trainer, s.subjectOf]));
  return (queue) =>
    spreadBy(
      queue,
      (id) => {
        const split = unqualify(id);
        if (!split) return id;
        const subjectOf = subjectFor.get(split.trainer);
        return subjectOf ? `${split.trainer}|${subjectOf(split.cardId)}` : id;
      },
      gap
    );
}

/**
 * The order a mixed sitting asks its cards in. Every id it returns is qualified.
 *
 * `shape` is the merged app's, not either trainer's: one sitting has one length, and the ration of
 * new cards is a ration for the sitting rather than one per deck.
 */
export function buildMixedQueue(
  sources: MixSource[],
  shape: QueueShape,
  now: number,
  options: QueueOptions = {}
): string[] {
  const cards: Card[] = [];
  for (const source of sources) {
    for (const card of source.cards) {
      cards.push({ ...card, id: qualify(source.trainer, card.id) });
    }
  }
  return buildQueue(cards, shape, now, {
    ...options,
    spread: mixedSpread(sources, MIN_MIXED_GAP),
  });
}
