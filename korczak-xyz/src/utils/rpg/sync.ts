/*
 * When each piece of the game kept in this browser last changed, for the account copy (`cloud.ts`;
 * owner, Oct 2026: "games on the phone and the computer don't sync within one account").
 *
 * The game's memory is three kinds of thing, each synced as one unit, last writer wins:
 *
 * - `world:<id>` — a world's bible, its atlas and its chronicle (`worldSave.ts`, `chronicle.ts`);
 * - `save:<id>` — the quest in progress in that world, or its absence (`save.ts`);
 * - `state` — which world is being played in each language.
 *
 * Every write in those modules calls `touch`, which stamps the unit with the time and tells whoever
 * listens (the pusher, when somebody is signed in). `pushed` remembers the last stamp the account
 * has, so while signed in a unit that was never pushed is never evicted from this browser
 * (`unsafeToDrop`).
 */

const KEY = 'rpg-sync';

interface Stamp {
  /** When this browser last changed it, or took the account's copy of it. */
  local: number;
  /** The local stamp the account is known to hold. */
  pushed: number;
}

type Stamps = Record<string, Stamp>;

function read(): Stamps {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(stamps: Stamps) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stamps));
  } catch {
    /* without stamps the next pull takes the account's copy */
  }
}

type Listener = (unit: string) => void;
const listeners = new Set<Listener>();

export function onTouch(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Something about `unit` changed in this browser. */
export function touch(unit: string, now = Date.now()): void {
  const stamps = read();
  // Strictly later than anything before, so two writes in one millisecond still order.
  const local = Math.max(now, (stamps[unit]?.local ?? 0) + 1);
  stamps[unit] = { local, pushed: stamps[unit]?.pushed ?? 0 };
  write(stamps);
  for (const l of listeners) l(unit);
}

export function stampOf(unit: string): Stamp {
  return read()[unit] ?? { local: 0, pushed: 0 };
}

export function allStamps(): Stamps {
  return read();
}

/** The account now holds this unit as of `at`. */
export function markPushed(unit: string, at: number): void {
  const stamps = read();
  const s = stamps[unit] ?? { local: at, pushed: 0 };
  stamps[unit] = { local: s.local, pushed: Math.max(s.pushed, at) };
  write(stamps);
}

/** This browser took the account's copy, stamped `at`: the two now agree. */
export function tookCloud(unit: string, at: number): void {
  const stamps = read();
  stamps[unit] = { local: at, pushed: at };
  write(stamps);
}

/**
 * Gives a unit written before there was syncing the time it was really last changed, so the first
 * pull lets a newer copy from another device win over it rather than the other way round.
 */
export function seed(unit: string, at: number): void {
  const stamps = read();
  if (stamps[unit]) return;
  stamps[unit] = { local: Math.max(1, at), pushed: 0 };
  write(stamps);
}

/** This browser no longer holds the unit; the next pull will bring the account's copy back. */
export function forget(unit: string): void {
  const stamps = read();
  delete stamps[unit];
  write(stamps);
}

let syncing = false;

/** Somebody is signed in and the pusher runs (`cloud.ts`'s `startSync`). */
export function setSyncing(on: boolean): void {
  syncing = on;
}

/**
 * A change the account has not got yet, so not to be evicted from this browser. Signed out there is
 * no account to wait for, and the oldest worlds go as they always did.
 */
export function unsafeToDrop(unit: string): boolean {
  if (!syncing) return false;
  const s = read()[unit];
  return Boolean(s && s.local > s.pushed);
}

export const worldUnit = (id: string) => `world:${id}`;
export const saveUnit = (id: string) => `save:${id}`;
export const STATE_UNIT = 'state';
