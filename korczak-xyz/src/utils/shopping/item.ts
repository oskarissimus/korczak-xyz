/*
 * Shopping list — the shape of one line, and what counts as a believable one.
 *
 * One document per line, `uuid()`-keyed rather than derived from the name. That is the opposite of
 * the climate and routine records, which key on the night precisely so two phones converge on one
 * document, and the difference is the data: a night happens once, and "milk" happens every week.
 * Keying on the name would make this week's milk meet last week's tombstone — the case
 * `versioned.ts` documents as having once made a night unloggable for good — and would forbid two
 * lines that genuinely say the same word.
 *
 * What replaces that convergence is `matchName` and the `readd` path in the hook: adding a name the
 * list already carries revives *that* line instead of writing a second. It works whenever the two
 * devices have seen each other, which is the case worth optimising; two phones adding "milk" in a
 * tunnel still produce two lines, which is visible in the shop and tickable in one tap. Duplicate
 * rather than lose, as everywhere else here.
 *
 * `done` is a field rather than a tombstone, and that is the whole ergonomics of the thing: what you
 * have already picked up has to stay on the screen, or the mis-tap you made by the yoghurts is
 * unrecoverable and nobody can tell whether the bread was got or forgotten. Tombstoning is what
 * *Clear bought* does, deliberately, once you are out of the shop.
 *
 * Three fields exist only so two devices can be reconciled without asking a human anything:
 * `rev`, `updatedAt` and `writerId`. See `src/utils/babySleep/versioned.ts`.
 */

import { getClientId, uuid } from '../../lib/clientId';
import type { Versioned } from '../babySleep/versioned';

export interface ShoppingItem extends Versioned {
  /** What to buy, as typed. Trimmed and collapsed, never lowercased — it is shown, not compared. */
  name: string;
  /** Free text beside the name: "2", "500g", "the big one". Empty when there is none. */
  note: string;
  /** In the basket. Not a tombstone — see the header. */
  done: boolean;
  /** Epoch ms it was ticked, or null. Orders the bought half by the order you picked things up. */
  doneAt: number | null;
  /** Epoch ms it was added. Orders the to-buy half, and is what the cloud pull sorts on. */
  createdAt: number;
  /**
   * Who added it, once the list is shared. Set on creation and never on edit: it answers who *asked*
   * for the item, which ticking it off does not change. `writerId` cannot stand in for it — that is a
   * browser profile, so one person on a phone and a laptop is two writers.
   *
   * Optional, and it must stay optional: anything added while signed out has no author at all.
   */
  authorEmail?: string;
}

/** Long enough for "kawa ziarnista do ekspresu", short enough that a paste cannot fill the store. */
export const MAX_NAME_LENGTH = 120;
export const MAX_NOTE_LENGTH = 60;

/**
 * What the user typed, as it will be stored.
 *
 * Whitespace is collapsed rather than merely trimmed, because a double space is invisible on screen
 * and would otherwise make "milk" and "milk " two different lines to `matchName`.
 *
 * The cap is applied here rather than checked and reported, because there is nothing to report: the
 * boxes carry `maxLength`, so the only way past it is a record from somewhere else, and a line
 * truncated to 120 characters is still the line somebody meant. An empty name *is* refused, and by
 * the one caller that can tell the difference — `useShoppingList.add`, which returns `'empty'` so
 * the box keeps what was typed.
 */
export function cleanName(raw: string, max: number): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * The key two lines are "the same item" under.
 *
 * Case-folded and accent-folded, so `Mleko`, `mleko` and a phone that autocapitalised it are one
 * line, and so are `maka` and `mąka` — a Polish keyboard on iOS is exactly where that typo comes
 * from. Deliberately nothing cleverer: no stemming, no plural rule, because "jabłko" and "jabłka"
 * being one line is a guess, and a wrong guess here silently merges two things somebody wanted.
 */
