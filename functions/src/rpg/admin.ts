/*
 * The game's admin panel, on the gateway: `GET /admin/config` answers every section, `POST` takes a
 * patch naming only the sections it changes (`utils/rpg/adminConfig.ts`).
 *
 * Admin means a document at `admins/{uid}` — the same list `firestore.rules`' `isAdmin()` reads,
 * appointed by hand in the console and never by a client. Checked here with the Admin SDK, because
 * what this endpoint writes has no rule to stop anybody: `rpgServerKeys/config` has none on purpose,
 * so no page can read a key back, and `demo/config` is written on the Admin SDK too.
 *
 * Today's sections:
 * - **keys** — the server's own keys, which the demo spends before the paying account's
 *   (`demoKeysOf`). Answered as their last four characters, never whole.
 * - **demo** — the RPG's own switch and its two dollar caps in `demo/config`, merged so the
 *   roaster's fields beside them are left as they are.
 */

import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';

import { keysFrom } from '../../../korczak-xyz/src/utils/accountKeys/keys';
import {
  BadPatch,
  MAX_KEY_LENGTH,
  SERVER_KEYS_DOC,
  demoKeysOf,
  demoWrite,
  keyHints,
  parseAdminPatch,
  serverKeysFrom,
  type AdminStatus,
  type ServerKeyName,
} from '../../../korczak-xyz/src/utils/rpg/adminConfig';
import { MAX_DAILY_USD, MAX_PER_IP_USD, normalizeRpgDemo } from '../../../korczak-xyz/src/utils/rpg/demoLimits';
import { SETTINGS_PATH } from '../demo/handler';
import { db } from '../runtime';

/** A document by its path, through `collection().doc()` — the one form every test's Firestore fake has. */
function ref(path: string) {
  const parts = path.split('/');
  let r = db.collection(parts[0]).doc(parts[1]);
  for (let i = 2; i < parts.length; i += 2) r = r.collection(parts[i]).doc(parts[i + 1]);
  return r;
}

export class AdminRefusal extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

export async function isAdminUid(uid: string): Promise<boolean> {
  return (await ref(`admins/${uid}`).get()).exists === true;
}

function stampOf(data: Record<string, unknown> | undefined): number {
  const v = data?.updatedAt;
  return typeof v === 'number' ? v : 0;
}

/** The server's keys, read at call time: a key changed on the panel is in force on the next request. */
export async function readServerKeys(): Promise<Record<ServerKeyName, string | null>> {
  return serverKeysFrom((await ref(SERVER_KEYS_DOC.join('/')).get()).data());
}

/**
 * The demo's Google and ElevenLabs keys: the server's own first, then `demo/config.keyUid`'s account
 * store, as before the panel. Used by `rpgDemo` and by the panel's own answer.
 */
export async function demoKeys(keyUid: string) {
  const [server, account] = await Promise.all([
    readServerKeys(),
    keyUid ? ref(`users/${keyUid}/keys/config`).get().then((s) => keysFrom(s.data())) : Promise.resolve(null),
  ]);
  return demoKeysOf(server, { google: account?.google ?? null, elevenLabs: account?.elevenLabs ?? null });
}

export async function adminStatus(): Promise<AdminStatus> {
  const [keysSnap, demoSnap] = await Promise.all([
    ref(SERVER_KEYS_DOC.join('/')).get(),
    ref(SETTINGS_PATH.join('/')).get(),
  ]);
  const keysData = keysSnap.data();
  const settings = normalizeRpgDemo(demoSnap.data() ?? {});
  const { payer } = await demoKeys(settings.keyUid);
  return {
    keys: keyHints(serverKeysFrom(keysData)),
    keysUpdatedAt: stampOf(keysData),
    demo: { on: settings.on, enabled: settings.enabled, perIpUsd: settings.perIpUsd, dailyUsd: settings.dailyUsd, payer },
    limits: { maxPerIpUsd: MAX_PER_IP_USD, maxDailyUsd: MAX_DAILY_USD },
  };
}

function bodyJson(req: Request): unknown {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body : (req as Request & { rawBody?: Buffer }).rawBody;
  const text = typeof req.body === 'string' ? req.body : raw?.toString('utf8');
  if (!text || text.length > 16 * MAX_KEY_LENGTH) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `/admin/config`, for a uid the gateway has already verified. */
export async function handleAdmin(req: Request, res: Response, uid: string | null): Promise<void> {
  if (!uid) throw new AdminRefusal(401, 'auth', 'admin: sign in first');
  if (!(await isAdminUid(uid))) throw new AdminRefusal(403, 'not-admin', 'admin: this account is not an admin');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    let patch;
    try {
      patch = parseAdminPatch(bodyJson(req));
    } catch (e) {
      if (e instanceof BadPatch) throw new AdminRefusal(400, 'bad-patch', `admin: ${e.message}`);
      throw e;
    }
    const batch = db.batch();
    if (patch.keys && Object.keys(patch.keys).length > 0) {
      const apiKeys = Object.fromEntries(
        Object.entries(patch.keys).map(([n, v]) => [n, v === null ? FieldValue.delete() : v]),
      );
      batch.set(ref(SERVER_KEYS_DOC.join('/')), { apiKeys, updatedAt: Date.now(), updatedBy: uid }, { merge: true });
    }
    if (patch.demo && Object.keys(patch.demo).length > 0) {
      batch.set(ref(SETTINGS_PATH.join('/')), { ...demoWrite(patch.demo), rpgUpdatedAt: Date.now() }, { merge: true });
    }
    await batch.commit();
  }
  res.status(200).json(await adminStatus());
}
