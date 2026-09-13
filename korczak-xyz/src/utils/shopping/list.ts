/*
 * Reading a pile of shopping lines back as a list.
 *
 * The reconciler is `src/utils/babySleep/versioned.ts`, imported rather than copied. Nothing in it
 * knows what a row is — an id, a `rev`, a writer and a tombstone is the whole contract — which is
 * exactly the property that lets a shopping line and a night's temperature share one merge, and it
 * is the same cross-app import `BabySleep.tsx` already makes of the flashcards' `mergeSync`. What
 * stays here is what is about *shopping*: which fields make two copies identical, what order a list
 * reads in, and which names to offer back.
 */

import type { ShoppingItem } from './item';
import { matchName } from './item';
import { applyLocal, mergeById, sameRevision } from '../babySleep/versioned';

/**
 * Whether two copies of a line are the same version — not merely which one wins.
 *
 * Without this check, every item the cloud already holds an identical copy of counts as a local win
 * and is re-uploaded on every sync. Every persisted field belongs here.
 */
function isSameVersion(a: ShoppingItem, b: ShoppingItem): boolean {
  return (
    sameRevision(a, b) &&
    a.name === b.name &&
    a.note === b.note &&
    a.done === b.done &&
    a.doneAt === b.doneAt &&
    a.createdAt === b.createdAt
  );
}

/**
 * Oldest first, and deterministically so.
 *
 * Oldest first because a list is read top to bottom and a line added while you were already reading
 * must not push the next thing you were about to pick up off the top. The id tiebreak is not
 * cosmetic: two lines added in the same millisecond — two phones, one merge — would otherwise order
 * by which side of the merge each arrived from, so the same two lists merged in the other order
 * would produce a different array and the merge would stop being commutative.
 */
function byCreatedAsc(a: ShoppingItem, b: ShoppingItem): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Most recently picked up first: the last thing that went in the basket is the one to check. */
function byDoneDesc(a: ShoppingItem, b: ShoppingItem): number {
  return (b.doneAt ?? 0) - (a.doneAt ?? 0) || a.id.localeCompare(b.id);
}

export interface ListMerge {
  items: ShoppingItem[];
  changed: boolean;
  /** Ids whose local version won, or which the remote has never seen — exactly what to push. */
  localWins: string[];
}

/** Union by id, resolved per line by `pickVersioned`. Idempotent and commutative. */
export function mergeItems(local: ShoppingItem[], remote: ShoppingItem[]): ListMerge {
  const merged = mergeById(local, remote, isSameVersion, byCreatedAsc);
  return { items: merged.records, changed: merged.changed, localWins: merged.localWins };
}

/** This device's own write, applied to its own copy. See `applyLocal` for why it is not a merge. */
export function applyLocalItems(items: ShoppingItem[], changed: ShoppingItem[]): ShoppingItem[] {
  return applyLocal(items, changed, byCreatedAsc);
}

export interface ListView {
  /** Still to buy, oldest first. */
  todo: ShoppingItem[];
  /** In the basket, most recently ticked first. */
  done: ShoppingItem[];
}

/**
 * The two halves the screen draws, from every stored record.
 *
 * Tombstones are storage's business and no caller's, so they are dropped here — the one place that
 * has to see them is `suggest`, which is what makes last week's list worth having kept.
 */
export function splitList(items: ShoppingItem[]): ListView {
  const live = items.filter((i) => !i.deleted);
  return {
    todo: live.filter((i) => !i.done).sort(byCreatedAsc),
    done: live.filter((i) => i.done).sort(byDoneDesc),
  };
}

/** How many suggestion chips the add row offers. One thumb-width row on a phone, and no more. */
export const SUGGESTION_LIMIT = 8;

/**
 * Names worth offering back, most-bought first.
 *
 * The whole point of keeping tombstones past the shop: a household buys the same twenty things, so
 * the second week's list is mostly a row of chips rather than twenty pieces of typing. Counted over
 * every record this device holds, bought and cleared included — a line that was added, ticked and
 * cleared is exactly the evidence that it gets bought.
 *
 * Grouped by `matchName` so `Mleko` and `mleko` are one chip, and labelled with the spelling most
 * recently used, so correcting a name sticks rather than being outvoted by a year of the old one.
 *
 * Anything on *this* list is left out — the basket included, not just the half still to buy. A chip
 * that offers you something you can see two rows below it is an invitation to a duplicate, and one
 * headed "bought before" sitting directly above the same word with a tick against it is simply a
 * lie about what it is showing. Re-wanting something already in the trolley is real and rare, and
 * its answer is the line itself, which unticks.
 */
export function suggest(items: ShoppingItem[], limit = SUGGESTION_LIMIT): string[] {
  const onList = new Set(items.filter((i) => !i.deleted).map((i) => matchName(i.name)));

  const seen = new Map<string, { count: number; label: string; at: number }>();
  for (const item of items) {
    const key = matchName(item.name);
    if (key === '' || onList.has(key)) continue;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { count: 1, label: item.name, at: item.updatedAt });
      continue;
    }
    prev.count += 1;
    if (item.updatedAt >= prev.at) {
      prev.label = item.name;
      prev.at = item.updatedAt;
    }
  }

  return [...seen.values()]
    // Ties break on recency, then on the label, so the row is stable between renders rather than
    // reshuffling under a thumb that is already reaching for a chip.
    .sort((a, b) => b.count - a.count || b.at - a.at || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((entry) => entry.label);
}

/**
 * The live line this name would land on, if any.
 *
 * What stops a second "milk": the add box consults this before minting a record, and a hit is
 * re-added rather than duplicated. Tombstones are included — a cleared line is the row the
 * suggestion chips are offering, and reviving it is what keeps one document per thing bought
 * instead of one per shopping trip.
 */
export function findByName(items: ShoppingItem[], name: string): ShoppingItem | null {
  const key = matchName(name);
  if (key === '') return null;
  let best: ShoppingItem | null = null;
  for (const item of items) {
    if (matchName(item.name) !== key) continue;
    // A line still on the list beats a bought one, which beats a cleared one — adding "milk" while
    // milk is already to-buy must touch *that* row, not resurrect a tombstone beside it.
    if (!best || rank(item) > rank(best)) best = item;
  }
  return best;
}

function rank(item: ShoppingItem): number {
  if (item.deleted) return 0;
  return item.done ? 1 : 2;
}
