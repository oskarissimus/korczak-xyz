/*
 * The game's replays (owner, 24 Nov 2026: "record the game's state while people play, so I can see
 * in the admin how they played, what they need, where they get stuck — and the assets too: when each
 * one was made and when the player saw it, so I see the delay and what it does to the game").
 *
 * The shape both runtimes agree on: the browser records (`replayRecorder.ts`), `rpgDemo` keeps
 * (`functions/src/rpg/replay.ts`), the admin's *Replay* tab reads (`AdminReplay.tsx`). Pure, no DOM,
 * no Firestore — the function compiles it, so it is on `firebase-deploy.yml`'s paths.
 *
 * A session is one opening of the game's page. It is a list of events, each `{t, k, …}`: `t` ms
 * since the page opened, `k` what happened, and a few flat fields (strings, numbers, booleans). No
 * key, no e-mail and no address is ever a field; `redact` strips anything shaped like a key from the
 * strings a second time on the server, because an error message is the one place one could slip in.
 */

/** A session's id: minted by the browser, sortable by time. */
export const REPLAY_ID = /^r-[a-z0-9]{6,12}-[a-z0-9]{4,12}$/;

export function newReplayId(now = Date.now(), random = Math.random): string {
  return `r-${now.toString(36)}-${random().toString(36).slice(2, 10).padEnd(6, '0')}`;
}

/** What a session may weigh: a chunk, the number of chunks, and the events in all. */
export const REPLAY_LIMITS = {
  /** Events in one chunk; the browser sends every 15 s, so this is far above a normal chunk. */
  chunkEvents: 400,
  /** Bytes of one chunk's events as JSON. */
  chunkBytes: 60_000,
  /** Chunks in one session: at one every 15 s, a little over four hours of play. */
  chunks: 1000,
  /** Events the browser records in one session before it stops (and says so with `cap`). */
  sessionEvents: 20_000,
  /** Characters of one string field. */
  text: 300,
  /** Fields of one event besides `t` and `k`. */
  fields: 12,
  /** Days a session is kept: `expireAt`, Firestore's TTL deletes it after. */
  days: 30,
} as const;

export const REPLAY_CHUNKS = 'rpgReplayChunks';
export const REPLAY_COLLECTION = 'rpgReplays';

export type ReplayValue = string | number | boolean | null;

export interface ReplayEvent {
  /** Ms since the session began. */
  t: number;
  /** What happened (see `KINDS`). */
  k: string;
  [field: string]: ReplayValue;
}

/**
 * Every kind of event, with what its fields mean — the one list the recorder writes and the
 * timeline reads.
 *
 * - `open` the page: `lang`, `path`, `w`×`h`, `mobile`, `from` (the referrer's host)
 * - `screen` a screen of the menu or the game: `s`, `tab`
 * - `world` entered: `id`, `name` · `quest` began: `id`, `mode` (google, openai, demo, diesel, static)
 * - `beat` on screen: `n`, `title`, `goal`, `npc`, `place`, `job`
 * - `line` said: `kind` (beat, npc, clue, ask, decision), `who`, `text`
 * - `choice` picked: `label`, `kind` · `free` a typed line: `text`
 * - `progress` of a job: `n`, `of` · `death` · `ending`: `title`
 * - `wait` the player is held: `r` (opening, unfolding, world, free, voice) · `waited` it ended: `r`, `ms`
 * - `stall` a beat or a world could not be written: `why`, `opening` · `unstall`: `how` (retry, giveUp)
 * - `req` a paid request began: `id`, `kind` (model, voice, fal, music), `model`, `label`, `n` (beat)
 * - `res` it ended: `id`, `ms`, `ok`, `err`, `usd`
 * - `stage` something the start waits for arrived (`devlog.ts`'s stages): `s`, `ms` since the start
 * - `show` the scene was handed an asset: `id`, `what`, `name` · `shown` it stands: `id`, `ms`, `ok`
 * - `voice` a line was heard: `who`, `lag` (text on screen → sound), `fetch`, `cached`
 * - `pos` the hero: `x`, `z` · `idle` input came back after `ms` without any
 * - `hide` / `back` the page hidden and shown again · `error` · `cap` the recording stopped
 */
export const KINDS = [
  'open',
  'screen',
  'world',
  'quest',
  'beat',
  'line',
  'choice',
  'free',
  'progress',
  'death',
  'ending',
  'wait',
  'waited',
  'stall',
  'unstall',
  'req',
  'res',
  'stage',
  'show',
  'shown',
  'voice',
  'pos',
  'idle',
  'hide',
  'back',
  'error',
  'cap',
] as const;
export type ReplayKind = (typeof KINDS)[number];

/** A session's figures, kept on its record so the list needs no events. */
export interface ReplaySummary {
  /** Ms from the first event to the last. */
  ms: number;
  /** Ms with the page visible. */
  activeMs: number;
  events: number;
  worlds: number;
  quests: number;
  /** The furthest beat reached, 1-based (0: none). */
  beats: number;
  choices: number;
  /** Ms the player was held waiting, and the longest single wait. */
  waitMs: number;
  longestWaitMs: number;
  stalls: number;
  errors: number;
  /** Ms between an asset being asked for and it standing in the scene, the longest. */
  longestAssetMs: number;
  ended: boolean;
  /** Where the session was when it was last heard of: a screen, or `game`. */
  last: string;
}

