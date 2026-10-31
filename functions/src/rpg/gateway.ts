/*
 * `rpgApi`: every request the RPG makes to a provider — Google, OpenAI, ElevenLabs, fal.ai (Meshy
 * included, which the game reaches through fal) — passes through here, so the provider's key never
 * has to be in the page (owner, 31 Oct 2026: "everything goes through the server, the requests to
 * fal, Google and so on").
 *
 * The page asks `/{host}/{path}?{query}` with no key (`utils/rpg/gateway.ts`). This function:
 *   1. lets through only what the game itself sends (`gatewayTarget`, `utils/rpg/gatewayRoutes.ts`);
 *   2. finds who pays (`payer`): a signed-in reader's own key out of `users/{uid}/keys/config`, read
 *      with the Admin SDK and never answered; else a key that is only in the reader's browser
 *      (signed out), sent in `x-rpg-key` for this one request and kept nowhere; else nobody — a 402
 *      in words `funds.ts` reads as an empty balance. Prepaid credits go in that third branch: the
 *      owner's key, a reservation before the call and a settlement after it, the way `rpgDemo`
 *      already does it with dollars (`handler.ts`, `reserve`/`settle`);
 *   3. passes the request on and the answer back byte for byte — an event stream as it comes, so
 *      the `~` console shows the tokens as they are written — reading the usage as it passes;
 *   4. prices it (`costUpfront`, `UsageMeter`), says what it cost (`x-rpg-cost-usd`, or a last SSE
 *      comment on a stream, which every reader skips) and writes it to the reader's ledger,
 *      `rpgLedger/{uid}` and `rpgLedger/{uid}/days/{day}`. Top level and with no rule, as
 *      `demoUsage` is: a ledger the reader could write would be no ledger once it is money.
 *
 * Provider errors are passed on with the provider's status and body, untouched: the game moves down
 * its model chain on Google's 429 and puts up the funds banner on fal's `User is locked`, and both
 * need the provider's own words to do it.
 */

import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

import { keysFrom } from '../../../korczak-xyz/src/utils/accountKeys/keys';
import {
  BYOK_HEADER,
  COST_EVENT,
  COST_HEADER,
  costUpfront,
  credentialHeaders,
  GATEWAY_KEY_NAME,
  gatewayTarget,
  ledgerId,
  NO_CREDITS,
  QUEST_HEADER,
  WORLD_HEADER,
  UsageMeter,
  voiceCostFromHeader,
  type GatewayProvider,
  type GatewayTarget,
} from '../../../korczak-xyz/src/utils/rpg/gatewayRoutes';
import { dayKey } from '../demo/limits';
import { ALLOWED_ORIGINS } from '../sloper/metadata';
import { db } from '../runtime';
import { flushSentry, reportError } from '../sentry';

/** Response headers worth passing on: what the page reads besides the body. */
const PASSED_HEADERS = ['content-type', 'character-cost', 'retry-after', 'request-id', 'x-fal-request-id'];
/** Request headers worth passing on, besides the key this function adds. */
const FORWARDED_HEADERS = ['content-type', 'accept', 'x-fal-object-lifecycle-preference', 'x-fal-queue-priority'];

export class GatewayRefusal extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

function cors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  const allowed = typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin) ? origin : null;
  if (allowed) {
    res.set('Access-Control-Allow-Origin', allowed);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Expose-Headers', [COST_HEADER, 'character-cost', 'retry-after', 'request-id', 'x-fal-request-id'].join(', '));
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', `Content-Type, Accept, Authorization, ${BYOK_HEADER}, ${WORLD_HEADER}, ${QUEST_HEADER}, X-Fal-Object-Lifecycle-Preference, X-Fal-Queue-Priority`);
  res.set('Access-Control-Max-Age', '3600');
  return allowed !== null;
}

export interface Payer {
  key: string;
  /** Whose ledger it goes in; null for a signed-out reader's own key. */
  uid: string | null;
  kind: 'account' | 'byok';
}

async function uidOf(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  const m = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null;
  if (!m) return null;
  try {
    return (await getAuth().verifyIdToken(m[1])).uid;
  } catch {
    throw new GatewayRefusal(401, 'auth', 'rpg gateway: sign-in expired, reload the page');
  }
}

