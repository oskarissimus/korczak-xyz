/*
 * Which trainer a card belongs to, and how a card id says so.
 *
 * A sitting draws from two decks at once. `src/utils/srs/queue.ts` can hold both in one queue
 * because a card id is an opaque string to it — but the two grammars overlap in shape, and
 * `find:1-4` and `degrees:9:145` have to be told apart on the way back out. So a card entering a
 * mixed queue is *qualified* with its trainer's prefix, and unqualified again the moment the
 * sitting needs to do anything real with it.
 *
 * **A qualified id exists only inside one sitting's queue.** It is never written to a
 * `ReviewEvent`, never to localStorage, never to Firestore. The two trainers keep the ids they
 * always had, which is what lets this merge happen without touching a single stored record —
 * see the *deck is derived* argument in `src/utils/srs/replay.ts` for why that matters.
 *
 * `|` is the separator because neither grammar uses it: fretboard ids are built from `:` and `-`
 * (`find:1-4:b`, `allNote:4:de`) and so are transpose ids (`transpose:9-0:145:in`).
 * `trainers.test.ts` asserts that over the whole of both scopes rather than trusting the claim.
 */

export type TrainerId = 'fretboard' | 'transpose';

export const TRAINERS: TrainerId[] = ['fretboard', 'transpose'];

/** The character that can only be a trainer separator, because no card id contains one. */
export const QUALIFIER = '|';

const PREFIX: Record<TrainerId, string> = {
  fretboard: `fb${QUALIFIER}`,
  transpose: `tp${QUALIFIER}`,
};

export function isTrainerId(value: unknown): value is TrainerId {
  return typeof value === 'string' && (TRAINERS as string[]).includes(value);
}

export function qualify(trainer: TrainerId, cardId: string): string {
  return `${PREFIX[trainer]}${cardId}`;
}

/**
 * Split a qualified id back into the trainer and the card id that trainer knows.
 *
 * Returns null for anything that is not a qualified id, rather than guessing — an unqualified id
 * reaching this function means something upstream leaked a raw card id into a mixed queue, and
 * silently attributing it to a trainer would file one deck's answer in the other's log.
 */
export function unqualify(id: string): { trainer: TrainerId; cardId: string } | null {
  for (const trainer of TRAINERS) {
    const prefix = PREFIX[trainer];
    if (id.startsWith(prefix)) {
      const cardId = id.slice(prefix.length);
      return cardId.length > 0 ? { trainer, cardId } : null;
    }
  }
  return null;
}

/** Which trainer a qualified id belongs to, or null if it is not one. */
export function trainerOf(id: string): TrainerId | null {
  return unqualify(id)?.trainer ?? null;
}
