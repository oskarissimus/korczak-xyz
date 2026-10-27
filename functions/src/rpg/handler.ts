/*
 * The RPG's demo: a world, a beat of a quest, or one spoken line, for somebody with no account and no key,
 * on the owner's keys (`.claude/rules/rpg.md`, *The demo*). The game is otherwise entirely in the
 * browser on the reader's own keys; this is its one server call.
 *
 * It is the roaster's demo (`demo/handler.ts`) again, with what differs about a quest:
 *
 * - **The budget is dollars** (`utils/rpg/demoLimits.ts`): $4 per address and $10 across everybody
 *   per Warsaw day by default, at the owner's request. Every call reserves its worst case in a
 *   transaction before it is made and is settled at what it cost, so the caps cannot be passed.
 * - **The prompt is built here**, by the game's own `beatPrompt`, from a context checked field by
 *   field (`demoContext`). The model is one of the game's own list (`DEMO_MODELS`).
 * - **The answer is streamed through** as Google sends it — the same server-sent events the game
 *   reads from Google on a reader's own key, so the waiting screen and the console show the demo
 *   working exactly as they show a keyed quest. The usage in the last event is what settles it.
 * - **A clip is spoken here** too: one line, at most `MAX_CLIP_CHARS`, in one of the game's three
 *   voices, priced by its length before it is made.
 *
 * It also keeps **the day's numbers for the whole site** (owner, Oct 2026: "the stats are to be
 * general, from the whole site: how much money went today, how long was played and how many
 * times"): `{kind:'stats'}` adds a launch, some time played and what a reader's own keys cost to
 * `rpgStats/{day}`, and the GET answers with those plus what the demo itself spent. They are
 * reported by the browser and so can be inflated by anybody who wants to; each report is capped
 * so that takes effort, and nothing but a number on the intro screen ever reads them.
 *
 * The keys are read at call time from the paying account's own store, as the roaster's demo reads
 * them; nothing in a request names that account, and no answer says whose it is. Nothing about the
 * caller is stored but a day-keyed hash of the address holding a number of dollars.
 */

import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';

import { keysFrom } from '../../../korczak-xyz/src/utils/accountKeys/keys';
import { tokenCost } from '../../../korczak-xyz/src/utils/rpg/cost';
import {
  BadContext,
  DEMO_MODELS,
  DEMO_VOICES,
  MAX_CLIP_CHARS,
  MAX_OUTPUT_TOKENS,
  beatReservation,
  checkRpgDemo,
  clipCost,
  demoContext,
  normalizeRpgDemo,
  priceAs,
  remainingUsd,
  type DemoVoice,
  type RpgDemoSettings,
} from '../../../korczak-xyz/src/utils/rpg/demoLimits';
import { beatPrompt } from '../../../korczak-xyz/src/utils/rpg/quest';
import { demoGenesis, genesisPrompt, genesisTemperature } from '../../../korczak-xyz/src/utils/rpg/genesis';
import {
  asAge,
  findVoice,
  sharedVoicesOf,
  usableIds,
  voiceListsOf,
  voiceQueries,
  type VoiceLists,
  type VoiceWho,
} from '../../../korczak-xyz/src/utils/rpg/voicePick';
import { callerIp, dayKey, ipKey } from '../demo/limits';
import { SETTINGS_PATH } from '../demo/handler';
import { ALLOWED_ORIGINS } from '../sloper/metadata';
import { db } from '../runtime';
import { flushSentry, reportError } from '../sentry';

const VOICE_MODEL = 'eleven_flash_v2_5';

function cors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  const allowed = typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin) ? origin : null;
  if (allowed) {
    res.set('Access-Control-Allow-Origin', allowed);
    res.set('Vary', 'Origin');
    // The console reads what a clip cost from here, the way it reads ElevenLabs' own header.
    res.set('Access-Control-Expose-Headers', 'x-demo-cost, x-demo-remaining');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '3600');
  return allowed !== null;
}

async function readSettings(): Promise<RpgDemoSettings> {
  const snap = await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).get();
  return normalizeRpgDemo(snap.exists ? snap.data() : {});
}