/**
 * The account's keys, kept a minute per instance: a fal.ai model is followed by a status request
 * every two seconds, and each would otherwise read the same document again. A key changed on the
 * account page is in force within the minute.
 */
const KEYS_MS = 60_000;
const keyCache = new Map<string, { at: number; data: Record<string, unknown> }>();

async function accountKeys(uid: string): Promise<Record<string, unknown>> {
  const hit = keyCache.get(uid);
  if (hit && Date.now() - hit.at < KEYS_MS) return hit.data;
  const data = (await db.doc(`users/${uid}/keys/config`).get()).data() ?? {};
  if (keyCache.size > 500) keyCache.clear();
  keyCache.set(uid, { at: Date.now(), data });
  return data;
}

/** Who pays for this request, and with which key. See the top of this file. */
export async function payer(
  req: Request,
  provider: GatewayProvider,
  readKeys: (uid: string) => Promise<Record<string, unknown>> = accountKeys,
): Promise<Payer> {
  const uid = await uidOf(req);
  if (uid) {
    const key = keysFrom(await readKeys(uid))[GATEWAY_KEY_NAME[provider]];
    if (key) return { key, uid, kind: 'account' };
  }
  const own = req.headers[BYOK_HEADER];
  if (typeof own === 'string' && own.trim()) return { key: own.trim(), uid, kind: 'byok' };
  // Prepaid credits are this branch: the owner's key, reserved and settled against `uid`'s balance.
  throw new GatewayRefusal(402, 'no-credits', `${NO_CREDITS} (no ${provider} key on this account)`);
}

function bodyOf(req: Request): Buffer | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Buffer.from(JSON.stringify(req.body));
  return undefined;
}

