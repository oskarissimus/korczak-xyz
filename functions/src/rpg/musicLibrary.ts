/*
 * The score library on the gateway: finding a track good enough for a world, and adding each score the
 * server's keys composed. The shared half and the measurements behind the threshold are at the top of
 * `korczak-xyz/src/utils/rpg/musicLibrary.ts`.
 *
 * - **Find** (`POST /music/find`, signed in): the world's track if it was given one before, else the
 *   library's closest over the threshold, which is then given to the world so it keeps it on every
 *   device. A miss is an answer, not an error: the page composes, as it always did.
 * - **Add** (`addToLibrary`, from `keepAudio`): a score kept by the gateway goes in the library when the
 *   server's keys paid for it (`diesel`) or an admin's own key did. A reader's own ElevenLabs key is
 *   theirs: what it composed is kept on their account and not handed to strangers.
 * - **Never in the way**: an embedding that fails, a missing Google key or a library that will not load
 *   is a miss and a Sentry event. The game composes and nothing is lost but the saving.
 */

import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';

import {
  MUSIC_CONFIG,
  MUSIC_EMBED_DIMS,
  MUSIC_EMBED_MODEL,
  MUSIC_LIBRARY,
  MUSIC_WORLDS,
  bestMatch,
  musicQueryOf,
  musicWorldKey,
  thresholdOf,
  type MusicFindAnswer,
} from '../../../korczak-xyz/src/utils/rpg/musicLibrary';
import { db } from '../runtime';
import { reportError } from '../sentry';
import { isAdminUid, readServerKeys } from './admin';
import { takeDaily } from './dailyCap';

interface LibraryItem {
  id: string;
  url: string;
  prompt: string;
  ms: number;
  embedding: number[];
}

/** The library and the threshold, kept a few minutes per instance; a track added here is in at once. */
const LIBRARY_MS = 5 * 60_000;
let cache: { at: number; items: LibraryItem[]; threshold: number } | null = null;

/** For tests. */
export function forgetMusicLibrary(): void {
  cache = null;
}

async function library(): Promise<{ items: LibraryItem[]; threshold: number }> {
  if (cache && Date.now() - cache.at < LIBRARY_MS) return cache;
  const [snap, config] = await Promise.all([db.collection(MUSIC_LIBRARY).get(), db.doc(MUSIC_CONFIG).get()]);
  const items: LibraryItem[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (typeof d.url === 'string' && Array.isArray(d.embedding) && d.embedding.length === MUSIC_EMBED_DIMS) {
      items.push({ id: doc.id, url: d.url, prompt: String(d.prompt ?? ''), ms: Number(d.ms) || 0, embedding: d.embedding as number[] });
    }
  }
  cache = { at: Date.now(), items, threshold: thresholdOf(config.data()?.threshold) };
  return cache;
}

/** The world line as a vector, on the server's Google key; null without one. */
export async function embedMusic(text: string, key?: string | null): Promise<number[] | null> {
  const google = key === undefined ? (await readServerKeys()).google : key;
  if (!google) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MUSIC_EMBED_MODEL}:embedContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': google },
    body: JSON.stringify({ content: { parts: [{ text }] }, taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: MUSIC_EMBED_DIMS }),
  });
  if (!r.ok) throw new Error(`embedding ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const values = ((await r.json()) as { embedding?: { values?: unknown } }).embedding?.values;
  return Array.isArray(values) && values.length === MUSIC_EMBED_DIMS ? (values as number[]) : null;
}

async function assign(uid: string, world: string, trackId: string, score: number): Promise<void> {
  await Promise.all([
    db.doc(`${MUSIC_WORLDS}/${musicWorldKey(uid, world)}`).set({ uid, world, track: trackId, score, at: Date.now() }),
    db.doc(`${MUSIC_LIBRARY}/${trackId}`).update({ uses: FieldValue.increment(1), lastUsedAt: Date.now() }),
  ]);
}

/** The answer to the page's question; never throws for a miss. */
export async function findMusic(uid: string, prompt: string, world: string | null): Promise<MusicFindAnswer> {
  const { items, threshold } = await library();
  const none: MusicFindAnswer = { hit: null, best: null, threshold, size: items.length };
  if (world) {
    const given = (await db.doc(`${MUSIC_WORLDS}/${musicWorldKey(uid, world)}`).get()).data();
    const track = typeof given?.track === 'string' ? items.find((i) => i.id === given.track) : undefined;
    if (track) return { ...none, hit: { id: track.id, url: track.url, prompt: track.prompt, ms: track.ms, score: Number(given?.score) || 1, assigned: true } };
  }
  const query = musicQueryOf(prompt);
  if (!query || items.length === 0) return none;
  if (!(await takeDaily('musicFind', { uid }))) return none;
  let vector: number[] | null = null;
  try {
    vector = await embedMusic(query);
  } catch (e) {
    reportError('rpgMusic.embed', e);
  }
  const best = vector ? bestMatch(vector, items) : null;
  if (!best) return none;
  const answer: MusicFindAnswer = { ...none, best: best.score };
  if (best.score < threshold) return answer;
  const { item, score } = best;
  if (world) await assign(uid, world, item.id, score).catch((e) => reportError('rpgMusic.assign', e));
  return { ...answer, hit: { id: item.id, url: item.url, prompt: item.prompt, ms: item.ms, score, assigned: false } };
}

export async function handleMusicFind(uid: string, body: Buffer | undefined, res: Response): Promise<void> {
  let asked: { prompt?: unknown; world?: unknown } = {};
  try {
    asked = JSON.parse(body?.toString('utf8') ?? '{}') as typeof asked;
  } catch {
    /* an unreadable body asks for nothing */
  }
  const prompt = typeof asked.prompt === 'string' ? asked.prompt.slice(0, 4000) : '';
  const world = typeof asked.world === 'string' && asked.world ? asked.world.slice(0, 120) : null;
  if (!prompt) {
    res.status(400).json({ reason: 'prompt', error: { message: 'music: no prompt' } });
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await findMusic(uid, prompt, world));
}

/**
 * A score the gateway just kept, into the library when the server's keys or an admin paid for it, and
 * given to its world. Never throws: the score is the reader's whether or not the library took it.
 */
export async function addToLibrary(
  uid: string,
  payer: string,
  t: { assetId: string; url: string; prompt: string; ms: number; model: string; world: string | null },
): Promise<void> {
  try {
    if (payer !== 'diesel' && !(payer === 'account' && (await isAdminUid(uid)))) return;
    const prompt = musicQueryOf(t.prompt);
    if (!prompt) return;
    const embedding = await embedMusic(prompt);
    if (!embedding) return;
    await db.doc(`${MUSIC_LIBRARY}/${t.assetId}`).set({
      url: t.url,
      prompt,
      ms: t.ms,
      model: t.model,
      embedding,
      embedModel: MUSIC_EMBED_MODEL,
      sourceUid: uid,
      world: t.world,
      uses: 1,
      at: Date.now(),
    });
    if (t.world) await db.doc(`${MUSIC_WORLDS}/${musicWorldKey(uid, t.world)}`).set({ uid, world: t.world, track: t.assetId, score: 1, at: Date.now() });
    cache = null;
  } catch (e) {
    reportError('rpgMusic.add', e);
  }
}