async function demoKeys(uid: string): Promise<{ google: string | null; elevenLabs: string | null }> {
  if (!uid) return { google: null, elevenLabs: null };
  const snap = await db.collection('users').doc(uid).collection('keys').doc('config').get();
  const keys = keysFrom(snap.exists ? snap.data() : {});
  return { google: keys.google, elevenLabs: keys.elevenLabs };
}

/** `demoUsage/rpg-{day}`, beside the roaster's buckets, with the hashed addresses under it. */
function counters(day: string, ip: string) {
  const allDoc = db.collection('demoUsage').doc(`rpg-${day}`);
  return { allDoc, ipDoc: allDoc.collection('ips').doc(ipKey(ip, day)) };
}

function dollars(snap: FirebaseFirestore.DocumentSnapshot): number {
  const value = snap.exists ? snap.data()?.usd : 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function readSpent(day: string, ip: string): Promise<{ ip: number; all: number }> {
  const { allDoc, ipDoc } = counters(day, ip);
  const [all, mine] = await Promise.all([allDoc.get(), ipDoc.get()]);
  return { ip: dollars(mine), all: dollars(all) };
}

/** Reserves `cost` against both caps, or says which one it would pass. */
async function reserve(
  settings: RpgDemoSettings,
  day: string,
  ip: string,
  cost: number,
): Promise<{ ok: true; spent: { ip: number; all: number } } | { ok: false; status: number; reason: string }> {
  const { allDoc, ipDoc } = counters(day, ip);
  return db.runTransaction(async (tx) => {
    const [all, mine] = await Promise.all([tx.get(allDoc), tx.get(ipDoc)]);
    const spent = { ip: dollars(mine), all: dollars(all) };
    const verdict = checkRpgDemo(settings, spent, cost);
    if (!verdict.ok) return { ok: false as const, status: verdict.status, reason: verdict.reason };
    tx.set(allDoc, { usd: FieldValue.increment(cost), app: 'rpg', day, at: Date.now() }, { merge: true });
    tx.set(ipDoc, { usd: FieldValue.increment(cost), day, at: Date.now() }, { merge: true });
    return { ok: true as const, spent: { ip: spent.ip + cost, all: spent.all + cost } };
  });
}

/** Gives back what a call reserved and did not spend. Never below zero, never above the claim. */
async function settle(day: string, ip: string, reserved: number, actual: number): Promise<void> {
  const refund = reserved - Math.min(reserved, Math.max(0, actual));
  if (refund <= 0) return;
  const { allDoc, ipDoc } = counters(day, ip);
  const batch = db.batch();
  batch.set(allDoc, { usd: FieldValue.increment(-refund) }, { merge: true });
  batch.set(ipDoc, { usd: FieldValue.increment(-refund) }, { merge: true });
  await batch.commit();
}

class BadRequest extends Error {}

/** The most one report may add: a game reports every 30s and on leaving, so these are generous. */
export const STATS_CAPS = { playMs: 30 * 60_000, usd: 1 } as const;

function statsDoc(day: string) {
  return db.collection('rpgStats').doc(day);
}

/** Today across everybody: launches and time played as reported, dollars reported plus the demo's. */
async function readToday(day: string, demoSpent: number): Promise<{ launches: number; playMs: number; usd: number }> {
  const snap = await statsDoc(day).get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return { launches: num(data.launches), playMs: num(data.playMs), usd: num(data.usd) + demoSpent };
}

async function stats(res: Response, body: Record<string, unknown>): Promise<void> {
  const clamp = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
  const launches = body.launches === 1 ? 1 : 0;
  const playMs = Math.round(clamp(body.playMs, STATS_CAPS.playMs));
  const usd = clamp(body.usd, STATS_CAPS.usd);
  if (launches || playMs || usd) {
    const day = dayKey();
    await statsDoc(day).set(
      {
        launches: FieldValue.increment(launches),
        playMs: FieldValue.increment(playMs),
        usd: FieldValue.increment(usd),
        day,
        at: Date.now(),
      },
      { merge: true },
    );
  }
  res.status(204).send('');
}

async function status(req: Request, res: Response): Promise<void> {
  const settings = await readSettings();
  const ip = callerIp(req.headers['x-forwarded-for'] as string | undefined, req.ip);
  const day = dayKey();
  const [spent, keys] = await Promise.all([readSpent(day, ip), demoKeys(settings.keyUid)]);
  const today = await readToday(day, spent.all);
  // Available while a cent is left; a beat whose worst case no longer fits is refused on its own.
  const verdict = keys.google ? checkRpgDemo(settings, spent, 0.01) : ({ ok: false, reason: 'no-key' } as const);
  res.status(200).json({
    available: verdict.ok,
    // Whether the paying account has a voice key at all — said, never which key.
    voice: keys.elevenLabs !== null,
    reason: verdict.ok ? null : verdict.reason,
    remaining: remainingUsd(settings, spent),
    perIpUsd: settings.perIpUsd,
    dailyUsd: settings.dailyUsd,
    today,
  });
}

/** A beat of a quest: the prompt built here from the game's checked context. */
async function beat(req: Request, res: Response, body: Record<string, unknown>): Promise<void> {
  const model = DEMO_MODELS.find((m) => m === body.model);
  if (!model) throw new BadRequest('Unknown model');
  let ctx;
  try {
    ctx = demoContext(body.ctx);
  } catch (e) {
    throw new BadRequest(e instanceof BadContext ? e.message : 'Bad context');
  }
  await generate(req, res, model, beatPrompt(ctx), 1, thinkingOf(body));
}

/** A new world (`genesis.ts`), at the genesis temperature: from seeds (dice or the player's words), a description, or both. */
async function world(req: Request, res: Response, body: Record<string, unknown>): Promise<void> {
  const model = DEMO_MODELS.find((m) => m === body.model);
  if (!model) throw new BadRequest('Unknown model');
  const ctx = demoGenesis(body.ctx);
  if (ctx.seeds.length === 0 && !ctx.wish) throw new BadRequest('No seeds');
  await generate(req, res, model, genesisPrompt(ctx), genesisTemperature(ctx.exotic), thinkingOf(body));
}

/** How hard the model thinks: `low` when the reader is waiting on the start (`storyteller.ts`'s `quick`). */
function thinkingOf(body: Record<string, unknown>): 'low' | 'high' | undefined {
  return body.thinking === 'low' || body.thinking === 'high' ? body.thinking : undefined;
}

/** Reads Google's event stream for the usage and the model that answered, passing every byte on. */
async function generate(
  req: Request,
  res: Response,
  model: string,
  prompt: string,
  temperature: number,
  thinking?: 'low' | 'high',
): Promise<void> {
  const reservation = beatReservation(model, prompt.length);
  if (reservation === null) throw new BadRequest('Model has no price');

  const settings = await readSettings();
  const day = dayKey();
  const ip = callerIp(req.headers['x-forwarded-for'] as string | undefined, req.ip);
  const claimed = await reserve(settings, day, ip, reservation);
  if (!claimed.ok) {
    res.status(claimed.status).json({ reason: claimed.reason, error: { message: `demo: ${claimed.reason}` } });
    return;
  }

  let spent = reservation;
  try {
    const { google } = await demoKeys(settings.keyUid);
    if (!google) {
      spent = 0;
      res.status(503).json({ reason: 'no-key', error: { message: 'demo: no-key' } });
      return;
    }
    const gemma = model.startsWith('gemma');
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': google },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            ...(gemma
              ? {}
              : { responseMimeType: 'application/json', thinkingConfig: { includeThoughts: true, ...(thinking ? { thinkingLevel: thinking } : {}) } }),
          },
        }),
      },
    );
    if (!upstream.ok || !upstream.body) {
      // Nothing was generated: a refusal costs nothing. Passed on with Google's status, so the game
      // moves to its next model on a 404, 429 or 503 as it would on its own key.
      spent = 0;
      const text = await upstream.text().catch(() => '');
      res.status(upstream.status || 502).type('application/json').send(text || '{}');
      return;
    }

    res.status(200);
    res.set('Content-Type', 'text/event-stream');
    res.set('Cache-Control', 'no-cache');
    res.set('x-demo-remaining', JSON.stringify(remainingUsd(settings, claimed.spent)));
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let servedBy: string | null = null;
    let usage: { input: number; output: number; thoughts: number } | null = null;
    const watch = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      try {
        const data = JSON.parse(trimmed.slice(5));
        if (typeof data?.modelVersion === 'string') servedBy = data.modelVersion;
        const u = data?.usageMetadata;
        if (u) usage = { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0 };
      } catch {
        /* a keep-alive */
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        watch(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    watch(buffer);
    res.end();
    // Settled at the model that answered, or at what was asked for when the answer did not say.
    if (usage) spent = tokenCost(servedBy ?? priceAs(model), usage) ?? tokenCost(priceAs(model), usage) ?? reservation;
  } finally {
    await settle(day, ip, reservation, spent).catch((e) => reportError('rpgDemo.settle', e));
  }
}

