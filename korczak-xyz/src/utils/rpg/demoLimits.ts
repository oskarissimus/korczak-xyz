/*
 * The RPG's demo: somebody with no account and no key plays on the owner's keys, Google for the
 * story and ElevenLabs for the voices, within a budget in dollars (owner, Oct 2026: "at most $4 per
 * user per day, and $10 a day across everybody, so I do not go broke").
 *
 * COMPILED TWICE, like `utils/backseat/demoLimits.ts` and for the same reason: the function
 * (`functions/src/rpg/handler.ts`) decides from these, and the game reads the same numbers. Nothing
 * here may import the DOM, Firebase or React — only `quest.ts`, `place.ts`, `genesis.ts` and
 * `cost.ts`, which import nothing else either.
 *
 * DOLLARS, NOT CALLS. A beat on Pro costs ten times one on Flash-Lite, and a clip costs by its
 * length, so a count of calls would be either too strict for one or too loose for the other. Each
 * call RESERVES its worst case before it is made (`beatReservation`: the whole prompt in, the whole
 * output budget out, at the model's price) and is settled at what the usage says it cost. So the
 * caps cannot be passed, only approached: a beat that stops short is refunded, a stream cut before
 * its usage arrived keeps the reservation.
 *
 * THE PROMPT IS BUILT BY THE FUNCTION, from a context checked field by field (`demoContext`), the
 * same rule the roaster's demo keeps. The context still carries text the game wrote earlier — the
 * story so far, the chronicle — so every string is cut to the length the game itself would send
 * and every list to its size; what is left is a few kilobytes of story, with the answer parsed as a
 * beat before the game uses it, and a budget in dollars behind it.
 */

import { tokenPrice, voiceCreditsPerChar, USD_PER_VOICE_CREDIT } from './cost';
import { demoWorld } from './genesis';
import { parsePlace } from './place';
import { parsePersona } from './persona';
import { HEARD_MAX, parseMood, SITUATION_MAX, type BeatContext, type Meeting, type Character, type ChronicleEntry, type Job, type Lang, type StepRecord } from './quest';

/** The Google models the demo may be asked for: the game's picker, less what is not Google. */
export const DEMO_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-4-argon',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemma-4-31b-it',
] as const;

/**
 * The aliases and the names Google answers under another version, priced as what answered them in
 * Oct 2026 (`modelVersion`), so a reservation can be made before the answer says.
 */
const PRICED_AS: Record<string, string> = {
  'gemini-flash-latest': 'gemini-3.8-flash',
  'gemini-flash-lite-latest': 'gemini-3.5-flash-lite',
  'gemini-3.5-flash': 'gemini-3.6-flash',
};

export function priceAs(model: string): string {
  return PRICED_AS[model] ?? model;
}

/** The voices a demo clip may be spoken in (`voice.ts`'s three). */
export const DEMO_VOICES = {
  male: 'JBFqnCBsd6RMkjVDRZzb',
  female: '21m00Tcm4TlvDq8ikWAM',
  player: 'nPczCjzI2devNBz1zQrb',
} as const;

export type DemoVoice = keyof typeof DEMO_VOICES;

/** The longest line the game speaks is under 280 characters; a little room over that. */
export const MAX_CLIP_CHARS = 400;

/** The output budget the game asks every model for, and so the worst case a beat can cost. */
export const MAX_OUTPUT_TOKENS = 16384;

export interface RpgDemoSettings {
  /** The demo's master switch, shared with the roaster's. */
  enabled: boolean;
  /** Whose keys pay: the same account the roaster's demo is paid by. */
  keyUid: string;
  /** The RPG's own switch, `apps.rpg` in the same document. */
  on: boolean;
  /** Dollars per address per Warsaw day. */
  perIpUsd: number;
  /** Dollars per Warsaw day across everybody. */
  dailyUsd: number;
}

export const RPG_DEMO_DEFAULTS = { perIpUsd: 4, dailyUsd: 10 };
/** Above these the owner is not configuring a demo, he is donating. */
export const MAX_PER_IP_USD = 20;
export const MAX_DAILY_USD = 50;

function usd(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, value));
}

/** The RPG's part of `demo/config`. A missing field is the default, never `undefined`. */
export function normalizeRpgDemo(value: unknown): RpgDemoSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const apps = (typeof raw.apps === 'object' && raw.apps !== null ? raw.apps : {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled !== false,
    keyUid: typeof raw.keyUid === 'string' ? raw.keyUid.trim() : '',
    on: apps.rpg !== false,
    perIpUsd: usd(raw.rpgPerIpUsd, RPG_DEMO_DEFAULTS.perIpUsd, MAX_PER_IP_USD),
    dailyUsd: usd(raw.rpgDailyUsd, RPG_DEMO_DEFAULTS.dailyUsd, MAX_DAILY_USD),
  };
}

export type RpgDemoReason = 'disabled' | 'no-key' | 'app-off' | 'ip-cap' | 'all-cap';

export type RpgDemoVerdict = { ok: true } | { ok: false; reason: RpgDemoReason; status: number };

/**
 * Whether a call that may cost up to `cost` dollars fits. `spent` is what is already claimed
 * today, reservations included. A refusal for the budget is 402, not 429: a 429 is what Google
 * says about a model's own quota, which the game answers by asking the next model.
 */
