/*
 * The request log on the server: one Firestore record and one JSON file of bodies per paid request
 * (the rules and the shape are in `utils/rpg/requestLog.ts`), and the panel's two readers.
 *
 * Writing never fails a request: the answer is the reader's whatever happens here, and a record that
 * could not be written is a Sentry event (`rpgRequests.*`). The callers await it **before** they end
 * the response, because on Cloud Run work after `res.end()` may be frozen half done (`assets.ts`).
 */

import { randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

import {
  MAX_REQUESTS_PAGE,
  REQUEST_LOG_COLLECTION,
  safeHeaders,
  trimForLog,
  warsawDay,
  type RequestBodies,
  type RequestLogEntry,
  type RequestsPage,
} from '../../../korczak-xyz/src/utils/rpg/requestLog';
import { usdPln } from './fx';
import { RPG_BUCKET, db } from '../runtime';
import { reportError } from '../sentry';

const MAX_BODY_CHARS = 2_000_000;

/** Sortable by time, unique enough: `20261110T065725Z-a1b2c3d4`. */
export function newRequestId(at: number): string {
  return `${new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}-${randomBytes(4).toString('hex')}`;
}

/** An answer's body as it is kept: JSON parsed and trimmed, text cut at 2M characters, binary as its size. */
export function keptBody(contentType: string | null, bytes: Buffer | null, size = bytes?.length ?? 0): unknown {
  if (!bytes) return null;
  const type = contentType ?? '';
  if (/json|text|event-stream/.test(type) || type === '') {
    const text = bytes.toString('utf8');
    if (type.includes('json')) {
      try {
        return trimForLog(JSON.parse(text));
      } catch {
        /* kept as text */
      }
    }
    return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… [${text.length} characters]` : text;
  }
  return `[${size} bytes of ${type}]`;
}

export type NewEntry = Omit<RequestLogEntry, 'id' | 'usdPln' | 'fxDate' | 'bodies'>;

/** Writes one record and its bodies. Never throws. */
export async function logRequest(entry: NewEntry, bodies: RequestBodies): Promise<void> {
  try {
    const id = newRequestId(entry.at);
    const path = `requests/${warsawDay(entry.at)}/${id}.json`;
    const fx = await usdPln();
    const kept = await getStorage()
      .bucket(RPG_BUCKET)
      .file(path)
      .save(JSON.stringify(bodies), { resumable: false, contentType: 'application/json' })
      .then(() => true)
      .catch((e) => {
        reportError('rpgRequests.bodies', e, { provider: entry.provider });
        return false;
      });
    const record: RequestLogEntry = { ...entry, id, usdPln: fx?.usdPln ?? null, fxDate: fx?.date ?? null, bodies: kept ? path : null };
    // Firestore refuses `undefined`.
    await db.collection(REQUEST_LOG_COLLECTION).doc(id).set(JSON.parse(JSON.stringify(record)));
  } catch (e) {
    reportError('rpgRequests.write', e, { provider: entry.provider });
  }
}

/** The request half of the bodies, from what the gateway forwarded. */
export function requestBodies(method: string, url: string, headers: Record<string, string>, json: unknown, raw: Buffer | undefined): RequestBodies['request'] {
  const body = json && typeof json === 'object' && Object.keys(json).length > 0 ? trimForLog(json) : raw?.length ? `[${raw.length} bytes]` : null;
  return { method, url, headers: safeHeaders(Object.entries(headers)), body };
}

/** uid → e-mail for the accounts named, a hundred at a time (`getUsers`' limit). */
async function namesOf(uids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < uids.length; i += 100) {
    const batch = uids.slice(i, i + 100).map((uid) => ({ uid }));
    try {
      const { users } = await getAuth().getUsers(batch);
      for (const u of users) out[u.uid] = u.email ?? u.displayName ?? u.uid;
    } catch (e) {
      reportError('rpgRequests.names', e);
    }
  }
  return out;
}

/** `/admin/requests?from=&to=` (ms): the records in the range, newest first, with names and today's rate. */
export async function listRequests(from: number, to: number): Promise<RequestsPage> {
  const snap = await db
    .collection(REQUEST_LOG_COLLECTION)
    .where('at', '>=', from)
    .where('at', '<=', to)
    .orderBy('at', 'desc')
    .limit(MAX_REQUESTS_PAGE + 1)
    .get();
  const entries = snap.docs.slice(0, MAX_REQUESTS_PAGE).map((d) => d.data() as RequestLogEntry);
  const uids = [...new Set(entries.map((e) => e.uid).filter((u): u is string => Boolean(u)))];
  const [users, fx] = await Promise.all([namesOf(uids), usdPln()]);
  return { entries, users, fx, truncated: snap.docs.length > MAX_REQUESTS_PAGE };
}

/** `/admin/request?id=`: one record with its bodies, or null. */
export async function readRequest(id: string): Promise<{ entry: RequestLogEntry; bodies: RequestBodies | null } | null> {
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  const snap = await db.collection(REQUEST_LOG_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const entry = snap.data() as RequestLogEntry;
  let bodies: RequestBodies | null = null;
  if (entry.bodies) {
    try {
      const [bytes] = await getStorage().bucket(RPG_BUCKET).file(entry.bodies).download();
      bodies = JSON.parse(bytes.toString('utf8')) as RequestBodies;
    } catch (e) {
      reportError('rpgRequests.read', e);
    }
  }
  return { entry, bodies };
}
