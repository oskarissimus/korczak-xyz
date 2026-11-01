/*
 * Every write of the game's memory to localStorage (owner, 1 Nov 2026: "on the phone I moved everything
 * to the trash and made a new world, on the computer the worlds are not in the trash and the new one is
 * missing"). The phone had pushed all of it to the account, and the account's data synced fine into an
 * empty browser: the computer's browser was not keeping what it pulled. The origin's ~5 MB is shared with
 * the typing trainer and the rest of the site (`lib/localStorage.ts`), and a full store does not stop a
 * page — every `setItem` throws, a bare `catch {}` swallowed it, and the sync went on "taking" the
 * account's copy into a store that kept nothing. The typing trainer learnt the same lesson earlier
 * (`.claude/rules/typing.md`, *Local storage budget*).
 *
 * So a write that finds the store full first gives back what the game can always get again — the
 * console transcripts in the saves, and the atlas and quest of worlds in the trash that the account
 * already holds — and tries once more. If that is not enough it is reported to Sentry (once per key per
 * page load, with the biggest keys on the origin) and `storageFull()` turns on, which the menu shows.
 */

import { isQuotaError, storageBytes } from '../../lib/localStorage';
import { log } from '../../lib/logger';

let full = false;
const reported = new Set<string>();
const listeners = new Set<() => void>();

/** Whether a write of the game's memory failed for want of room in this page load. */
export function storageFull(): boolean {
  return full;
}

export function onStorageFull(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The biggest keys on the origin, in KB, for the report. */
export function biggestKeys(n = 8): Record<string, number> {
  const sizes: [string, number][] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k != null) sizes.push([k, Math.round((localStorage.getItem(k)?.length ?? 0) / 1024)]);
    }
  } catch {
    /* nothing to say */
  }
  return Object.fromEntries(sizes.sort((a, b) => b[1] - a[1]).slice(0, n));
}

function readJson(key: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Gives back what the game can get again, without going through `rpgSet` (no loop). Returns the
 * characters freed.
 */
export function makeRoom(): number {
  const before = storageBytes();
  const saves = readJson('rpg-saves') as Record<string, { transcript?: unknown[] }> | null;
  const worlds = readJson('rpg-worlds') as { library?: Record<string, { deleted?: number }> } | null;
  const stamps = (readJson('rpg-sync') ?? {}) as Record<string, { local: number; pushed: number }>;
  const onAccount = (unit: string) => {
    const s = stamps[unit];
    return !s || s.local <= s.pushed;
  };
  const trashed = Object.entries(worlds?.library ?? {})
    .filter(([, e]) => e?.deleted)
    .map(([id]) => id);
  try {
    if (saves) {
      // The transcript is only for the developer console; the account keeps its own copy.
      for (const g of Object.values(saves)) if (g && Array.isArray(g.transcript) && g.transcript.length) g.transcript = [];
      for (const id of trashed) if (onAccount(`save:${id}`)) delete saves[id];
      localStorage.setItem('rpg-saves', JSON.stringify(saves));
    }
    const atlases = readJson('rpg-atlas');
    if (atlases) {
      for (const id of trashed) if (onAccount(`world:${id}`)) delete atlases[id];
      localStorage.setItem('rpg-atlas', JSON.stringify(atlases));
    }
  } catch {
    /* even the smaller copies did not fit; what was freed before stays freed */
  }
  return Math.max(0, before - storageBytes());
}

/** Writes one key of the game's memory; false when it could not be kept. */
export function rpgSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    if (reported.delete(key)) log.info('rpg.storage.recovered', { key });
    return true;
  } catch (e) {
    if (!isQuotaError(e)) {
      report(key, value, e, 0);
      return false;
    }
  }
  const freed = makeRoom();
  try {
    localStorage.setItem(key, value);
    log.warn('rpg.storage.madeRoom', { key, freedKb: Math.round(freed / 1024) });
    return true;
  } catch (e) {
    report(key, value, e, freed);
    return false;
  }
}

function report(key: string, value: string, e: unknown, freed: number) {
  if (isQuotaError(e) && !full) {
    full = true;
    for (const l of listeners) l();
  }
  if (reported.has(key)) return;
  reported.add(key);
  log.error('rpg.storage.write.failed', {
    key,
    quota: isQuotaError(e),
    error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    needKb: Math.round(value.length / 1024),
    totalKb: Math.round(storageBytes() / 1024),
    freedKb: Math.round(freed / 1024),
    biggestKb: biggestKeys(),
  });
}