export function matchName(name: string): string {
  return cleanName(name, MAX_NAME_LENGTH)
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks. `ł` has no decomposition, so it is named separately below.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

// --- constructing and editing -------------------------------------------------------------------

export interface ItemDraft {
  name: string;
  note: string;
}

/** `author` is the signed-in address, or undefined when nobody is signed in. */
export function newItem(draft: ItemDraft, now: number, author?: string): ShoppingItem {
  return {
    id: uuid(),
    name: cleanName(draft.name, MAX_NAME_LENGTH),
    note: cleanName(draft.note, MAX_NOTE_LENGTH),
    done: false,
    doneAt: null,
    createdAt: now,
    rev: 0,
    updatedAt: now,
    writerId: getClientId(),
    ...(author ? { authorEmail: author } : {}),
  };
}

export function editItem(prev: ShoppingItem, patch: Partial<ItemDraft>, now: number): ShoppingItem {
  return {
    ...prev,
    ...(patch.name != null ? { name: cleanName(patch.name, MAX_NAME_LENGTH) } : {}),
    ...(patch.note != null ? { note: cleanName(patch.note, MAX_NOTE_LENGTH) } : {}),
    rev: prev.rev + 1,
    updatedAt: now,
    writerId: getClientId(),
  };
}

/**
 * Tick or untick.
 *
 * `doneAt` is cleared on the way back, so an item picked up, put back and picked up again sorts by
 * when it was *last* taken rather than keeping a time that no longer happened.
 */
export function setDone(prev: ShoppingItem, done: boolean, now: number): ShoppingItem {
  return {
    ...prev,
    done,
    doneAt: done ? now : null,
    rev: prev.rev + 1,
    updatedAt: now,
    writerId: getClientId(),
  };
}

/**
 * Put a line back on the to-buy half because somebody asked for it again.
 *
 * The same write as unticking, and that is the point: re-adding a name the list already carries is
 * not a new record, so the other phone sees an ordinary edit rather than a second "milk". `createdAt`
 * moves to now so it sorts with the things just asked for, and a fresh `note` replaces the old one
 * when one was typed — an empty box means "no change", not "clear it".
 */
export function readd(prev: ShoppingItem, draft: ItemDraft, now: number): ShoppingItem {
  const note = cleanName(draft.note, MAX_NOTE_LENGTH);
  return {
    ...prev,
    // A re-add of a deleted line resurrects it. Safe here where it is not elsewhere, because the id
    // was minted rather than derived: this is the *same row* the user is looking at, not a new one
    // that happens to collide with a tombstone. `pickVersioned`'s causal rule then carries it,
    // the higher `rev` being what says the writer has seen the delete.
    deleted: false,
    done: false,
    doneAt: null,
    createdAt: now,
    ...(note ? { note } : {}),
    rev: prev.rev + 1,
    updatedAt: now,
    writerId: getClientId(),
  };
}

export function tombstoneItem(prev: ShoppingItem, now: number): ShoppingItem {
  return { ...prev, deleted: true, rev: prev.rev + 1, updatedAt: now, writerId: getClientId() };
}

/**
 * Coerce an untrusted record — from localStorage written by an older build, or from Firestore —
 * into an item, or reject it. Returns null rather than throwing, so one bad document cannot take
 * the whole list down with it.
 */
export function normalizeItem(raw: unknown): ShoppingItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.name !== 'string') return null;
  const name = cleanName(r.name, MAX_NAME_LENGTH);
  // An empty name is not a line anyone can act on, and it cannot be edited into one on the screen.
  if (name === '') return null;

  const done = r.done === true;
  const createdAt =
    typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0;
  return {
    id: r.id,
    name,
    note: typeof r.note === 'string' ? cleanName(r.note, MAX_NOTE_LENGTH) : '',
    done,
    // A tick with no time is believable — an older build, or a clock that returned nothing — so it
    // keeps the tick and loses only its place in the bought order.
    doneAt: done && typeof r.doneAt === 'number' && Number.isFinite(r.doneAt) ? r.doneAt : null,
    createdAt,
    rev: typeof r.rev === 'number' && r.rev >= 0 ? Math.floor(r.rev) : 0,
    updatedAt:
      typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : createdAt,
    writerId: typeof r.writerId === 'string' ? r.writerId : '',
    // Spread conditionally rather than assigned, so an item without an author has no key at all:
    // `setDoc` rejects an explicit `undefined`, and this record goes straight to Firestore.
    ...(typeof r.authorEmail === 'string' && r.authorEmail !== ''
      ? { authorEmail: r.authorEmail }
      : {}),
    ...(r.deleted === true ? { deleted: true as const } : {}),
  };
}
