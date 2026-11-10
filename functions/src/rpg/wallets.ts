/*
 * `/admin/wallets`: the providers' own wallets beside the request log's estimate
 * (`utils/rpg/wallets.ts` has the shapes and the arithmetic).
 *
 * The keys that read them are kept apart from the keys that spend (`rpgWalletKeys/config`, no rule,
 * Admin SDK only), answered as their last four characters and never whole. Each one is asked one
 * read-only question:
 *
 *   OpenAI      admin key → `GET /v1/organization/costs` from the start of this UTC month: spent.
 *   ElevenLabs  key with User: read → `GET /v1/user/subscription`: credits left this period.
 *   fal         admin-scoped key → `GET rest.alpha.fal.ai/billing/user_balance`: dollars left.
 *   Google      nothing: the Gemini API's billing is Cloud Billing, which no API key reads. By hand.
 */

import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';

import { REQUEST_LOG_COLLECTION, type RequestLogEntry } from '../../../korczak-xyz/src/utils/rpg/requestLog';
import {
  BadWalletPatch,
  WALLETS_DOC,
  WALLET_DAYS,
  WALLET_KEY_PROVIDERS,
  WALLET_READINGS,
  ownSpend,
  parseElevenLabsLeft,
  parseFalBalance,
  parseOpenAiSpent,
  parseWalletPatch,
  startOfUtcMonth,
  type WalletCheck,
  type WalletKeyProvider,
  type WalletReading,
  type WalletsPage,
} from '../../../korczak-xyz/src/utils/rpg/wallets';
import { db } from '../runtime';

const TIMEOUT_MS = 8000;

function keysDoc() {
  return db.collection(WALLETS_DOC[0]).doc(WALLETS_DOC[1]);
}

function hint(key: unknown): string | null {
  return typeof key === 'string' && key ? key.slice(-4) : null;
}

async function readKeys(): Promise<Record<WalletKeyProvider, string | null>> {
  const data = (await keysDoc().get()).data() ?? {};
  const keys = (data.keys ?? {}) as Record<string, unknown>;
  return Object.fromEntries(WALLET_KEY_PROVIDERS.map((p) => [p, typeof keys[p] === 'string' ? (keys[p] as string) : null])) as Record<
    WalletKeyProvider,
    string | null
  >;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<{ ok: true; json: unknown } | { ok: false; check: 'refused' | 'failed'; reason: string | null }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const err = (json as { error?: unknown; detail?: unknown } | null)?.error ?? (json as { detail?: unknown } | null)?.detail;
      const reason = typeof err === 'string' ? err : typeof (err as { message?: unknown })?.message === 'string' ? (err as { message: string }).message : `HTTP ${res.status}`;
      return { ok: false, check: [400, 401, 403].includes(res.status) ? 'refused' : 'failed', reason: reason.slice(0, 300) };
    }
    return { ok: true, json };
  } catch (e) {
    return { ok: false, check: 'failed', reason: e instanceof Error ? e.message : null };
  }
}

type Read = { reading: Omit<WalletReading, 'id' | 'by'> } | { check: 'refused' | 'failed'; reason: string | null };

async function readOpenAi(key: string, now: number): Promise<Read> {
  const from = startOfUtcMonth(now);
  let usd = 0;
  let page: string | null = null;
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ start_time: String(from / 1000), bucket_width: '1d', limit: '31' });
    if (page) q.set('page', page);
    const r = await fetchJson(`https://api.openai.com/v1/organization/costs?${q}`, { Authorization: `Bearer ${key}` });
    if (!r.ok) return r;
    const parsed = parseOpenAiSpent(r.json);
    usd += parsed.usd;
    page = parsed.next;
    if (!page) break;
  }
  return { reading: { provider: 'openai', kind: 'spent', unit: 'usd', amount: usd, at: now, from, source: 'api', note: null } };
}

async function readElevenLabs(key: string, now: number): Promise<Read> {
  const r = await fetchJson('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': key });
  if (!r.ok) return r;
  const left = parseElevenLabsLeft(r.json);
  if (left == null) return { check: 'failed', reason: 'no character_count / character_limit in the answer' };
  return { reading: { provider: 'elevenlabs', kind: 'balance', unit: 'credits', amount: left, at: now, from: null, source: 'api', note: null } };
}

