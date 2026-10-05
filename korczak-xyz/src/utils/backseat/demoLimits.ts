/*
 * What the demo is allowed to do: the settings, the caps, and the one verdict function.
 *
 * The demo lets somebody with no account and no API key point their camera at something and hear
 * a remark, paid for by the owner's own Google key. That is a stranger spending somebody else's
 * quota, so everything that bounds it is in one pure file with a test beside it.
 *
 * COMPILED TWICE, like the Event Watch matcher and for the same reason. The Cloud Function decides
 * whether a call may proceed; the admin panel writes the settings it decides from and has to agree
 * about what each field means and what the maxima are. `functions/tsconfig.json` compiles this file
 * into the backend (it re-exports it from `src/demo/limits.ts`, which adds the parts that need
 * node's crypto and so cannot live here), so a cap cannot mean one number in the panel and another
 * in the handler. Nothing here may import the DOM, Firebase or React.
 *
 * TWO CAPS, BECAUSE THEY FAIL DIFFERENTLY. One person with a camera and a loop can spend a day's
 * quota in ten minutes, and that is what the per-IP cap is for. A hundred people each inside their
 * own limit can do the same thing more slowly, and that is what the per-app one is for. Neither
 * alone is the answer and the two are checked in that order, because "you have had your go" and
 * "the site has had its day" need different sentences.
 */

/** Which app is asking. The same two flavours as `flavour.ts`. */
export type DemoApp = 'backseat' | 'roaster';

export const DEMO_APPS: readonly DemoApp[] = ['backseat', 'roaster'];

export interface DemoSettings {
  /** The master switch. Off means every call is refused, whatever the counters say. */
  enabled: boolean;
  /**
   * Whose Google key pays. A uid rather than a secret: the key itself stays in that account's own
   * `users/{uid}/keys/config`, where its owner already manages it, and turning the demo off is a
   * flag here rather than a secret to rotate. Empty means nobody has volunteered one yet, which
   * reads to the browser exactly like "off".
   */
  keyUid: string;
  /** The model the demo runs on. Flash-Lite, because the demo is free and so is the quota. */
  model: string;
  /** Per address, per app, per day. */
  perIpDaily: number;
  /** Per app, per day, across everybody. */
  perAppDaily: number;
  /** Which apps offer it at all. */
  apps: Record<DemoApp, boolean>;
  /** The floor the demo puts under the interval slider, in seconds. */
  minIntervalSeconds: number;
}

/**
 * Sane defaults, which is what runs until somebody opens the panel.
 *
 * `enabled` is true and `keyUid` is empty, so the shipped state is "ready, nobody is paying" — the
 * demo is off in practice and one button in the admin panel turns it on. The numbers are a guess
 * with a reason: 15 remarks is two or three minutes of pointing a phone at things, which is enough
 * to see what the app is, and 400 a day is comfortably inside the free tier of an AI Studio key
 * (15 requests a minute, about a thousand a day) with room left for the owner's own rides.
 */
export const DEMO_DEFAULTS: DemoSettings = {
  enabled: true,
  keyUid: '',
  model: 'gemini-2.5-flash-lite',
  perIpDaily: 15,
  perAppDaily: 400,
  apps: { backseat: true, roaster: true },
  minIntervalSeconds: 12,
};

/** The caps a panel may set. Above these the owner is not configuring a demo, they are donating. */
export const MAX_PER_IP_DAILY = 200;
export const MAX_PER_APP_DAILY = 5000;
export const MAX_MIN_INTERVAL = 120;

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Whatever is in the settings document, turned into something every caller can rely on.
 *
 * The same paranoia as `normalizeConfig` and for the same reason: this is a hand-editable
 * document, and a missing field must degrade to a default rather than to `undefined` — an
 * `undefined` cap compares false against every count, which is the one failure mode here that
 * spends money.
 */
export function normalizeSettings(value: unknown): DemoSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const apps = (typeof raw.apps === 'object' && raw.apps !== null ? raw.apps : {}) as
    Record<string, unknown>;

  return {
    enabled: raw.enabled !== false,
    keyUid: typeof raw.keyUid === 'string' ? raw.keyUid.trim() : '',
    model: typeof raw.model === 'string' && raw.model.trim() !== ''
      ? raw.model.trim()
      : DEMO_DEFAULTS.model,
    perIpDaily: asInt(raw.perIpDaily, DEMO_DEFAULTS.perIpDaily, 0, MAX_PER_IP_DAILY),
    perAppDaily: asInt(raw.perAppDaily, DEMO_DEFAULTS.perAppDaily, 0, MAX_PER_APP_DAILY),
    apps: {
      backseat: apps.backseat !== false,
      roaster: apps.roaster !== false,
    },
    minIntervalSeconds: asInt(
      raw.minIntervalSeconds,
      DEMO_DEFAULTS.minIntervalSeconds,
      1,
      MAX_MIN_INTERVAL,
    ),
  };
}

/** Why the demo said no. The browser turns each of these into one sentence. */
export type DemoReason = 'disabled' | 'no-key' | 'app-off' | 'ip-cap' | 'app-cap';

export type DemoRefusal =
  | { ok: false; reason: 'disabled'; status: 503 }
  | { ok: false; reason: 'no-key'; status: 503 }
  | { ok: false; reason: 'app-off'; status: 503 }
  | { ok: false; reason: 'ip-cap'; status: 429 }
  | { ok: false; reason: 'app-cap'; status: 429 };

export type DemoVerdict = { ok: true } | DemoRefusal;

/**
 * Whether this call may proceed, given the settings and the two counts as they stand.
 *
 * The counts are what has ALREADY been spent, so the comparison is `>=`: a cap of 15 allows the
 * 15th call and refuses the 16th.
 */
export function checkDemo(
  settings: DemoSettings,
  app: DemoApp,
  used: { ip: number; app: number },
): DemoVerdict {
  if (!settings.enabled) return { ok: false, reason: 'disabled', status: 503 };
  if (!settings.keyUid) return { ok: false, reason: 'no-key', status: 503 };
  if (!settings.apps[app]) return { ok: false, reason: 'app-off', status: 503 };
  if (used.ip >= settings.perIpDaily) return { ok: false, reason: 'ip-cap', status: 429 };
  if (used.app >= settings.perAppDaily) return { ok: false, reason: 'app-cap', status: 429 };
  return { ok: true };
}

/** What is left, for the browser to show beside the button. Never negative. */
export function remaining(
  settings: DemoSettings,
  used: { ip: number; app: number },
): { ip: number; app: number } {
  return {
    ip: Math.max(0, settings.perIpDaily - used.ip),
    app: Math.max(0, settings.perAppDaily - used.app),
  };
}
