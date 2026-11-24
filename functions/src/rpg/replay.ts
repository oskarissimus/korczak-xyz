/*
 * The game's replays on the server (`korczak-xyz/src/utils/rpg/replay.ts` has the shape and the
 * reasons): `rpgDemo`'s `{kind:'replay'}` keeps a chunk of a session's events, and the admin's
 * `GET /admin/replays` and `GET /admin/replay?id` read them back.
 *
 * - `rpgReplays/{id}` is the session's record (who, where, its summary), `rpgReplays/{id}/
 *   rpgReplayChunks/{seq}` its events as one JSON string per chunk. No Firestore rule: written and
 *   read with the Admin SDK only.
 * - **Who** is the account the ID token in the body names, verified here; a token that does not
 *   verify (expired in a beacon, say) is ignored, never a reason to refuse — the uid already kept
 *   stays. A guest is the browser's guest id. No address, no e-mail is stored; the admin's list
 *   looks the e-mail up when it is read.
 * - **What it weighs** is capped by `REPLAY_LIMITS`: events per chunk, bytes per chunk, chunks per
 *   session. Every document carries `expireAt` (30 days), deleted by Firestore's TTL
 *   (`terraform/firestore.tf`, `terraform/rpg/data.tf`).
 */

import type { Response } from 'express';
import { getAuth } from 'firebase-admin/auth';

import {
  REPLAY_CHUNKS,
  REPLAY_COLLECTION,
  REPLAY_ID,
  REPLAY_LIMITS,
  cleanEvents,
  cleanOpen,
  cleanSummary,
  type ReplayDetail,
  type ReplayEvent,
  type ReplayMeta,
  type ReplaysPage,
} from '../../../korczak-xyz/src/utils/rpg/replay';
import { db } from '../runtime';

export class ReplayRefusal extends Error {
  constructor(message: string) {
    super(message);
  }
}

const DAY = 86_400_000;

async function uidOfToken(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return null;
  try {
    return (await getAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

/** One chunk of a session, from the game. Answers 204 whatever it kept; 400 only for a malformed one. */
export async function keepReplay(res: Response, body: Record<string, unknown>): Promise<void> {
  const id = typeof body.id === 'string' && REPLAY_ID.test(body.id) ? body.id : null;
  const seq = typeof body.seq === 'number' && Number.isInteger(body.seq) && body.seq >= 0 && body.seq < REPLAY_LIMITS.chunks ? body.seq : null;
  if (!id || seq === null) throw new ReplayRefusal('replay: bad id or seq');
  const events = cleanEvents(body.events);
  const now = Date.now();
  const startedAt =
    typeof body.startedAt === 'number' && Number.isFinite(body.startedAt) && body.startedAt <= now + 60_000 && body.startedAt > now - 7 * DAY
      ? Math.round(body.startedAt)
      : now;
  const uid = await uidOfToken(body.token);
  const expireAt = new Date(now + REPLAY_LIMITS.days * DAY);
  const session = db.collection(REPLAY_COLLECTION).doc(id);
  const batch = db.batch();
  const record: Record<string, unknown> = {
    id,
    startedAt,
    lastAt: now,
    chunks: seq + 1,
    summary: cleanSummary(body.summary),
    expireAt,
  };
  if (uid) record.uid = uid;
  if (seq === 0 || body.open) {
    const open = cleanOpen(body.open);
    Object.assign(record, { lang: open.lang, host: open.host, mobile: open.mobile, guest: open.guest });
  }
  batch.set(session, record, { merge: true });
  if (events.length) {
    batch.set(session.collection(REPLAY_CHUNKS).doc(String(seq).padStart(4, '0')), { seq, at: now, events: JSON.stringify(events), expireAt });
  }
  await batch.commit();
  res.status(204).send('');
}

function metaOf(id: string, data: FirebaseFirestore.DocumentData): ReplayMeta {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    id,
    startedAt: num(data.startedAt),
    lastAt: num(data.lastAt),
    uid: typeof data.uid === 'string' ? data.uid : null,
    guest: typeof data.guest === 'string' ? data.guest : null,
    lang: typeof data.lang === 'string' ? data.lang : '',
    host: typeof data.host === 'string' ? data.host : '',
    mobile: data.mobile === true,
    chunks: num(data.chunks),
    summary: cleanSummary(data.summary),
  };
}

/** The e-mails of these accounts, for the admin: looked up, never stored with the replay. */
async function emailsOf(uids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(uids)];
  for (let i = 0; i < unique.length; i += 100) {
    const found = await getAuth()
      .getUsers(unique.slice(i, i + 100).map((uid) => ({ uid })))
      .catch(() => null);
    for (const u of found?.users ?? []) out.set(u.uid, u.email ?? null);
  }
  return out;
}

/** The sessions last heard of between `from` and `to`, newest first, at most 300. */
export async function listReplays(from: number, to: number): Promise<ReplaysPage> {
  const snap = await db.collection(REPLAY_COLLECTION).where('lastAt', '>=', from).where('lastAt', '<=', to).orderBy('lastAt', 'desc').limit(300).get();
  const sessions = snap.docs.map((d) => metaOf(d.id, d.data()));
  const emails = await emailsOf(sessions.flatMap((s) => (s.uid ? [s.uid] : [])));
  for (const s of sessions) if (s.uid) s.email = emails.get(s.uid) ?? null;
  return { sessions, from, to };
}

/** One session with all its events, in order. */
export async function readReplay(id: string): Promise<ReplayDetail | null> {
  if (!REPLAY_ID.test(id)) return null;
  const ref = db.collection(REPLAY_COLLECTION).doc(id);
  const [snap, chunks] = await Promise.all([ref.get(), ref.collection(REPLAY_CHUNKS).orderBy('seq').get()]);
  if (!snap.exists) return null;
  const meta = metaOf(id, snap.data() ?? {});
  if (meta.uid) meta.email = (await emailsOf([meta.uid])).get(meta.uid) ?? null;
  const events: ReplayEvent[] = [];
  for (const c of chunks.docs) {
    try {
      const list = JSON.parse(String(c.data().events ?? '[]'));
      if (Array.isArray(list)) events.push(...(list as ReplayEvent[]));
    } catch {
      /* a chunk that will not parse is skipped */
    }
  }
  // A beacon and a fetch can cross: order by time, the order they were recorded in within a tie.
  events.sort((a, b) => a.t - b.t);
  return { meta, events };
}
