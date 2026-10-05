/*
 * Riding on the owner's key: the browser's half of the demo.
 *
 * Everything else in this app is in the browser on the reader's own key, with no server anywhere
 * (`.claude/rules/backseat.md`). This is the one call that leaves for a function of ours, and it
 * exists for the obvious reason: the app is the sort of thing somebody has to see working before
 * they will go and make an AI Studio key, and "paste an API key" is where every one of them stops.
 *
 * WHAT THIS MODULE DOES NOT SEND. No prompt, no model, no key. The function builds the system
 * prompt itself out of the persona, intensity and language it is sent, each checked against the
 * same closed lists `normalizeConfig` uses (`functions/src/demo/handler.ts`), so a request cannot
 * ask it for anything but a remark about a photograph. The angle comes BACK rather than going out,
 * because the function draws it.
 *
 * WHY A REFUSAL IS FATAL. A cap is a cap for the rest of the day, and a demo that is switched off
 * does not switch itself on between two snapshots — so a refusal stops the ride at once rather
 * than being one of the three failures the loop tolerates. That is what `DemoError.fatal` is for,
 * and it is the opposite reading from a provider's 429, which is worth retrying.
 *
 * STATUS IS ASKED BEFORE THE CAMERA, not after. The setup sheet needs to know whether to offer the
 * demo at all, and the one thing worse than no demo is a Start button that turns a camera on and
 * then says the demo is full.
 */

import { VisionError } from './vision';
import type { DemoApp, DemoReason } from './demoLimits';
import type { Frame, Intensity, Persona, RemarkLanguage } from './types';

/** What the function says about itself when asked. */
export interface DemoStatus {
  available: boolean;
  reason: DemoReason | null;
  /** How many calls are left today: `ip` for this address, `app` for everybody. */
  remaining: { ip: number; app: number };
  perIpDaily: number;
  perAppDaily: number;
  /** The floor the demo puts under the interval slider, so a demo ride cannot be a loop. */
  minIntervalSeconds: number;
  /** Named so the sheet can say what is looking rather than claiming a model it is not on. */
  model: string;
}

/**
 * A refusal from the demo, which will not resolve itself during this ride.
 *
 * `fatal` is overridden rather than left to `VisionError`'s status rule: a 429 from Google means
 * "slow down" and a 429 from here means "that was your fifteen".
 */
export class DemoError extends VisionError {
  readonly reason: DemoReason | 'origin' | 'bad-request' | 'provider' | 'failed';

  constructor(message: string, status: number | null, reason: DemoError['reason']) {
    super(message, status);
    this.name = 'DemoError';
    this.reason = reason;
  }

  override get fatal(): boolean {
    // A provider error is the owner's key, not this reader's, and the next round will fail the
    // same way; everything else here is a cap or a switch. Either way, stop.
    return true;
  }
}

/**
 * Where the function lives.
 *
 * The same shape as sloper's `assembleUrl`, with one difference: this returns null rather than
 * throwing. A build with no Firebase project configured is a fork or a local checkout, where the
 * honest answer is that there is no demo — not an exception on the setup sheet.
 */
export function demoUrl(): string | null {
  const override = import.meta.env.PUBLIC_BACKSEAT_DEMO_URL as string | undefined;
  if (override) return override;

  const project = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined;
  if (!project) return null;

  return `https://europe-central2-${project}.cloudfunctions.net/roastDemo`;
}

function asStatus(value: unknown): DemoStatus | null {
  const raw = (typeof value === 'object' && value !== null ? value : null) as
    | Record<string, unknown>
    | null;
  if (!raw) return null;
  const left = (typeof raw.remaining === 'object' && raw.remaining !== null ? raw.remaining : {}) as
    Record<string, unknown>;
  const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

  return {
    available: raw.available === true,
    reason: typeof raw.reason === 'string' ? (raw.reason as DemoReason) : null,
    remaining: { ip: count(left.ip), app: count(left.app) },
    perIpDaily: count(raw.perIpDaily),
    perAppDaily: count(raw.perAppDaily),
    minIntervalSeconds: count(raw.minIntervalSeconds) || 12,
    model: typeof raw.model === 'string' ? raw.model : '',
  };
}

/**
 * Whether the demo is open, and how much of it is left.
 *
 * Never throws and never reports why it could not ask: a function that is down, a network that is
 * not there and a demo that is switched off all mean the same thing to this screen, which is that
 * there is a key field to fill in instead.
 */
export async function fetchDemoStatus(
  app: DemoApp,
  signal?: AbortSignal,
): Promise<DemoStatus | null> {
  const url = demoUrl();
  if (!url) return null;
  try {
    const response = await fetch(`${url}?app=${encodeURIComponent(app)}`, { signal });
    if (!response.ok) return null;
    return asStatus(await response.json());
  } catch {
    return null;
  }
}

export interface DemoAsk {
  app: DemoApp;
  persona: Persona;
  intensity: Intensity;
  lang: RemarkLanguage;
  /** The last few remarks, for the function to tell the model to avoid. */
  recent: string[];
  frame: Frame;
  signal?: AbortSignal;
  /** Stage marks for the round's timeline (`rideLog.ts`), under the vision names. */
  onMark?: (name: string) => void;
}

export interface DemoRemark {
  text: string;
  /** The comic device the function drew, so the saved record says which one it was. */
  angle: string;
  remaining: { ip: number; app: number };
}

const MESSAGES: Record<string, string> = {
  disabled: 'The demo is switched off.',
  'no-key': 'The demo has no key behind it at the moment.',
  'app-off': 'The demo is switched off for this app.',
  'ip-cap': 'That is all the demo remarks for this device today.',
  'app-cap': "That is all of today's demo remarks. Everybody shares them.",
  origin: 'The demo does not answer this page.',
  'bad-request': 'The demo would not take that request.',
  provider: 'The model behind the demo would not answer.',
  failed: 'The demo is not working at the moment.',
};

/** One remark, on the owner's key. The angle and the prompt are the function's business. */
export async function askDemo(ask: DemoAsk): Promise<DemoRemark> {
  const url = demoUrl();
  if (!url) throw new DemoError(MESSAGES.failed, null, 'failed');

  ask.onMark?.('vision.sent');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: ask.signal,
    body: JSON.stringify({
      app: ask.app,
      persona: ask.persona,
      intensity: ask.intensity,
      lang: ask.lang,
      recent: ask.recent,
      image: ask.frame.base64,
      mimeType: ask.frame.mimeType,
    }),
  });
  ask.onMark?.('vision.headers');

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  ask.onMark?.('vision.body');

  if (!response.ok) {
    const reason = typeof body.reason === 'string' ? body.reason : 'failed';
    throw new DemoError(MESSAGES[reason] ?? MESSAGES.failed, response.status, reason as never);
  }

  const text = typeof body.text === 'string' ? body.text : '';
  const left = (typeof body.remaining === 'object' && body.remaining !== null
    ? body.remaining
    : {}) as Record<string, unknown>;
  const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

  return {
    text,
    angle: typeof body.angle === 'string' ? body.angle : 'demo',
    remaining: { ip: count(left.ip), app: count(left.app) },
  };
}
