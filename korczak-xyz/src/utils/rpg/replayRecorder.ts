/*
 * The recorder behind the admin's *Replay* (`replay.ts` has the shape and the reasons). A
 * module-level store, like `devlog.ts`: the storyteller, the voice and the scene write to it from
 * wherever they are, with `rec(kind, fields)`.
 *
 * - **One session per opening of the page**, its id minted here. Nothing is sent until the player
 *   has done something (`arm`, at the first key, tap or click), so a page opened and closed unread
 *   costs nothing, and a headless browser never sends at all (`navigator.webdriver`, as Sentry's
 *   `automated()`), unless `?replay=1` asks — which is how this code is tested.
 * - **Sent every 15 s and when the page hides**, to `rpgDemo` as `{kind:'replay'}` in `text/plain`,
 *   by `sendBeacon` when the page goes — the same road as the site's stats (`stats.ts`). A signed-in
 *   player's ID token rides in the body, so the server can say whose session it was; a guest is
 *   known only by the browser's guest id. Lost if the network is: a recording, not money.
 * - **What it weighs**: a few dozen bytes an event, the hero's position at most every 2 s and only
 *   when it moved, so an hour is of the order of 100 KB. After `sessionEvents` it stops and says so.
 * - **The waits** — when the player is held by the game — are kept here (`waitStart`/`waitEnd`), so
 *   that a wait that is still open when the page hides is closed honestly by the summary.
 */

import { guestId, rpgDemoUrl } from './demo';
import { EMPTY_SUMMARY, REPLAY_FRAMES, REPLAY_LIMITS, newReplayId, type ReplayEvent, type ReplayKind, type ReplaySummary, type ReplayValue } from './replay';

const FLUSH_MS = 15_000;

const id = newReplayId();
const t0 = Date.now();
let buffer: ReplayEvent[] = [];
let seq = 0;
let recorded = 0;
let armed = false;
let capped = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let tokenOf: (() => Promise<string | null>) | null = null;
let token: string | null = null;
const summary: ReplaySummary = { ...EMPTY_SUMMARY };
const waits = new Map<string, number>();
const shows = new Map<string, { t: number; asked: number | null }>();
let shownSeq = 0;
let visibleSince: number | null = null;
let lastInput = 0;
const reqStarted = new Map<number, number>();
/** When each kind of asset was last asked for, to measure asked → standing. */
const askedAt = new Map<string, number>();

function enabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(location.search).get('replay') === '1') return true;
  } catch {
    /* fall through */
  }
  return !(typeof navigator !== 'undefined' && navigator.webdriver);
}

const on = enabled();

/** Events after which the screen looks different: a picture of it soon after (`frameSoon`). */
const SCREEN_CHANGES = new Set<string>(['world', 'beat', 'menu', 'wait', 'waited', 'stall', 'ending', 'notice', 'death']);

function now(): number {
  return Date.now() - t0;
}

/** This session's id, for a test or the console. */
export function replayId(): string {
  return id;
}