/**
 * Every library search a character can need, for one language (`voiceQueries`): kept a week in
 * `rpgVoices/{lang}` (Admin SDK only, no rule, like `demoUsage`) and an hour in this instance. A
 * search takes 8 to 14 seconds, so they are all asked at once, and only when the week is up; a
 * stale copy is still served if asking again fails.
 */
const VOICE_LISTS_MS = 7 * 24 * 3600_000;
const voiceMemory = new Map<'pl' | 'en', { at: number; lists: Promise<VoiceLists> }>();

async function readVoiceLists(lang: 'pl' | 'en', elevenLabs: () => Promise<string | null>): Promise<VoiceLists> {
  const doc = db.collection('rpgVoices').doc(lang);
  const snap = await doc.get();
  const stored = snap.exists ? snap.data() : null;
  const at = typeof stored?.at === 'number' ? stored.at : 0;
  // Kept as a JSON string: the search URLs are the keys, and they are not field names.
  let parsed: unknown = null;
  try {
    parsed = typeof stored?.lists === 'string' ? JSON.parse(stored.lists) : null;
  } catch {
    /* asked again */
  }
  const lists = voiceListsOf(parsed, lang);
  // Every search present, not just some: a cache from before a search was added is asked again.
  const complete = voiceQueries(lang).every((url) => url in lists);
  if (Date.now() - at < VOICE_LISTS_MS && complete) return lists;
  const key = await elevenLabs();
  if (!key) return lists;
  try {
    const fresh: VoiceLists = {};
    await Promise.all(
      voiceQueries(lang).map(async (url) => {
        const r = await fetch(url, { headers: { 'xi-api-key': key } });
        if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
        fresh[url] = usableIds(sharedVoicesOf(await r.json()), lang, VOICE_MODEL);
      }),
    );
    await doc.set({ at: Date.now(), lists: JSON.stringify(fresh) });
    return fresh;
  } catch (e) {
    reportError('rpgDemo.voiceLists', e);
    return lists;
  }
}

