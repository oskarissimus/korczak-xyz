/*
 * Deciding what to do when local and cloud progress disagree.
 *
 * The rule this replaces compared `lastPlayedAt` and kept whichever was larger. That cannot
 * distinguish the two situations that matter - one side being merely *stale* versus the two
 * having genuinely *branched* - and it trusts two devices' clocks to agree. When it guessed
 * wrong it discarded the loser silently.
 *
 * Instead each side carries a revision identity `(rev, writerId)`, and the client remembers a
 * bookmark: the identity both sides last held in common. Comparing three points rather than
 * two turns the question into a factual one. Whether a side *changed since the bookmark* is
 * decidable; which of two changes is "newer" is not.
 *
 * `rev` is a counter, but it is never compared by magnitude across writers - only for
 * equality as part of the pair. Two devices independently reaching rev 51 are two different
 * revisions, and that is exactly the case a magnitude comparison would get wrong.
 *
 * This module is pure and has no imports beyond types, so the decision table can be tested
 * directly (see reconcile.test.ts).
 */

import type { TypingProgress } from './types';

export interface SyncBookmark {
  rev: number;
  writerId: string;
}

export type DecisionKind =
  | 'in-sync' // both sides already hold the same revision
  | 'push' // local descends from cloud - upload it
  | 'pull' // cloud descends from local - adopt it
  | 'seed-cloud' // no cloud document yet
  | 'adopt-cloud' // nothing worth keeping locally
  | 'conflict'; // genuinely branched - only the user can choose

export interface Decision {
  kind: DecisionKind;
  reason: string; // short, machine-greppable; goes straight into the log
  suggested?: 'local' | 'cloud'; // conflict only: the side holding more progress
}

// Whether progress holds anything worth preserving. Mirrors isNonTrivialProgress in
// storage.ts; duplicated rather than imported to keep this module free of the storage layer
// (and therefore of `window`), which is what makes it testable in isolation.
function hasProgress(p: TypingProgress): boolean {
  return p.passageIndex > 0 || p.typed.length > 0 || p.totalKeystrokes > 0;
}

function sameRevision(a: { rev: number; writerId: string }, b: { rev: number; writerId: string }) {
  return a.rev === b.rev && a.writerId === b.writerId;
}

// A revision identity is only usable if a writer actually claimed it. Progress written before
// the lineage fields existed normalizes to `{ rev: 0, writerId: '' }`, which says nothing
// about who wrote it - two such records are not the same revision just because they look
// alike, so lineage comparison is skipped and ancestry decides instead.
function hasLineage(p: { rev: number; writerId: string }): boolean {
  return p.writerId !== '';
}

// The same position in the book with the same text typed into it.
export function contentEqual(a: TypingProgress, b: TypingProgress): boolean {
  return (
    a.passageIndex === b.passageIndex &&
    a.typed === b.typed &&
    a.totalKeystrokes === b.totalKeystrokes
  );
}

/*
 * Is `a` a point that `b` could have been reached from by typing forward?
 *
 * Content ancestry, used where lineage is unavailable or inconclusive.
 *
 * `strict` decides what to do about missing `typedHistory`, and the distinction matters.
 * Without history, all that can be compared is position and keystroke count - which two
 * genuinely divergent branches can easily satisfy by coincidence. So:
 *
 *   strict   - every finished section must be positively corroborated by both sides.
 *              Used when there is independent evidence of divergence (both sides moved past
 *              the bookmark), where a wrong `true` silently destroys work.
 *   lenient  - absent history is unknown rather than contradictory. Used on the legacy path,
 *              where no bookmark exists and no record ever will: conflicting there would put
 *              a dialog in front of every existing user on the first load after this ships,
 *              for a comparison that has no better evidence to offer.
 */
export function isAncestor(a: TypingProgress, b: TypingProgress, strict = false): boolean {
  if (a.passageIndex > b.passageIndex) return false;
  if (a.totalKeystrokes > b.totalKeystrokes) return false;
  if (a.completedPassages > b.completedPassages) return false;

  // Every section `a` finished must have been finished the same way in `b`.
  for (let i = 0; i < a.passageIndex; i++) {
    const ah = a.typedHistory[i];
    const bh = b.typedHistory[i];
    if (ah == null || bh == null) {
      if (strict) return false;
      continue;
    }
    if (ah !== bh) return false;
  }

  if (a.passageIndex === b.passageIndex) {
    // Same section: `a`'s partial text must be a prefix of `b`'s.
    return b.typed.startsWith(a.typed);
  }
  // `b` moved past the section `a` is still in, so what `b` recorded for that section must
  // begin with what `a` has typed into it so far.
  const bAtA = b.typedHistory[a.passageIndex];
  if (bAtA == null) return !strict;
  return bAtA.startsWith(a.typed);
}

// Which side to offer as the default when the user has to choose. "Further along" reads
// position first, then how far into the current section, then lifetime keystrokes as a
// last resort - the ordering a person would use looking at the two.
export function furtherAlong(local: TypingProgress, cloud: TypingProgress): 'local' | 'cloud' {
  if (local.passageIndex !== cloud.passageIndex) {
    return local.passageIndex > cloud.passageIndex ? 'local' : 'cloud';
  }
  if (local.typed.length !== cloud.typed.length) {
    return local.typed.length > cloud.typed.length ? 'local' : 'cloud';
  }
  if (local.totalKeystrokes !== cloud.totalKeystrokes) {
    return local.totalKeystrokes > cloud.totalKeystrokes ? 'local' : 'cloud';
  }
  return 'local';
}

