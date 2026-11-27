/*
 * The score library (owner, 27 Nov 2026: "compose music once per world, a bit shorter, keep it in the
 * bucket and search the bucket before composing — a threshold where the music is good enough for the
 * world and we take it from the library, else compose and add it to the library").
 *
 * The half both runtimes share: compiled into the game and into the functions (`functions/tsconfig.json`),
 * so the page and the gateway agree on what is compared, how, and against what.
 *
 * - **What is compared** is the world's own music line (`worldMusic` in `music.ts`), not the whole
 *   prompt: the rules every track gets (`MUSIC_RULES`) are the same in each and would only pull every
 *   pair closer together. `musicQueryOf` takes them back off a prompt kept before.
 * - **How**: Gemini embeddings (`MUSIC_EMBED_MODEL`, `SEMANTIC_SIMILARITY`, 768 dimensions) and the
 *   cosine of the two. Measured on twelve made-up world lines, 27 Nov 2026: the same world said twice
 *   0.94–0.95, the same genre in another place ("dark slavic folk, misty marshes" against "dark
 *   medieval folk, cold northern forest") 0.89, a neighbouring genre (that against cosy Celtic folk)
 *   0.85, everything else 0.68–0.80. So `MUSIC_MATCH_DEFAULT` 0.88 takes the same genre and mood and
 *   composes for a neighbour; `rpgMusic/config.threshold` moves it without a deploy.
 * - **Against what**: every track in `rpgMusicLibrary` — a few hundred vectors at most for a long
 *   while, so a linear scan on the gateway (`bestMatch`) rather than a vector index.
 */

/** The gateway's route: POST `{ prompt, world }` → `MusicFindAnswer`. Signed in only. */
export const MUSIC_FIND_PATH = '/music/find';

export const MUSIC_EMBED_MODEL = 'gemini-embedding-2';
export const MUSIC_EMBED_DIMS = 768;

/** Good enough for this world: see the top of this file for the measurements behind it. */
export const MUSIC_MATCH_DEFAULT = 0.88;

/** Firestore: the library's tracks, the world each account's world was given, and the threshold. */
export const MUSIC_LIBRARY = 'rpgMusicLibrary';
export const MUSIC_WORLDS = 'rpgMusicWorlds';
export const MUSIC_CONFIG = 'rpgMusic/config';

/** The rules every track gets: it is a background score, and it must loop. */
export const MUSIC_RULES =
  'Instrumental only, no vocals, no choir singing words. Background score for exploring an open-world RPG: ' +
  'steady and unobtrusive, sitting under spoken dialogue, no big drops, no sudden stops, no fade-out. ' +
  'A seamless loop that ends the way it begins.';

/** The longest world line compared; the genesis writes at most 25 words. */
const QUERY_CHARS = 600;

/** A prompt as compared: without the rules and without a quest's mood (the score is the world's now). */
export function musicQueryOf(prompt: string): string {
  return prompt
    .replace(MUSIC_RULES, '')
    .replace(/\s*Mood: [^.]*\./, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, QUERY_CHARS);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** The closest track, whatever its score; null for an empty library. */
export function bestMatch<T extends { embedding: readonly number[] }>(query: readonly number[], items: readonly T[]): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = cosine(query, item.embedding);
    if (!best || score > best.score) best = { item, score };
  }
  return best;
}

/** A threshold from the config, kept to something that can mean "good enough". */
export function thresholdOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 1 ? value : MUSIC_MATCH_DEFAULT;
}

/** One account's world, as a document id. */
export function musicWorldKey(uid: string, world: string): string {
  return `${uid}_${world}`.replace(/[^\w-]/g, '_').slice(0, 300);
}

export interface MusicTrack {
  id: string;
  url: string;
  /** The world line it was composed for. */
  prompt: string;
  ms: number;
}

export interface MusicFindAnswer {
  /** The world's track: one it was given before (`assigned`), or a library track over the threshold. */
  hit: (MusicTrack & { score: number; assigned: boolean }) | null;
  /** The closest score in the library, a hit or not — what the console shows for tuning. */
  best: number | null;
  threshold: number;
  size: number;
}