async function readFal(key: string, now: number): Promise<Read> {
  const r = await fetchJson('https://rest.alpha.fal.ai/billing/user_balance', { Authorization: `Key ${key}` });
  if (!r.ok) return r;
  const usd = parseFalBalance(r.json);
  if (usd == null) return { check: 'failed', reason: 'no balance in the answer' };
  return { reading: { provider: 'fal', kind: 'balance', unit: 'usd', amount: usd, at: now, from: null, source: 'api', note: null } };
}

const READERS: Record<WalletKeyProvider, (key: string, now: number) => Promise<Read>> = {
  openai: readOpenAi,
  elevenlabs: readElevenLabs,
  fal: readFal,
};

function newId(at: number): string {
  return `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Every key asked once, in parallel; each answer that came back is stored as a reading. */
async function checkWallets(uid: string): Promise<WalletCheck[]> {
  const keys = await readKeys();
  const now = Date.now();
  return Promise.all(
    WALLET_KEY_PROVIDERS.map(async (provider): Promise<WalletCheck> => {
      const key = keys[provider];
      if (!key) return { provider, check: 'no-key', reason: null };
      const r = await READERS[provider](key, now);
      if ('check' in r) return { provider, check: r.check, reason: r.reason };
      const id = newId(now);
      await db.collection(WALLET_READINGS).doc(id).set({ ...r.reading, id, by: uid });
      return { provider, check: 'ok', reason: null };
    }),
  );
}

async function walletsPage(): Promise<WalletsPage> {
  const since = Date.now() - WALLET_DAYS * 86_400_000;
  const [keys, readingsSnap, first] = await Promise.all([
    readKeys(),
    db.collection(WALLET_READINGS).where('at', '>=', since).orderBy('at', 'desc').limit(500).get(),
    db.collection(REQUEST_LOG_COLLECTION).orderBy('at', 'asc').limit(1).get(),
  ]);
  const readings = readingsSnap.docs.map((d) => d.data() as WalletReading);
  const loggingSince = first.docs[0] ? (first.docs[0].data() as RequestLogEntry).at : null;
  // The log over the widest window any reading covers, cut to provider, time and price.
  const from = Math.min(...readings.map((r) => r.from ?? r.at), Date.now());
  const to = Math.max(...readings.map((r) => r.at), 0);
  let logged: WalletsPage['logged'] = [];
  if (readings.length && loggingSince != null && to > Math.max(from, loggingSince)) {
    const snap = await db
      .collection(REQUEST_LOG_COLLECTION)
      .where('at', '>=', Math.max(from, loggingSince))
      .where('at', '<=', to)
      .select('at', 'provider', 'payer', 'usd', 'reused')
      .get();
    logged = ownSpend(snap.docs.map((d) => d.data() as RequestLogEntry));
  }
  return { hints: Object.fromEntries(WALLET_KEY_PROVIDERS.map((p) => [p, hint(keys[p])])) as WalletsPage['hints'], readings, logged, loggingSince };
}

export class WalletRefusal extends Error {
  constructor(readonly status: number, readonly reason: string, message: string) {
    super(message);
  }
}

/** GET answers the page; POST takes a `WalletPatch`, applies it, and answers the page. Admin already checked. */
export async function handleWallets(req: Request, res: Response, uid: string, body: unknown): Promise<void> {
  let checks: WalletCheck[] | undefined;
  if (req.method === 'POST') {
    let patch;
    try {
      patch = parseWalletPatch(body);
    } catch (e) {
      if (e instanceof BadWalletPatch) throw new WalletRefusal(400, 'bad-patch', `wallets: ${e.message}`);
      throw e;
    }
    if (patch.keys && Object.keys(patch.keys).length) {
      const keys = Object.fromEntries(Object.entries(patch.keys).map(([p, v]) => [p, v === null ? FieldValue.delete() : v]));
      await keysDoc().set({ keys, updatedAt: Date.now(), updatedBy: uid }, { merge: true });
    }
    if (patch.reading) {
      const id = newId(Date.now());
      await db.collection(WALLET_READINGS).doc(id).set({ ...patch.reading, id, source: 'manual', by: uid });
    }
    if (patch.remove) await db.collection(WALLET_READINGS).doc(patch.remove).delete();
    if (patch.check) checks = await checkWallets(uid);
  }
  res.status(200).json({ ...(await walletsPage()), ...(checks ? { checks } : {}) });
}