export function checkRpgDemo(
  settings: RpgDemoSettings,
  spent: { ip: number; all: number },
  cost: number,
): RpgDemoVerdict {
  if (!settings.enabled) return { ok: false, reason: 'disabled', status: 503 };
  if (!settings.keyUid) return { ok: false, reason: 'no-key', status: 503 };
  if (!settings.on) return { ok: false, reason: 'app-off', status: 503 };
  if (spent.ip + cost > settings.perIpUsd) return { ok: false, reason: 'ip-cap', status: 402 };
  if (spent.all + cost > settings.dailyUsd) return { ok: false, reason: 'all-cap', status: 402 };
  return { ok: true };
}

export function remainingUsd(settings: RpgDemoSettings, spent: { ip: number; all: number }) {
  return {
    ip: Math.max(0, settings.perIpUsd - spent.ip),
    all: Math.max(0, settings.dailyUsd - spent.all),
  };
}

/**
 * The most a beat can cost: every character of the prompt as a token (a token is three or four
 * characters, so this is generous) and the whole output budget, thinking included, at the model's
 * price. A model with no price here is not on offer at all — the function refuses it.
 */
export function beatReservation(model: string, promptChars: number): number | null {
  const price = tokenPrice(priceAs(model));
  if (!price) return null;
  return (promptChars * price.input + MAX_OUTPUT_TOKENS * price.output) / 1_000_000;
}

/** A clip's cost is known before it is made: its length, at the list rate of its model (`cost.ts`). */
export function clipCost(chars: number, model = 'eleven_flash_v2_5'): number {
  return chars * voiceCreditsPerChar(model) * USD_PER_VOICE_CREDIT;
}

class BadContext extends Error {}
export { BadContext };

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function job(value: unknown): Job | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const kind = r.kind === 'collect' || r.kind === 'slay' || r.kind === 'talk' ? r.kind : null;
  if (!kind) return null;
  const count = Number(r.count);
  return { kind, count: Number.isFinite(count) ? Math.min(5, Math.max(0, Math.round(count))) : 1 };
}

function step(value: unknown): StepRecord {
  const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    npcName: text(r.npcName, 60),
    placeName: typeof r.placeName === 'string' ? r.placeName.slice(0, 60) : null,
    situation: text(r.situation, SITUATION_MAX),
    chose: text(r.chose, 160),
    consequence: text(r.consequence, 300),
    ...(text(r.done, 120) && { done: text(r.done, 120) }),
    ...(text(r.heard, HEARD_MAX) && { heard: text(r.heard, HEARD_MAX) }),
    ...(text(r.witnessName, 60) && { witnessName: text(r.witnessName, 60) }),
    ...(meet(r.meet) && { meet: meet(r.meet)! }),
  };
}

function meet(value: unknown): Meeting | null {
  const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const who = text(r.who, 160);
  if (!who) return null;
  const name = text(r.name, 60);
  return name ? { name, who } : { who };
}

function list<T>(value: unknown, max: number, each: (v: unknown) => T): T[] {
  return Array.isArray(value) ? value.slice(-max).map(each) : [];
}

/**
 * A stranger's JSON, turned into a context `beatPrompt` can be given: closed values checked, every
 * string cut to what the game itself sends (`decide` cuts a situation to `SITUATION_MAX`), every list to the
 * size the game keeps (four beats, the chronicle's last five, the atlas's sixteen places).
 */
export function demoContext(value: unknown): BeatContext {
  const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const lang: Lang = r.lang === 'pl' ? 'pl' : 'en';
  const index = Number(r.index);
  if (!Number.isInteger(index) || index < 0 || index > 3) throw new BadContext('Bad beat index');
  const plan = Array.isArray(r.plan) ? r.plan.slice(0, 3).map(job) : [];
  if (plan.length < 2) throw new BadContext('Bad plan');
  const chronicle: ChronicleEntry[] = list(r.chronicle, 5, (v) => {
    const e = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { title: text(e.title, 120), at: 0, steps: list(e.steps, 4, step), ending: text(e.ending, 400) };
  });
  const characters: Character[] = list(r.characters, 30, (v): Character => {
    const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return {
      name: text(c.name, 60),
      gender: c.gender === 'female' ? 'female' : 'male',
      color: typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#666666',
      // Told back to the model so someone who returns keeps their manner (`quest.ts`).
      ...(text(c.voice, 300) && { voice: text(c.voice, 300) }),
      ...(parsePersona(c.persona) && { persona: parsePersona(c.persona)! }),
    };
  }).filter((c) => c.name);
  return {
    lang,
    index,
    seed: text(r.seed, 100),
    job: index === 0 ? null : job(r.job),
    plan,
    title: typeof r.title === 'string' ? r.title.slice(0, 120) : null,
    history: list(r.history, 4, step),
    chronicle,
    places: list(r.places, 16, parsePlace).filter((p): p is NonNullable<typeof p> => p !== null),
    characters,
    world: demoWorld(r.world),
    dead: list(r.dead, 40, (v) => text(v, 60)).filter(Boolean),
    ...(parseMood(r.mood) && { mood: parseMood(r.mood)! }),
    ...(personas(r.personas) && { personas: personas(r.personas)! }),
  };
}

/** The beat's drawn personas, both of them or neither. */
function personas(value: unknown): BeatContext['personas'] | null {
  const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const npc = parsePersona(r.npc);
  const witness = parsePersona(r.witness);
  return npc && witness ? { npc, witness } : null;
}