/** Records one event. Fields are flat; strings are cut by the server too. */
export function rec(k: ReplayKind, fields: Record<string, ReplayValue | undefined> = {}): void {
  if (!on || capped) return;
  const e: ReplayEvent = { t: now(), k };
  for (const [name, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    e[name] = typeof v === 'string' && v.length > REPLAY_LIMITS.text ? `${v.slice(0, REPLAY_LIMITS.text - 1)}…` : v;
  }
  buffer.push(e);
  if (SCREEN_CHANGES.has(k)) frameSoon();
  recorded += 1;
  summary.events = recorded;
  note(e);
  if (recorded >= REPLAY_LIMITS.sessionEvents) {
    capped = true;
    buffer.push({ t: now(), k: 'cap' });
  }
  schedule();
}

/** What an event changes in the summary. */
function note(e: ReplayEvent): void {
  switch (e.k) {
    case 'world':
      summary.worlds += 1;
      break;
    case 'quest':
      summary.quests += 1;
      break;
    case 'beat':
      if (typeof e.n === 'number') summary.beats = Math.max(summary.beats, e.n + 1);
      break;
    case 'choice':
    case 'free':
      summary.choices += 1;
      break;
    case 'stall':
      summary.stalls += 1;
      break;
    case 'error':
      summary.errors += 1;
      break;
    case 'res':
      if (e.ok === false) summary.errors += 1;
      break;
    case 'ending':
      summary.ended = true;
      break;
    case 'screen':
      if (typeof e.s === 'string') summary.last = e.s;
      break;
    default:
  }
}

/** The account's ID token, asked again before each send so it is fresh for the beacon. */
export function setReplayToken(source: (() => Promise<string | null>) | null): void {
  tokenOf = source;
  if (!source) token = null;
}

function schedule(): void {
  if (!armed || timer !== null || typeof window === 'undefined') return;
  timer = setTimeout(() => void flushReplay(), FLUSH_MS);
}

/** The player did something: the session is worth sending, and an idle stretch ends. */
function input(): void {
  const t = now();
  if (lastInput && t - lastInput >= 30_000) rec('idle', { ms: t - lastInput });
  lastInput = t;
  if (!armed) {
    armed = true;
    schedule();
  }
}

/** A wait the player is held by began (`replay.ts`, `wait`). Opening one already open does nothing. */
export function waitStart(r: string): void {
  if (waits.has(r)) return;
  waits.set(r, now());
  rec('wait', { r });
}

export function waitEnd(r: string): void {
  const since = waits.get(r);
  if (since === undefined) return;
  waits.delete(r);
  const ms = now() - since;
  summary.waitMs += ms;
  summary.longestWaitMs = Math.max(summary.longestWaitMs, ms);
  rec('waited', { r, ms });
}

/** A paid request began (`devlog.ts`'s `startRequest`). */
export function recRequest(o: { id: number; kind: string; model: string; label?: string; beat: number | null }): void {
  reqStarted.set(o.id, now());
  if (o.label) askedAt.set(o.label, now());
  rec('req', { id: o.id, kind: o.kind, model: o.model, label: o.label, n: o.beat });
}

export function recResponse(o: { id: number; ms: number | null; error: string | null; usd: number | null }): void {
  reqStarted.delete(o.id);
  rec('res', { id: o.id, ms: o.ms, ok: o.error === null, err: o.error ?? undefined, usd: o.usd === null ? undefined : Math.round(o.usd * 1e5) / 1e5 });
}

/**
 * The scene was handed an asset to stand up (`show`); the returned function says it stands
 * (`shown`). `asked` names the request label it most likely came from, to measure asked → standing.
 */
export function recShow(what: string, name: string): (ok: boolean) => void {
  const sid = `s${++shownSeq}`;
  const t = now();
  const asked = askedAt.get(name) ?? askedAt.get(what) ?? null;
  shows.set(sid, { t, asked });
  rec('show', { id: sid, what, name });
  return (ok: boolean) => {
    const s = shows.get(sid);
    if (!s) return;
    shows.delete(sid);
    const end = now();
    if (ok && s.asked !== null) summary.longestAssetMs = Math.max(summary.longestAssetMs, end - s.asked);
    rec('shown', { id: sid, ms: end - s.t, ok });
  };
}

function summaryNow(): ReplaySummary {
  const t = now();
  const active = summary.activeMs + (visibleSince === null ? 0 : t - visibleSince);
  // A wait still open counts as far as it has gone.
  let open = 0;
  let longest = summary.longestWaitMs;
  for (const since of waits.values()) {
    open += t - since;
    longest = Math.max(longest, t - since);
  }
  return { ...summary, ms: t, activeMs: active, waitMs: summary.waitMs + open, longestWaitMs: longest };
}

let sending = false;

/** Sends what is gathered. `beacon` for a page going away, where a fetch would be cut. */
export async function flushReplay(beacon = false): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!on || !armed || buffer.length === 0 || seq >= REPLAY_LIMITS.chunks) return;
  const url = rpgDemoUrl();
  if (!url) return;
  if (!beacon && tokenOf) token = await tokenOf().catch(() => null);
  if (sending && !beacon) {
    schedule();
    return;
  }
  // Cut to what one chunk may carry; the rest goes in the next.
  const events = buffer.slice(0, REPLAY_LIMITS.chunkEvents);
  buffer = buffer.slice(events.length);
  const n = seq++;
  const body = JSON.stringify({
    kind: 'replay',
    id,
    seq: n,
    startedAt: t0,
    events,
    summary: summaryNow(),
    ...(n === 0 ? { open: { lang: document.documentElement.lang || '', host: location.host, mobile: matchMedia('(pointer: coarse)').matches, guest: guestId() } } : {}),
    ...(token ? { token } : {}),
  });
  try {
    if (beacon && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) {
      if (buffer.length) void flushReplay(true);
      return;
    }
    sending = true;
    await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: body.length < 60_000 }).catch(() => {});
  } catch {
    // A recording; never the game's problem.
  } finally {
    sending = false;
  }
  if (buffer.length) schedule();
}