export const EMPTY_SUMMARY: ReplaySummary = {
  ms: 0,
  activeMs: 0,
  events: 0,
  worlds: 0,
  quests: 0,
  beats: 0,
  choices: 0,
  waitMs: 0,
  longestWaitMs: 0,
  stalls: 0,
  errors: 0,
  longestAssetMs: 0,
  ended: false,
  last: '',
};

/** Who and what a session was, as the list shows it. */
export interface ReplayMeta {
  id: string;
  startedAt: number;
  lastAt: number;
  /** The signed-in account (verified by the server), or null for a guest. */
  uid: string | null;
  /** The account's e-mail, filled in for the admin when the list is read; never stored. */
  email?: string | null;
  /** The browser's guest id (`demo.ts`): the same browser across sessions. */
  guest: string | null;
  lang: string;
  host: string;
  mobile: boolean;
  chunks: number;
  summary: ReplaySummary;
}

export interface ReplaysPage {
  sessions: ReplayMeta[];
  from: number;
  to: number;
}

export interface ReplayDetail {
  meta: ReplayMeta;
  events: ReplayEvent[];
}

export const ADMIN_REPLAYS_PATH = '/admin/replays';
export const ADMIN_REPLAY_PATH = '/admin/replay';

/*
 * Keys look like these: Google's `AIza…`, OpenAI's `sk-…`, fal's `uuid:hex`, ElevenLabs' 32+ hex,
 * a bearer token, a JWT, and `key=`/`token=` in a URL. Anything of the kind becomes `[…]`.
 */
const KEYISH = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{12,}/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{16,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\b(?:Bearer|Key)\s+[A-Za-z0-9._:-]{12,}/gi,
  /\b[0-9a-f]{32,}\b/gi,
];

const KEY_PARAM = /([?&](?:key|token|api_key|apikey|auth|signature|sig)=)[^&\s"']+/gi;

/** A string with anything shaped like a key taken out, cut to `max`. */
export function redact(text: string, max: number = REPLAY_LIMITS.text): string {
  let out = text.replace(KEY_PARAM, '$1[…]');
  for (const re of KEYISH) out = out.replace(re, '[…]');
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

const KIND_SET = new Set<string>(KINDS);
const FIELD = /^[a-zA-Z]{1,12}$/;

/** One event as far as it can be trusted, or null. */
export function cleanEvent(raw: unknown): ReplayEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.t !== 'number' || !Number.isFinite(r.t) || r.t < 0 || r.t > 7 * 86_400_000) return null;
  if (typeof r.k !== 'string' || !KIND_SET.has(r.k)) return null;
  const event: ReplayEvent = { t: Math.round(r.t), k: r.k };
  let fields = 0;
  for (const [name, value] of Object.entries(r)) {
    if (name === 't' || name === 'k') continue;
    if (!FIELD.test(name) || fields >= REPLAY_LIMITS.fields) continue;
    if (typeof value === 'string') event[name] = redact(value);
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      event[name] = Math.round(value * 1e4) / 1e4;
    } else if (typeof value === 'boolean' || value === null) event[name] = value;
    else continue;
    fields += 1;
  }
  return event;
}

/** A chunk's events, cleaned and cut to the limits; what does not fit is dropped from the end. */
export function cleanEvents(raw: unknown): ReplayEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplayEvent[] = [];
  let bytes = 2;
  for (const item of raw.slice(0, REPLAY_LIMITS.chunkEvents)) {
    const e = cleanEvent(item);
    if (!e) continue;
    const size = JSON.stringify(e).length + 1;
    if (bytes + size > REPLAY_LIMITS.chunkBytes) break;
    bytes += size;
    out.push(e);
  }
  return out;
}

/** A summary as far as it can be trusted: every number clamped, the rest by type. */
export function cleanSummary(raw: unknown): ReplaySummary {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : 0);
  const DAY = 86_400_000;
  return {
    ms: n(r.ms, 7 * DAY),
    activeMs: n(r.activeMs, 7 * DAY),
    events: n(r.events, REPLAY_LIMITS.sessionEvents + 10),
    worlds: n(r.worlds, 1000),
    quests: n(r.quests, 1000),
    beats: n(r.beats, 1000),
    choices: n(r.choices, 100_000),
    waitMs: n(r.waitMs, 7 * DAY),
    longestWaitMs: n(r.longestWaitMs, 7 * DAY),
    stalls: n(r.stalls, 10_000),
    errors: n(r.errors, 100_000),
    longestAssetMs: n(r.longestAssetMs, 7 * DAY),
    ended: r.ended === true,
    last: typeof r.last === 'string' ? redact(r.last, 40) : '',
  };
}

/** The session-wide facts the first chunk carries. */
export interface ReplayOpen {
  lang: string;
  host: string;
  mobile: boolean;
  guest: string | null;
}

export function cleanOpen(raw: unknown): ReplayOpen {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const word = (v: unknown, max: number) => (typeof v === 'string' ? redact(v, max).replace(/[^\w.:-]/g, '') : '');
  return {
    lang: word(r.lang, 8),
    host: word(r.host, 64),
    mobile: r.mobile === true,
    guest: typeof r.guest === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(r.guest) ? r.guest : null,
  };
}