function voiceLists(lang: 'pl' | 'en', elevenLabs: () => Promise<string | null>): Promise<VoiceLists> {
  const cached = voiceMemory.get(lang);
  if (cached && Date.now() - cached.at < 3600_000) return cached.lists;
  const lists = readVoiceLists(lang, elevenLabs);
  voiceMemory.set(lang, { at: Date.now(), lists });
  lists.catch(() => voiceMemory.delete(lang));
  return lists;
}

/** The library's voices for every kind of character, handed to the game when a quest starts. */
async function voices(res: Response, body: Record<string, unknown>): Promise<void> {
  const lang = body.lang === 'pl' ? 'pl' : 'en';
  const lists = await voiceLists(lang, async () => (await demoKeys((await readSettings()).keyUid)).elevenLabs);
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ lang, lists });
}

/** Who is speaking, from a stranger's JSON: a name and a gender, and an age when it is one of ours. */
function speaker(raw: unknown): VoiceWho | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '';
  if (!name) return null;
  const age = asAge(r.age);
  return { name, gender: r.gender === 'female' ? 'female' : 'male', ...(age && { age }) };
}

function speak(key: string, voiceId: string, text: string, lang: 'pl' | 'en'): Promise<globalThis.Response> {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: VOICE_MODEL,
      language_code: lang,
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });
}