function jsonOf(body: Buffer | undefined): Record<string, unknown> {
  if (!body?.length) return {};
  try {
    const v = JSON.parse(body.toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The gateway path from the request, whichever URL it came in on. */
export function gatewayPathOf(url: string): { path: string; query: string } {
  const [rawPath, query = ''] = url.split('?', 2);
  const path = rawPath.replace(/^\/rpgApi(?=\/)/, '');
  // The key never travels in the URL: Google's `?key=` is dropped if a page still sends it.
  const params = new URLSearchParams(query);
  params.delete('key');
  return { path, query: params.toString() };
}

/** What a priced request is recorded as. */
export interface Spend {
  provider: GatewayProvider;
  model: string;
  usd: number | null;
  kind: Payer['kind'];
  world: string | null;
  quest: string | null;
}

/**
 * Into the reader's ledger, what credits will be counted against: the running total on
 * `rpgLedger/{uid}` (where a balance will sit beside it), the day, and the world and the quest the
 * request was for, each split by provider and by model. Nothing for a signed-out reader's own key.
 */
export function ledgerWrites(uid: string, s: Spend, day: string): { path: string; data: Record<string, unknown> }[] {
  if (s.usd === null || !(s.usd > 0)) return [];
  const inc = FieldValue.increment(s.usd);
  const one = FieldValue.increment(1);
  const at = FieldValue.serverTimestamp();
  const model = ledgerId(s.model) ?? 'unknown';
  const split = { usd: inc, calls: one, byProvider: { [s.provider]: inc }, byModel: { [model]: inc }, updatedAt: at };
  const root = `rpgLedger/${uid}`;
  const writes = [
    { path: root, data: { usd: inc, calls: one, updatedAt: at } },
    { path: `${root}/days/${day}`, data: { ...split, byPayer: { [s.kind]: inc } } },
  ];
  const world = ledgerId(s.world);
  const quest = ledgerId(s.quest);
  if (world) writes.push({ path: `${root}/worlds/${world}`, data: split });
  if (quest) writes.push({ path: `${root}/quests/${quest}`, data: { ...split, ...(world ? { world } : {}) } });
  return writes;
}

async function record(uid: string | null, spend: Spend): Promise<void> {
  if (!uid) return;
  const writes = ledgerWrites(uid, spend, dayKey());
  if (writes.length === 0) return;
  const batch = db.batch();
  for (const w of writes) batch.set(db.doc(w.path), w.data, { merge: true });
  try {
    await batch.commit();
  } catch (e) {
    // The answer is already the reader's; a ledger that missed one call is not worth failing it.
    reportError('rpgApi.ledger', e, { provider: spend.provider });
  }
}

function costText(usd: number | null): string {
  return usd === null ? '' : usd.toFixed(6);
}

async function pass(req: Request, res: Response, target: GatewayTarget, query: string, who: Payer): Promise<void> {
  const body = bodyOf(req);
  const json = jsonOf(body);
  const headers: Record<string, string> = {};
  for (const h of FORWARDED_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string') headers[h] = v;
  }
  Object.assign(headers, credentialHeaders(target.provider, who.key));

  const controller = new AbortController();
  // The reader went away (a page closed mid-stream): stop paying for an answer nobody reads.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  const upstream = await fetch(`https://${target.host}${target.path}${query ? `?${query}` : ''}`, {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    signal: controller.signal,
  });

  res.status(upstream.status);
  for (const h of PASSED_HEADERS) {
    const v = upstream.headers.get(h);
    if (v !== null) res.set(h, v);
  }
  if (!upstream.ok || !upstream.body) {
    res.send(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  const header = (name: string) => (typeof req.headers[name] === 'string' ? (req.headers[name] as string) : null);
  const spend = (usd: number | null, model: string): Spend => ({
    provider: target.provider,
    model,
    usd,
    kind: who.kind,
    world: header(WORLD_HEADER),
    quest: header(QUEST_HEADER),
  });
  const asked = UsageMeter.asked(target, json) || (target.provider === 'fal' ? target.path.slice(1) : target.path);

  const type = upstream.headers.get('content-type') ?? '';
  const upfront = voiceCostFromHeader(upstream.headers.get('character-cost')) ?? costUpfront(target, json);

  if (type.includes('text/event-stream')) {
    const meter = new UsageMeter(target.provider, asked);
    res.set('Cache-Control', 'no-cache');
    res.flushHeaders();
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
      buffer = meter.feedEvents(buffer + decoder.decode(value, { stream: true }));
    }
    meter.feedEvents(`${buffer}\n`);
    const usd = meter.cost() ?? upfront;
    await record(who.uid, spend(usd, meter.model));
    res.write(`\n${COST_EVENT}${JSON.stringify({ usd, model: meter.model })}\n\n`);
    res.end();
    return;
  }

  if (type.includes('json')) {
    const bytes = Buffer.from(await upstream.arrayBuffer());
    let usd = upfront;
    if (usd === null && (target.provider === 'google' || target.provider === 'openai')) {
      const meter = new UsageMeter(target.provider, asked);
      try {
        meter.feed(JSON.parse(bytes.toString('utf8')));
      } catch {
        /* not priced */
      }
      usd = meter.cost();
    }
    await record(who.uid, spend(usd, asked));
    if (usd !== null) res.set(COST_HEADER, costText(usd));
    res.send(bytes);
    return;
  }

  // Audio, or anything else priced before it was asked: said in the header, then streamed through.
  if (upfront !== null) res.set(COST_HEADER, costText(upfront));
  await record(who.uid, spend(upfront, typeof json.model_id === 'string' ? json.model_id : asked));
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export async function handleRpgApi(req: Request, res: Response): Promise<void> {
  const allowed = cors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (!allowed) {
    res.status(403).json({ reason: 'origin', error: { message: 'rpg gateway: origin not allowed' } });
    return;
  }
  const { path, query } = gatewayPathOf(req.url);
  const target = gatewayTarget(path, req.method);
  if (!target) {
    res.status(404).json({ reason: 'route', error: { message: `rpg gateway: ${req.method} ${path.split('/')[1] ?? ''} is not a request the game makes` } });
    return;
  }
  try {
    const who = await payer(req, target.provider);
    await pass(req, res, target, query, who);
  } catch (e) {
    if (e instanceof GatewayRefusal) {
      if (!res.headersSent) res.status(e.status).json({ reason: e.reason, error: { message: e.message } });
      return;
    }
    if ((e as Error)?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }
    reportError('rpgApi', e, { host: target.host });
    await flushSentry();
    if (!res.headersSent) res.status(502).json({ reason: 'failed', error: { message: `rpg gateway: ${target.host} could not be reached` } });
    else res.end();
  }
}