/** Starts listening: input, the page hiding and coming back. Once, from the game's page. */
let started = false;
export function startReplay(): void {
  if (!on || started || typeof window === 'undefined') return;
  started = true;
  visibleSince = document.visibilityState === 'visible' ? now() : null;
  let from = '';
  try {
    from = document.referrer ? new URL(document.referrer).host : '';
  } catch {
    /* none */
  }
  rec('open', {
    lang: document.documentElement.lang || '',
    path: location.pathname,
    w: window.innerWidth,
    h: window.innerHeight,
    mobile: matchMedia('(pointer: coarse)').matches,
    from: from && from !== location.host ? from : undefined,
  });
  for (const type of ['keydown', 'pointerdown', 'touchstart', 'wheel']) window.addEventListener(type, input, { passive: true, capture: true });
  const leave = () => {
    if (visibleSince === null) return;
    summary.activeMs += now() - visibleSince;
    visibleSince = null;
    rec('hide');
    void flushReplay(true);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
    else if (visibleSince === null) {
      visibleSince = now();
      rec('back');
    }
  });
  window.addEventListener('pagehide', leave);
}

/*
 * What the player saw: a small JPEG of the scene every `everyMs` while the game is played, and soon
 * after anything that changes the screen (`frameSoon`: a step, a dialogue, a wait beginning), never
 * two within `minGapMs`. Sent on their own to `rpgDemo` as `{kind:'frame'}`, after the session's
 * first chunk so the server knows the session. Only while the page is visible, and only the scene's
 * canvas (`RpgScene.captureFrame`), never the page — so never a key typed in Settings.
 */
let capture: (() => Promise<Blob | null>) | null = null;
let framesOn: () => boolean = () => false;
let framesSent = 0;
let lastFrameAt = -Infinity;
let frameTimer: ReturnType<typeof setTimeout> | null = null;
let soonTimer: ReturnType<typeof setTimeout> | null = null;
let framing = false;

function frameDue(): void {
  if (frameTimer !== null) clearTimeout(frameTimer);
  frameTimer = setTimeout(() => void takeFrame(), REPLAY_FRAMES.everyMs);
}

async function takeFrame(): Promise<void> {
  frameDue();
  if (!on || !capture || framing || !armed || capped || framesSent >= REPLAY_FRAMES.perSession) return;
  if (document.visibilityState !== 'visible' || !framesOn()) return;
  const t = now();
  if (t - lastFrameAt < REPLAY_FRAMES.minGapMs) return;
  const url = rpgDemoUrl();
  if (!url) return;
  framing = true;
  try {
    // The server keeps a picture only for a session it has heard of.
    if (seq === 0) await flushReplay();
    if (seq === 0) return;
    const blob = await Promise.race([capture(), new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
    if (!blob || blob.size > REPLAY_FRAMES.maxBytes) return;
    lastFrameAt = t;
    const jpeg = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    framesSent += 1;
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ kind: 'frame', id, t, jpeg }),
      headers: { 'Content-Type': 'text/plain' },
    }).catch(() => {});
  } catch {
    // A picture; never the game's problem.
  } finally {
    framing = false;
  }
}

/** Something on screen changed: a picture shortly, once the scene has drawn it. */
export function frameSoon(): void {
  if (!capture || soonTimer !== null) return;
  soonTimer = setTimeout(() => {
    soonTimer = null;
    void takeFrame();
  }, 1200);
}

/** Starts the pictures: `take` asks the scene for one, `active` says whether the game is on screen. */
export function startFrames(take: () => Promise<Blob | null>, active: () => boolean): void {
  if (!on || capture) return;
  capture = take;
  framesOn = active;
  frameDue();
}
