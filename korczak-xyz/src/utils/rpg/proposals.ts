/*
 * The menu's four proposed worlds (owner, 2 Nov 2026: "the player opens the game and has four
 * proposed worlds generated for them … each with a cover picture, and under them the menu as it
 * is"), drawn from the pool the server makes once a day (owner, 9 Nov 2026: "the start screen should
 * load at once and not wait for something" — `proposalPool.ts` has the pool, the files and why).
 *
 * - **At once**: the pool last read is kept in localStorage `rpg-proposal-pool` (one language, the
 *   last one played in), so a returning player's four are on the first frame. The file is read again
 *   in the background — started by the page's own inline script before this bundle has even loaded
 *   (`src-rpg/components/MenuSkeleton.astro`, `window.__rpgPool`) — and only replaces the four on
 *   screen when there were none.
 * - **A first visit** shows four placeholder cards of the same size until the file comes, ~100 ms.
 * - **A language with no file yet** shows the English pool at once and asks rpgDemo to translate it
 *   (`{kind:'proposals', lang}`); the same four cards then change their words, not their size.
 * - **Picked once, not offered again**: a tap keeps the id in `rpg-proposals-used`, which `drawFour`
 *   skips. ↻ draws four others from the pool — no model, no wait, no cost.
 * - **In the `~` console**: `ProposalStats` says where the four came from, how big the pool is, when
 *   it was written and how long the file took.
 */

import { rpgSet } from './storage';
import { drawFour, poolUrl, readPool, type Pool, type PoolItem } from './proposalPool';
import { rpgDemoUrl } from './demo';
import type { Lang } from './quest';

export const POOL_KEY = 'rpg-proposal-pool';
export const USED_KEY = 'rpg-proposals-used';
const USED_MAX = 300;

export interface ProposalsView {
  lang: Lang | null;
  /** The four on screen. */
  items: PoolItem[];
  /** The whole pool they were drawn from. */
  pool: PoolItem[];
  /** The pool's language: the game's, or English while that one is being translated. */
  poolLang: Lang | null;
  /** When the server wrote the pool, ms. */
  at: number | null;
  /** Where the four on screen came from. */
  source: 'kept' | 'file' | 'server' | null;
  /** How long the file took, ms. */
  ms: number | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: ProposalsView = { lang: null, items: [], pool: [], poolLang: null, at: null, source: null, ms: null, loading: false, error: null };

let view: ProposalsView = EMPTY;
const listeners = new Set<() => void>();

export function subscribeProposals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function proposalsView(): ProposalsView {
  return view;
}

function set(patch: Partial<ProposalsView>): void {
  view = { ...view, ...patch };
  for (const l of listeners) l();
}

function project(): string | null {
  return (import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined) ?? null;
}

function readKept(lang: Lang): Pool | null {
  try {
    const pool = readPool(JSON.parse(localStorage.getItem(POOL_KEY) ?? 'null'));
    return pool && pool.lang === lang && pool.items.length ? pool : null;
  } catch {
    return null;
  }
}

function keep(pool: Pool): void {
  rpgSet(POOL_KEY, JSON.stringify(pool));
}

function usedIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(USED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** What the page's inline script already asked for, if it asked for this language. */
function early(lang: Lang): Promise<unknown> | null {
  const w = typeof window === 'undefined' ? null : (window as unknown as { __rpgPool?: { lang?: string; promise?: Promise<unknown> } }).__rpgPool;
  if (!w || w.lang !== lang || !w.promise) return null;
  const promise = w.promise;
  delete (window as unknown as { __rpgPool?: unknown }).__rpgPool;
  return promise;
}

/** The file for `lang`: null when there is none yet (404), thrown on any other failure. */
async function fetchFile(lang: Lang): Promise<Pool | null> {
  const asked = early(lang);
  if (asked) {
    const raw = await asked.catch(() => undefined);
    if (raw !== undefined) return raw === null ? null : readPool(raw);
  }
  const p = project();
  if (!p) throw new Error('no Firebase project in this build');
  const r = await fetch(poolUrl(p, lang));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`proposals ${r.status}`);
  return readPool(await r.json());
}

/** The server makes the file (`{kind:'proposals'}`): a translation, or a first English pool. */
async function askServer(lang: Lang): Promise<Pool | null> {
  const url = rpgDemoUrl();
  if (!url) return null;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'proposals', lang }) });
  if (!r.ok) throw new Error(`proposals ${r.status}`);
  return readPool(await r.json());
}

/** A pool came: kept, and shown when nothing is; four already on screen get only their words in this language. */
function absorb(lang: Lang, pool: Pool, source: ProposalsView['source']): void {
  if (view.lang !== lang || !pool.items.length) return;
  if (pool.lang === lang) keep(pool);
  const byId = new Map(pool.items.map((p) => [p.id, p]));
  const items = view.items.length ? view.items.map((p) => byId.get(p.id) ?? p) : drawFour(pool.items, usedIds());
  set({ items, pool: pool.items, poolLang: pool.lang, at: pool.at, source: view.items.length ? view.source : source });
}

let asking: Lang | null = null;

/** The menu is showing in `lang`: four at once from what this browser kept, and the file read again. */
export function ensureProposals(lang: Lang): void {
  if (view.lang === lang && (view.items.length || view.loading)) return;
  // The sets the page used to write itself, before the pool: nothing reads them any more.
  try {
    localStorage.removeItem('rpg-proposals');
  } catch {
    /* a blocked store */
  }
  const kept = readKept(lang);
  view = { ...EMPTY, lang, ...(kept ? { items: drawFour(kept.items, usedIds()), pool: kept.items, poolLang: lang, at: kept.at, source: 'kept' as const } : {}) };
  for (const l of listeners) l();
  void refresh(lang);
}

async function refresh(lang: Lang): Promise<void> {
  if (asking === lang) return;
  asking = lang;
  set({ loading: true, error: null });
  const started = performance.now();
  try {
    const file = await fetchFile(lang);
    if (view.lang !== lang) return;
    set({ ms: Math.round(performance.now() - started) });
    if (file?.items.length) {
      absorb(lang, file, 'file');
      return;
    }
    // No file in this language yet: the English meanwhile, and the server makes this one.
    if (lang !== 'en') {
      const english = await fetchFile('en').catch(() => null);
      if (english?.items.length) absorb(lang, english, 'file');
    }
    const made = await askServer(lang);
    if (made?.items.length) absorb(lang, made, 'server');
    else if (!view.items.length) set({ error: 'no proposals yet' });
  } catch (e) {
    if (view.lang === lang) set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    if (asking === lang) asking = null;
    if (view.lang === lang) set({ loading: false });
  }
}

/** ↻: four others from the pool, none of the four on screen. */
export function otherProposals(): void {
  if (!view.pool.length) return;
  const skip = usedIds();
  for (const p of view.items) skip.add(p.id);
  set({ items: drawFour(view.pool, skip) });
}

/** A proposal was picked: never offered here again, and the next visit draws four others. */
export function pickedProposal(id: string): void {
  const used = [...usedIds()].filter((x) => x !== id);
  used.push(id);
  rpgSet(USED_KEY, JSON.stringify(used.slice(-USED_MAX)));
  view = { ...EMPTY };
  for (const l of listeners) l();
}