// Ancestry-only decision, used when lineage cannot settle it. See isAncestor for what
// `strict` changes and why the caller gets to choose.
function byAncestry(
  local: TypingProgress,
  cloud: TypingProgress,
  reason: string,
  strict: boolean
): Decision {
  if (contentEqual(local, cloud)) return { kind: 'in-sync', reason: `${reason}:identical` };
  if (isAncestor(cloud, local, strict)) {
    return { kind: 'push', reason: `${reason}:cloud-is-ancestor` };
  }
  if (isAncestor(local, cloud, strict)) {
    return { kind: 'pull', reason: `${reason}:local-is-ancestor` };
  }
  return { kind: 'conflict', reason: `${reason}:diverged`, suggested: furtherAlong(local, cloud) };
}

/**
 * Decide what to do with a book's local and cloud progress.
 *
 * `base` is the bookmark: the revision identity both sides last held in common, or null if
 * this client has never completed a sync for this book.
 *
 * Callers must pass progress that has been through `normalizeProgress`, so the lineage fields
 * are present and `typedHistory` is either aligned or empty.
 */
export function reconcile(
  local: TypingProgress,
  cloud: TypingProgress | null,
  base: SyncBookmark | null
): Decision {
  if (!cloud) {
    return hasProgress(local)
      ? { kind: 'seed-cloud', reason: 'no-cloud-doc' }
      : { kind: 'in-sync', reason: 'no-cloud-doc:nothing-to-send' };
  }

  // Identical revisions need no comparison against the bookmark, and checking this first is
  // what makes a lost bookmark harmless rather than a spurious conflict.
  if (hasLineage(local) && sameRevision(local, cloud)) {
    return { kind: 'in-sync', reason: 'same-revision' };
  }

  if (!hasProgress(local) && hasProgress(cloud)) {
    return { kind: 'adopt-cloud', reason: 'local-empty' };
  }
  if (!hasProgress(cloud) && hasProgress(local)) {
    return { kind: 'push', reason: 'cloud-empty' };
  }
  if (!hasProgress(local) && !hasProgress(cloud)) {
    return { kind: 'in-sync', reason: 'both-empty' };
  }

  // Lineage comparison needs a bookmark and a writer on both sides. Without them, ancestry is
  // all there is - which is the case on the first load after this shipped, and after any
  // "clear site data".
  if (!base || !hasLineage(local) || !hasLineage(cloud)) {
    return byAncestry(local, cloud, base ? 'no-lineage' : 'no-bookmark', false);
  }

  // A writer cannot fall behind a bookmark it already reached by typing forward: the bookmark
  // records a revision this same client wrote. A lower rev from the same writer means the local
  // record was lost or rolled back - a failed localStorage write, a restored profile - not
  // edited. `localChanged` below asks only whether local differs from the bookmark, never in
  // which direction, so without this the rollback reads as progress and gets pushed, replacing
  // the cloud with a state the user already typed past. Ancestry can still tell whether the
  // cloud simply contains the local record (pull) or the two genuinely disagree (ask).
  if (local.writerId === base.writerId && local.rev < base.rev) {
    return byAncestry(local, cloud, 'local-behind-base', true);
  }

  const localChanged = !sameRevision(local, base);
  const cloudChanged = !sameRevision(cloud, base);

  if (!localChanged && !cloudChanged) {
    // Both still at the bookmark yet not equal to each other: the bookmark is describing a
    // revision that no longer matches its content. Don't trust it.
    return byAncestry(local, cloud, 'stale-bookmark', true);
  }
  if (localChanged && !cloudChanged) return { kind: 'push', reason: 'local-ahead-of-base' };
  if (!localChanged && cloudChanged) return { kind: 'pull', reason: 'cloud-ahead-of-base' };

  // Both moved since the bookmark. Usually a real branch - but a push whose bookmark write
  // was lost looks identical from here, and corroborated ancestry can still tell those apart.
  return byAncestry(local, cloud, 'both-changed', true);
}

/**
 * The progress to keep once a decision (or a user's choice) has picked a side.
 *
 * `bestWpm` is the one field that is never in conflict: it is a lifetime maximum, so a
 * discarded branch's record still stands. Everything else comes from the winner wholesale -
 * merging positions would invent a state neither side ever typed.
 */
export function mergeWinner(winner: TypingProgress, loser: TypingProgress): TypingProgress {
  const bestWpm = Math.max(winner.bestWpm, loser.bestWpm);
  if (bestWpm === winner.bestWpm) return winner;
  return { ...winner, bestWpm };
}

// Stamp the next revision of this book's progress. Called on every local mutation, so `rev`
// counts local edits; `writerId` is what keeps two devices' counters from being confused for
// one another.
export function bumpRevision(
  progress: TypingProgress,
  writerId: string,
  now: number = Date.now()
): TypingProgress {
  return { ...progress, rev: progress.rev + 1, writerId, updatedAt: now };
}
