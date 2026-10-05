/*
 * The demo: one remark, for somebody with no account and no API key, on the owner's key.
 *
 * `/apps/backseat/` and `/apps/roaster/` are otherwise entirely in the browser — a frame goes from
 * a canvas to Google and a sentence comes back, on the reader's own key, with no server anywhere
 * (`.claude/rules/backseat.md`). This is the one exception, and it exists for the obvious reason:
 * the apps are the sort of thing somebody has to see working before they will go and make an AI
 * Studio key, and "paste an API key" is where every one of them stops.
 *
 * So the owner's key answers the first few, and everything in this file is about the fact that it
 * is somebody else's key:
 *
 * THE PROMPT IS BUILT HERE, NOT SENT. The request names a persona, an intensity and a language out
 * of closed lists, and the system prompt is assembled from them by the *same* `systemPrompt` the
 * browser uses. A handler that accepted a prompt would be a free, unauthenticated Gemini proxy
 * with the owner's name on the bill, which is a different product from a demo of a joke app.
 *
 * THE KEY IS NEVER IN THIS REPOSITORY, AND IS NOT A SECRET MANAGER SECRET EITHER. It is read at
 * call time out of `users/{keyUid}/keys/config` — the account's own shared key store
 * (`.claude/rules/account-keys.md`), where its owner already edits and clears it. That buys three
 * things: there is no second copy to rotate, revoking it in the account page revokes it here, and
 * turning the demo on is a uid in a settings document rather than a deploy. What it costs is that
 * this function reads one document with the Admin SDK that no browser could; the uid it reads is
 * the one the panel wrote, and nothing in a request names it.
 *
 * NOTHING IS WRITTEN DOWN ABOUT WHO ASKED. The frame is not saved — `rideLog.ts` writes only for a
 * signed-in account, and a demo has none — the remark is not stored, and the rate-limit bucket is
 * a salted hash of the address with the day in the salt (`limits.ts`). The only durable trace of a
 * demo call is two integers getting bigger.
 *
 * IT IS TWO-STEP ONLY. Gemini Live is a WebSocket the browser opens with a key in the URL, so
 * there is no way to lend it without lending the key itself; the demo answers with text and the
 * phone's own synthesiser reads it, which costs nobody anything. The browser knows this and does
 * not offer the mode (`defaults.ts`, `demoRestrictions`).
 */

import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';

import { INTENSITIES, REMARK_LANGUAGES } from '../../../korczak-xyz/src/utils/backseat/defaults';
import { FLAVOURS } from '../../../korczak-xyz/src/utils/backseat/flavour';
import {
  anglesFor,
  pickAngle,
  sanitizeRemark,
  systemPrompt,
  userPromptFor,
} from '../../../korczak-xyz/src/utils/backseat/remarks';
import { VisionError, askForRemark } from '../../../korczak-xyz/src/utils/backseat/vision';
import type { Intensity, Persona, RemarkLanguage } from '../../../korczak-xyz/src/utils/backseat/types';
import { keysFrom } from '../../../korczak-xyz/src/utils/accountKeys/keys';
import { ALLOWED_ORIGINS } from '../sloper/metadata';
import { db } from '../runtime';
import { flushSentry, reportError } from '../sentry';
import {
  DEMO_APPS,
  callerIp,
  checkDemo,
  dayKey,
  ipKey,
  normalizeSettings,
  remaining,
  type DemoApp,
  type DemoSettings,
} from './limits';

/** Where the panel writes the settings and this reads them. */
export const SETTINGS_PATH = ['demo', 'config'] as const;

/**
 * The frame, at the size `frame.ts` already produces: a 512px long side at quality 0.6 is tens of
 * kilobytes, so a cap an order of magnitude above that refuses a body nobody's camera sent while
 * leaving every real one alone. Base64, so the wire is a third larger again.
 */
const MAX_IMAGE_BYTES = 600 * 1024;

/** How many previous remarks a caller may send back to be avoided, and how long each may be. */
const MAX_RECENT = 10;
const MAX_RECENT_CHARS = 200;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function cors(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  const allowed = typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin) ? origin : null;
  if (allowed) {
    res.set('Access-Control-Allow-Origin', allowed);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '3600');
  return allowed !== null;
}

export async function readSettings(): Promise<DemoSettings> {
  const snap = await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).get();
  return normalizeSettings(snap.exists ? snap.data() : {});
}

