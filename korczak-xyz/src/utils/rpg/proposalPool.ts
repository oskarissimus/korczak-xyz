/*
 * The pool the menu's four proposed worlds are drawn from (owner, 9 Nov 2026: "the start screen
 * should load at once and not wait for something. The proposed worlds can be static, lying on the
 * server and loading at once. A cron makes them once a day, new ones join a queue of the last 100,
 * and the player gets four drawn from it").
 *
 * - **Made on the server, once a day** (`functions/src/rpg/proposalPool.ts`, `rpgProposals`): eight
 *   new proposals in English, two of each `PROPOSAL_KINDS`, each with its cover, joining the front
 *   of the pool; the pool keeps the newest `POOL_SIZE`.
 * - **A file per language in the game's bucket**, `proposals/{lang}.json`, read by the page with a
 *   fixed download token (`poolUrl`): no function, no cold start, no sign-in, cached by the browser.
 *   English is the source; every other language is the same items translated, by id. Polish is made
 *   with every run; any other language the first time a player in it asks (`{kind:'proposals'}` on
 *   rpgDemo), and from then on with every run.
 * - **The page draws four** (`drawFour`): one of each kind where it can, never one this browser has
 *   already picked, and ↻ draws four others — no model, no wait.
 *
 * Shared by the page and the functions, so nothing here touches the network.
 */

import { downloadUrl } from './assetStore';
import { fallbackColors, IDEA_MAX, PROPOSAL_COUNT, PROPOSAL_KINDS, type Proposal } from './proposalScript';

/** How many proposals the pool keeps: the newest, about twelve days of them. */
export const POOL_SIZE = 100;
/** How many a day's run adds: two of each kind. */
export const POOL_DAILY = PROPOSAL_KINDS.length * 2;
/**
 * The download token every pool file carries. Not a secret: the files are public by design, and a
 * fixed token is what lets the page know the URL before anything has answered.
 */
export const POOL_TOKEN = 'every-rpg-proposal-pool';
export const POOL_DIR = 'proposals';

/** One proposal in the pool: a proposal with an id that is the same in every language, and its kind. */
export interface PoolItem extends Proposal {
  id: string;
  /** Its index in `PROPOSAL_KINDS`. */
  kind: number;
  /** When it was made, ms. */
  at: number;
}

export interface Pool {
  lang: string;
  /** When this file was written, ms. */
  at: number;
  items: PoolItem[];
}

export function poolPath(lang: string): string {
  return `${POOL_DIR}/${lang}.json`;
}

export function coverPath(id: string): string {
  return `${POOL_DIR}/covers/${id}.jpg`;
}

/** The bucket a project's game keeps its assets in: `RPG_BUCKET` in functions/src/runtime.ts. */
export function rpgBucket(project: string): string {
  return `${project}-rpg`;
}

/** Where a language's pool is read from. */
export function poolUrl(project: string, lang: string): string {
  return downloadUrl(rpgBucket(project), poolPath(lang), POOL_TOKEN);
}

const HEX = /^#[0-9a-f]{6}$/i;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** One item as read from a file, or null when it is not one. */
export function poolItem(raw: unknown): PoolItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 40);
  const name = str(r.name, 60);
  const pitch = str(r.pitch, 300);
  if (!id || !name || !pitch) return null;
  const colors =
    Array.isArray(r.colors) && r.colors.length === 2 && r.colors.every((c) => typeof c === 'string' && HEX.test(c))
      ? (r.colors as [string, string])
      : fallbackColors(name);
  const kind = Number(r.kind);
  return {
    id,
    kind: Number.isInteger(kind) && kind >= 0 && kind < PROPOSAL_KINDS.length ? kind : 0,
    at: Number(r.at) || 0,
    name,
    idea: str(r.idea, IDEA_MAX),
    pitch,
    genre: str(r.genre, 40),
    colors,
    picture: typeof r.picture === 'string' ? r.picture.slice(0, 300) : null,
    image: typeof r.image === 'string' && /^https:\/\//.test(r.image) ? r.image : null,
  };
}