async function clip(req: Request, res: Response, body: Record<string, unknown>): Promise<void> {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_CLIP_CHARS) throw new BadRequest('Bad text');
  const voice = (Object.keys(DEMO_VOICES) as DemoVoice[]).find((v) => v === body.voice);
  if (!voice) throw new BadRequest('Unknown voice');
  const lang = body.lang === 'pl' ? 'pl' : 'en';
  const cost = clipCost(text.length);

  const settings = await readSettings();
  const day = dayKey();
  const ip = callerIp(req.headers['x-forwarded-for'] as string | undefined, req.ip);
  const claimed = await reserve(settings, day, ip, cost);
  if (!claimed.ok) {
    res.status(claimed.status).json({ reason: claimed.reason, detail: { message: `demo: ${claimed.reason}` } });
    return;
  }
  let spent = cost;
  try {
    const { elevenLabs } = await demoKeys(settings.keyUid);
    if (!elevenLabs) {
      spent = 0;
      res.status(503).json({ reason: 'no-voice', detail: { message: 'demo: no-voice' } });
      return;
    }
    // A character's own library voice (`voicePick.ts`), at the ordinary rate, so `cost` holds; the
    // premade voice when the library has none or will not speak it.
    const who = voice === 'player' ? null : speaker(body.who);
    const library = who
      ? await findVoice(
          who,
          lang,
          VOICE_MODEL,
          async (url) => (await voiceLists(lang, async () => elevenLabs))[url] ?? [],
          Object.values(DEMO_VOICES),
        ).catch(
          (e) => {
            reportError('rpgDemo.voices', e);
            return null;
          },
        )
      : null;
    let upstream = library ? await speak(elevenLabs, library, text, lang) : null;
    if (upstream && !upstream.ok && upstream.status !== 429 && upstream.status < 500) {
      reportError('rpgDemo.libraryVoice', new Error(`ElevenLabs ${upstream.status}`), { status: upstream.status, voice: library });
      upstream = null;
    }
    const spoken = upstream ? 'library' : 'premade';
    upstream ??= await speak(elevenLabs, DEMO_VOICES[voice], text, lang);
    if (!upstream.ok) {
      spent = 0;
      reportError('rpgDemo.voice', new Error(`ElevenLabs ${upstream.status}`), { status: upstream.status });
      res.status(502).json({ reason: 'provider', detail: { message: `ElevenLabs ${upstream.status}` } });
      return;
    }
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.status(200);
    res.set('Content-Type', 'audio/mpeg');
    res.set('x-demo-cost', String(cost));
    res.set('x-demo-voice', spoken);
    res.set('x-demo-remaining', JSON.stringify(remainingUsd(settings, claimed.spent)));
    res.send(audio);
  } finally {
    await settle(day, ip, cost, spent).catch((e) => reportError('rpgDemo.settle', e));
  }
}

/**
 * JSON, or JSON sent as text: the stats go out by `sendBeacon` as `text/plain`, which needs no CORS
 * preflight and survives the page closing.
 */
function parseBody(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function handleRpgDemo(req: Request, res: Response): Promise<void> {
  const allowed = cors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (!allowed) {
    res.status(403).json({ reason: 'origin' });
    return;
  }
  try {
    if (req.method === 'GET') {
      await status(req, res);
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ reason: 'method' });
      return;
    }
    const body = parseBody(req.body);
    if (body.kind === 'stats') await stats(res, body);
    else if (body.kind === 'beat') await beat(req, res, body);
    else if (body.kind === 'world') await world(req, res, body);
    else if (body.kind === 'voice') await clip(req, res, body);
    else if (body.kind === 'voices') await voices(res, body);
    else throw new BadRequest('Unknown kind');
  } catch (e) {
    if (e instanceof BadRequest) {
      if (!res.headersSent) res.status(400).json({ reason: 'bad-request', error: { message: e.message } });
      return;
    }
    reportError('rpgDemo', e);
    await flushSentry();
    if (!res.headersSent) res.status(500).json({ reason: 'failed', error: { message: 'demo failed' } });
    else res.end();
  }
}