/**
 * The owner's Google key, out of the account store it already lives in.
 *
 * Read with the site's own `keysFrom`, not by reaching for a field name. The store is
 * `{ apiKeys: { google, openai, … } }` (`utils/accountKeys/keys.ts`) and the first version of this
 * read `data().google` — one level too shallow, which is a demo that answers `no-key` with the key
 * sitting right there. Importing the reader every app uses is what stops that happening again.
 *
 * A missing document, a cleared key or a uid that names nobody all come back as null, which the
 * caller reports as "the demo is not available" — the same sentence the switch being off produces.
 * A demo that explained which document was empty would be telling a stranger about the owner's
 * account.
 */
async function demoKey(uid: string): Promise<string | null> {
  if (!uid) return null;
  const snap = await db.collection('users').doc(uid).collection('keys').doc('config').get();
  return snap.exists ? keysFrom(snap.data()).google : null;
}

function counters(app: DemoApp, day: string, ip: string) {
  const appDoc = db.collection('demoUsage').doc(`${app}-${day}`);
  return { appDoc, ipDoc: appDoc.collection('ips').doc(ipKey(ip, day)) };
}

async function readUsed(app: DemoApp, day: string, ip: string): Promise<{ ip: number; app: number }> {
  const { appDoc, ipDoc } = counters(app, day, ip);
  const [appSnap, ipSnap] = await Promise.all([appDoc.get(), ipDoc.get()]);
  const count = (snap: FirebaseFirestore.DocumentSnapshot): number => {
    const value = snap.exists ? snap.data()?.count : 0;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return { ip: count(ipSnap), app: count(appSnap) };
}

/**
 * Claim one call, and say what the counts were BEFORE it.
 *
 * In a transaction because two tabs on one phone are the normal case rather than the exotic one,
 * and because a cap enforced with a read-then-write is a cap enforced on about half the traffic.
 * The claim happens before the model is called, so a Google error spends a demo call — the strict
 * direction, and the alternative is a refund path that a loop can fail on purpose.
 */
async function claim(
  app: DemoApp,
  day: string,
  ip: string,
  settings: DemoSettings,
): Promise<{ ok: true; used: { ip: number; app: number } } | { ok: false; status: number; reason: string }> {
  const { appDoc, ipDoc } = counters(app, day, ip);

  return db.runTransaction(async (tx) => {
    const [appSnap, ipSnap] = await Promise.all([tx.get(appDoc), tx.get(ipDoc)]);
    const number = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const used = {
      app: number(appSnap.exists ? appSnap.data()?.count : 0),
      ip: number(ipSnap.exists ? ipSnap.data()?.count : 0),
    };

    const verdict = checkDemo(settings, app, used);
    if (!verdict.ok) return { ok: false as const, status: verdict.status, reason: verdict.reason };

    // `day` on the document as well as in its id, so a listing is readable without parsing ids,
    // and `at` so an abandoned bucket can be swept one day without guessing when it was made.
    tx.set(appDoc, { count: FieldValue.increment(1), app, day, at: Date.now() }, { merge: true });
    tx.set(ipDoc, { count: FieldValue.increment(1), day, at: Date.now() }, { merge: true });
    return { ok: true as const, used: { ip: used.ip + 1, app: used.app + 1 } };
  });
}

class BadDemoRequest extends Error {}

interface DemoAsk {
  app: DemoApp;
  persona: Persona;
  intensity: Intensity;
  lang: RemarkLanguage;
  recent: string[];
  base64: string;
  mimeType: string;
}

/**
 * The body, checked field by field against the same closed lists the browser's own settings are
 * validated against. Everything here is a stranger's JSON, and the only reason the prompt is safe
 * to build from it is that nothing in it is free text except the remarks to avoid — which are
 * bounded in number and length, and which this app wrote in the first place.
 */
export function parseAsk(body: unknown): DemoAsk {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const app = DEMO_APPS.find((name) => name === raw.app);
  if (!app) throw new BadDemoRequest('Unknown app');

  const flavour = FLAVOURS[app];
  const persona = flavour.personas.find((name) => name === raw.persona) ?? flavour.defaultPersona;
  const intensity = (INTENSITIES.find((name) => name === raw.intensity) ?? 'normal') as Intensity;
  const lang = (REMARK_LANGUAGES.find((name) => name === raw.lang) ?? 'en') as RemarkLanguage;

  const recent = Array.isArray(raw.recent)
    ? raw.recent
        .filter((line): line is string => typeof line === 'string')
        .slice(-MAX_RECENT)
        .map((line) => line.slice(0, MAX_RECENT_CHARS))
    : [];

  const base64 = typeof raw.image === 'string' ? raw.image : '';
  if (!base64) throw new BadDemoRequest('No image');
  // Cheap length arithmetic rather than decoding: base64 is 4 characters per 3 bytes.
  if ((base64.length * 3) / 4 > MAX_IMAGE_BYTES) throw new BadDemoRequest('Image too large');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new BadDemoRequest('Image is not base64');

  const mimeType = typeof raw.mimeType === 'string' && IMAGE_TYPES.includes(raw.mimeType)
    ? raw.mimeType
    : 'image/jpeg';

  return { app, persona, intensity, lang, recent, base64, mimeType };
}

/** What the browser is told when it asks whether the demo is open, before it starts a camera. */
async function status(req: Request, res: Response): Promise<void> {
  const settings = await readSettings();
  const app = DEMO_APPS.find((name) => name === req.query.app) ?? 'roaster';
  const day = dayKey();
  const used = await readUsed(app, day, callerIp(req.headers['x-forwarded-for'] as string | undefined, req.ip));
  const verdict = checkDemo(settings, app, used);

  res.status(200).json({
    // One flag, so the browser never has to work out which of five reasons means "not today".
    available: verdict.ok,
    reason: verdict.ok ? null : verdict.reason,
    remaining: remaining(settings, used),
    perIpDaily: settings.perIpDaily,
    perAppDaily: settings.perAppDaily,
    minIntervalSeconds: settings.minIntervalSeconds,
    // Named so the setup sheet can say what is looking, rather than claiming a model it is not on.
    model: settings.model,
  });
}

async function remark(req: Request, res: Response): Promise<void> {
  const ask = parseAsk(req.body);
  const settings = await readSettings();
  const day = dayKey();
  const ip = callerIp(req.headers['x-forwarded-for'] as string | undefined, req.ip);

  const claimed = await claim(ask.app, day, ip, settings);
  if (!claimed.ok) {
    res.status(claimed.status).json({ reason: claimed.reason, available: false });
    return;
  }

  const key = await demoKey(settings.keyUid);
  if (!key) {
    res.status(503).json({ reason: 'no-key', available: false });
    return;
  }

  const angle = pickAngle(null, Math.random, anglesFor(ask.app));
  const system = systemPrompt({
    flavour: ask.app,
    angle,
    persona: ask.persona,
    intensity: ask.intensity,
    lang: ask.lang,
    recent: ask.recent,
  });

  const raw = await askForRemark({
    provider: 'google',
    apiKey: key,
    model: settings.model,
    system,
    user: userPromptFor(ask.app),
    frame: {
      dataUrl: `data:${ask.mimeType};base64,${ask.base64}`,
      base64: ask.base64,
      mimeType: ask.mimeType,
      width: 0,
      height: 0,
    },
  });

  // Sanitised here as well as in the browser: the demo's answer is read by the same screen, and a
  // stage direction is no more speakable for having come from a function.
  const text = sanitizeRemark(raw);
  res.status(200).json({
    text,
    angle,
    remaining: remaining(settings, claimed.used),
  });
}

export async function handleRoastDemo(req: Request, res: Response): Promise<void> {
  const allowed = cors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (!allowed) {
    // A browser would have been stopped by the preflight; this is for everything else.
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
    await remark(req, res);
  } catch (e) {
    if (e instanceof BadDemoRequest) {
      res.status(400).json({ reason: 'bad-request', message: e.message });
      return;
    }
    /*
     * A provider error is the owner's key being out of quota or rejected, which is worth knowing
     * about — it is the one failure here that makes the demo look broken to everybody at once —
     * but the caller is told nothing about whose key it was or what Google said about it.
     */
    if (e instanceof VisionError) {
      reportError('roastDemo', e, { status: e.status });
      await flushSentry();
      res.status(502).json({ reason: 'provider' });
      return;
    }
    reportError('roastDemo', e);
    await flushSentry();
    res.status(500).json({ reason: 'failed' });
  }
}