/** A pool file, or null when it is not one; items that are not items are dropped. */
export function readPool(raw: unknown): Pool | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items)) return null;
  const items = r.items.map(poolItem).filter((p): p is PoolItem => p !== null);
  return { lang: str(r.lang, 16) || 'en', at: Number(r.at) || 0, items };
}

/** The new items in front of the old, one of each id and of each name, the newest `size` kept. */
export function mergePool(old: PoolItem[], fresh: PoolItem[], size = POOL_SIZE): PoolItem[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  const out: PoolItem[] = [];
  for (const p of [...fresh, ...old]) {
    const name = p.name.toLowerCase();
    if (ids.has(p.id) || names.has(name)) continue;
    ids.add(p.id);
    names.add(name);
    out.push(p);
    if (out.length >= size) break;
  }
  return out;
}

/**
 * Four to show: one of each kind where the pool has one, never one in `skip` (picked here before, or
 * on screen when ↻ asks for others), the rest from whatever is left. When `skip` leaves too few, the
 * skipped ones come back rather than an empty card.
 */
export function drawFour(items: PoolItem[], skip: ReadonlySet<string> = new Set(), random: () => number = Math.random): PoolItem[] {
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(random() * list.length)];
  const fresh = items.filter((p) => !skip.has(p.id));
  const from = fresh.length >= PROPOSAL_COUNT ? fresh : items;
  const out: PoolItem[] = [];
  for (let kind = 0; kind < PROPOSAL_KINDS.length && out.length < PROPOSAL_COUNT; kind++) {
    const p = pick(from.filter((x) => x.kind === kind && !out.includes(x)));
    if (p) out.push(p);
  }
  while (out.length < PROPOSAL_COUNT) {
    const p = pick(from.filter((x) => !out.includes(x)));
    if (!p) break;
    out.push(p);
  }
  return out;
}

/** The same items in another language: each field of `translated` by id, the English where it has none. */
export function withTranslation(source: PoolItem[], translated: PoolItem[]): PoolItem[] {
  const byId = new Map(translated.map((p) => [p.id, p]));
  return source.map((p) => {
    const t = byId.get(p.id);
    return t ? { ...p, name: t.name || p.name, idea: t.idea || p.idea, pitch: t.pitch || p.pitch, genre: t.genre || p.genre } : p;
  });
}

/** The words of some items as one flat object for a translation: `<id>.n`, `<id>.s`, `<id>.p`, `<id>.g`. */
export function translationEntries(items: PoolItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of items) {
    out[`${p.id}.n`] = p.name;
    if (p.idea) out[`${p.id}.s`] = p.idea;
    out[`${p.id}.p`] = p.pitch;
    if (p.genre) out[`${p.id}.g`] = p.genre;
  }
  return out;
}

/** The items again from a translation's answer, each field kept only when it came back as a string. */
export function fromTranslation(items: PoolItem[], raw: unknown): PoolItem[] {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const field = (key: string, max: number) => str(r[key], max);
  return items
    .map((p) => ({
      ...p,
      name: field(`${p.id}.n`, 60),
      idea: p.idea ? field(`${p.id}.s`, IDEA_MAX) : '',
      pitch: field(`${p.id}.p`, 300),
      genre: p.genre ? field(`${p.id}.g`, 40) : '',
    }))
    .filter((p) => p.name && p.pitch);
}

export function poolTranslationPrompt(languageName: string, entries: Record<string, string>): string {
  return [
    `Translate these proposed worlds for a role-playing video game from English into ${languageName}.`,
    'Each world has a name (`.n`), an idea of a few words (`.s`), a pitch of one or two sentences (`.p`) and a genre in a few words (`.g`).',
    `Answer with a JSON object with exactly the same keys, each value in natural, vivid ${languageName} as a native game localiser would write it.`,
    '- A name is invented: render it as a native speaker would name such a place — translate its meaning where it has one, keep it short and evocative.',
    '- A pitch keeps its length, tone and every concrete detail.',
    '- An idea stays two to six plain, lower-case words, as a player would type it ("piraci na pustyni", "kryminał w Krakowie 1920").',
    '- A genre stays two to four plain words.',
    '',
    JSON.stringify(entries),
  ].join('\n');
}
