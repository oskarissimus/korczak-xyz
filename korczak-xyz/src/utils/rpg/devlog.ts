/*
 * The developer console's record (`~` in the game): every request this quest made — each model asked
 * for a beat, each ElevenLabs clip and each fal.ai step of the hub's models (`landmark3d.ts`) — with what streamed back so far, its error, its tokens and
 * what it cost. ElevenLabs' music (`music.ts`) is a kind of its own, priced apart from the voices. The game is in active development and the owner wants to watch it work (Oct 2026:
 * "show the tokens streaming, show the errors, the cost of the quest, and the total time it took").
 *
 * A module-level store rather than React state: the storyteller and the voice write to it from deep
 * inside a request, and the console subscribes. Cleared when a quest starts. This browser only;
 * the durable record of a beat is still `questLog.ts`.
 *
 * The closing screen's figures are the WHOLE quest and its world, not this sitting (owner, 27 Oct
 * 2026: "the summary counts only this session, not the assets made earlier in this quest on other
 * sittings, and not the world's generation"). Each request is the quest's or the world's (`scope`):
 * the genesis, the hub's sizes and the hub's 3D models are the world's, everything else the quest's.
 * The quest's spend so far rides in its autosave (`SavedGame.spent`) and is carried in here on
 * Continue (`beginQuestSpend`); the world's is kept on the world (`WorldBible.spent`, and each hub
 * model's `costUsd`) and read back from it (`worldSpend`).
 */

import type { ModelSpend, WorldBible } from './genesis';
import type { ModelTry } from './storyteller';
import { tokenCost, voiceCost, VOICE_CREDITS_PER_CHAR, type Usage } from './cost';
import { noteResult, providerOf } from './funds';
import { reportSpend } from './stats';

export type DevStatus = 'waiting' | 'streaming' | 'ok' | 'error';

/** Whose cost a request is: the quest's, or the world's, which every quest in it shares. */
export type SpendScope = 'quest' | 'world';

export interface DevRequest {
  id: number;
  kind: 'model' | 'voice' | 'fal' | 'music';
  /** The model asked for, or the voice, or the fal.ai endpoint. */
  model: string;
  /** The model that answered, when the provider says (`modelVersion`); what is priced. */
  servedBy: string | null;
  /** Which beat, for a model request. */
  beat: number | null;
  /** What a fal.ai step is making: `landmark`, `house`, `tree`… (`landmark3d.ts`). */
  label?: string;
  scope: SpendScope;
  startedAt: number;
  /** When the first byte of the answer came, ms after the start. */
  firstMs: number | null;
  ms: number | null;
  status: DevStatus;
  /** The answer so far; a voice clip's line. */
  text: string;
  /** The model's thought summaries so far, where it shares them. */
  thoughts: string;
  error: string | null;
  usage: Usage | null;
  /** Characters spoken and credits charged, for a clip; seconds composed, for music. */
  chars: number;
  credits: number;
  /** Dollars, approximately; null when the model has no price. */
  cost: number | null;
  /** Asked by the server's job runner rather than this browser (`serverJobs.ts`). */
  server?: boolean;
  /**
   * Dollars as the RPG's gateway priced it (`gateway.ts`) — what goes in the reader's ledger. When
   * it is known it is the cost shown and counted; the browser's own estimate is the fallback.
   */
  serverCost?: number | null;
}

export interface QuestTotals {
  /** Wall time spent generating beats, from asking until a beat came back or none did. */
  generationMs: number;
  modelCost: number;
  /** Some request was made with a model that has no price, so `modelCost` is a floor. */
  unpriced: boolean;
  tokens: Usage;
  voiceChars: number;
  voiceCredits: number;
  voiceCost: number;
  /** ElevenLabs' music (`music.ts`): seconds composed, credits, dollars — apart from the voices. */
  musicSeconds: number;
  musicCredits: number;
  musicCost: number;
  /** fal.ai, at its list prices: each hub model's picture and its 3D model. */
  falCost: number;
  /** 3D models fal.ai finished. */
  falModels: number;
  /** Pictures fal.ai painted for the ground and what grows on it (`groundTexture.ts`, `groundCover.ts`). */
  falTextures: number;
  requests: number;
  errors: number;
}

/** What a quest, or a world, has cost so far: the closing screen's figures. */
export interface Spend {
  /** Wall time spent generating. */
  ms: number;
  tokens: Usage;
  modelCost: number;
  /** Some request was made with a model that has no price, so `modelCost` is a floor. */
  unpriced: boolean;
  voiceChars: number;
  voiceCredits: number;
  voiceCost: number;
  /** ElevenLabs' music, apart from the voices; absent from a save before Oct 30 2026. */
  musicSeconds: number;
  musicCredits: number;
  musicCost: number;
  falCost: number;
  falModels: number;
  /** Pictures fal.ai painted for the ground and what grows on it (`groundTexture.ts`, `groundCover.ts`). */
  falTextures: number;
  /** Part of it was spent before it was recorded (a save, or a world, from before), so a floor. */
  partial?: boolean;
}

export const NO_SPEND: Spend = {
  ms: 0,
  tokens: { input: 0, output: 0, thoughts: 0 },
  modelCost: 0,
  unpriced: false,
  voiceChars: 0,
  voiceCredits: 0,
  voiceCost: 0,
  musicSeconds: 0,
  musicCredits: 0,
  musicCost: 0,
  falCost: 0,
  falModels: 0,
  falTextures: 0,
};

export function addSpend(a: Spend, b: Spend): Spend {
  return {
    ms: a.ms + b.ms,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output, thoughts: a.tokens.thoughts + b.tokens.thoughts },
    modelCost: a.modelCost + b.modelCost,
    unpriced: a.unpriced || b.unpriced,
    voiceChars: a.voiceChars + b.voiceChars,
    voiceCredits: a.voiceCredits + b.voiceCredits,
    voiceCost: a.voiceCost + b.voiceCost,
    musicSeconds: a.musicSeconds + b.musicSeconds,
    musicCredits: a.musicCredits + b.musicCredits,
    musicCost: a.musicCost + b.musicCost,
    falCost: a.falCost + b.falCost,
    falModels: a.falModels + b.falModels,
    falTextures: a.falTextures + b.falTextures,
    ...(a.partial || b.partial ? { partial: true } : {}),
  };
}

/** Everything in dollars, approximately. */
export function spendUsd(s: Spend): number {
  return s.modelCost + s.voiceCost + s.musicCost + s.falCost;
}

/** A saved spend as far as it can be trusted: a save edited by hand or from an older build. */
export function validSpend(raw: unknown): Spend | null {
  const s = raw as Spend | null;
  if (!s || typeof s !== 'object' || !s.tokens || typeof s.tokens !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    ms: n(s.ms),
    tokens: { input: n(s.tokens.input), output: n(s.tokens.output), thoughts: n(s.tokens.thoughts) },
    modelCost: n(s.modelCost),
    unpriced: s.unpriced === true,
    voiceChars: n(s.voiceChars),
    voiceCredits: n(s.voiceCredits),
    // From the credits, at today's rate: a save from before Oct 2026 kept the old Creator guess.
    voiceCost: voiceCost(n(s.voiceCredits)),
    musicSeconds: n(s.musicSeconds),
    musicCredits: n(s.musicCredits),
    musicCost: voiceCost(n(s.musicCredits)),
    falCost: n(s.falCost),
    falModels: n(s.falModels),
    falTextures: n(s.falTextures),
    ...(s.partial === true ? { partial: true } : {}),
  };
}

/** The model requests of one ask (`storyteller.ts`'s tries), to keep on a world. */
export function triesSpend(tries: readonly ModelTry[], ms: number): ModelSpend {
  const spend: ModelSpend = { ms, tokens: { input: 0, output: 0, thoughts: 0 }, modelCost: 0, unpriced: false };
  for (const t of tries) {
    if (!t.usage) continue;
    spend.tokens.input += t.usage.input;
    spend.tokens.output += t.usage.output;
    spend.tokens.thoughts += t.usage.thoughts;
    if (t.cost === null) spend.unpriced = true;
    else spend.modelCost += t.cost;
  }
  return spend;
}

/**
 * What a world has cost, from what is kept on it: its model requests (`spent`) and its hub's 3D
 * models, each with the price of its picture and its mesh, and its painted ground. A world with nothing to cost — the
 * classic one, which is written by hand and has no hub models — is null. A model that failed half
 * way is not kept, so its picture is missing here: a floor, like the rest.
 */
export function worldSpend(world: WorldBible | null): Spend | null {
  if (!world || world.createdAt === 0) return null;
  const models = [world.landmarkModel, ...Object.values(world.kitModels ?? {}), world.heroModel].filter((m) => m !== undefined);
  const textures = [...(world.groundTexture ? [world.groundTexture] : []), ...(world.coverSprites ?? [])];
  const s = world.spent;
  return {
    ...NO_SPEND,
    ms: s?.ms ?? 0,
    tokens: s ? { ...s.tokens } : { ...NO_SPEND.tokens },
    modelCost: s?.modelCost ?? 0,
    unpriced: s?.unpriced ?? false,
    falCost: [...models, ...textures].reduce(
      (sum, m) => sum + (Number.isFinite(m.costUsd) ? m.costUsd : 0),
      0,
    ),
    falModels: models.length,
    falTextures: textures.length,
    ...(s ? {} : { partial: true }),
  };
}

let requests: DevRequest[] = [];
let generationMs = 0;
/** The quest's spend in sittings before this one, its generation time in this one, and when it began here. */
let carried: Spend = NO_SPEND;
let questMs = 0;
let questSince = 0;
const endListeners = new Set<(entry: DevRequest) => void>();
let nextId = 1;
let version = 0;
const listeners = new Set<() => void>();
let scheduled = false;

/** Coalesced to one notification a frame: a stream can deliver dozens of chunks a second. */
function changed() {
  version += 1;
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    for (const l of listeners) l();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else queueMicrotask(run);
}

export function subscribeDevlog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function devlogVersion(): number {
  return version;
}

export function devRequests(): readonly DevRequest[] {
  return requests;
}

/** Told of every request as it ends, after it is priced: the game saves the quest's spend then. */
export function onRequestEnd(listener: (entry: DevRequest) => void): () => void {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}

/** The world's requests are the ones that make the world: its genesis, its sizes, its hub's models. */
export function scopeOf(kind: DevRequest['kind'], beat: number | null, label?: string): SpendScope {
  if (kind === 'model') return beat === null ? 'world' : 'quest';
  if (kind === 'fal') return label === 'clue' || label === 'place' || label === 'person' || label === 'enemy' || label === 'creature' ? 'quest' : 'world';
  return 'quest';
}

/** Keeps the console from growing without end over a long session of quests. */
const KEEP = 400;

export function startRequest(kind: DevRequest['kind'], model: string, beat: number | null, text = '', label?: string): DevRequest {
  const entry: DevRequest = {
    id: nextId++,
    kind,
    model,
    servedBy: null,
    beat,
    ...(label ? { label } : {}),
    scope: scopeOf(kind, beat, label),
    startedAt: Date.now(),
    firstMs: null,
    ms: null,
    status: 'waiting',
    text,
    thoughts: '',
    error: null,
    usage: null,
    chars: 0,
    credits: 0,
    cost: null,
  };
  requests = [...requests, entry].slice(-KEEP);
  changed();
  return entry;
}

/** Mutates the entry in place and tells the console. */
export function updateRequest(entry: DevRequest, patch: Partial<DevRequest>): void {
  Object.assign(entry, patch);
  if (entry.firstMs === null && (patch.text || patch.thoughts)) {
    entry.firstMs = Date.now() - entry.startedAt;
    if (entry.status === 'waiting') entry.status = 'streaming';
  }
  if (entry.kind === 'model' && entry.usage) entry.cost = tokenCost(entry.servedBy ?? entry.model, entry.usage);
  if (entry.kind === 'voice' || entry.kind === 'music') entry.cost = voiceCost(entry.credits);
  if (typeof entry.serverCost === 'number') entry.cost = entry.serverCost;
  requests = [...requests];
  changed();
}

export function appendText(entry: DevRequest, text: string, thought: boolean): void {
  if (!text) return;
  if (thought) updateRequest(entry, { thoughts: entry.thoughts + text });
  else updateRequest(entry, { text: entry.text + text });
}

export function endRequest(entry: DevRequest, error: string | null, patch: Partial<DevRequest> = {}): void {
  updateRequest(entry, { ...patch, ms: Date.now() - entry.startedAt, status: error ? 'error' : 'ok', error });
  // Today's spend for the whole site (`stats.ts`). An unpriced model counts as nothing, a floor.
  if (entry.kind === 'model' ? entry.usage !== null : entry.status === 'ok') reportSpend(entry.cost ?? 0);
  // An empty balance is said once, by provider (`funds.ts`); a paid answer says the money is back.
  // Only what was paid for clears it: the self-rig is a `fal` entry that never asks fal.ai.
  if (error !== null || (entry.cost ?? 0) > 0) noteResult(providerOf(entry.kind, entry.model), error);
  for (const l of endListeners) l(entry);
}

/** A clip's credits: ElevenLabs' own count where its response says, else the model's list rate. */
export function voiceCredits(chars: number, header: string | null, perChar = VOICE_CREDITS_PER_CHAR): number {
  const charged = header === null ? NaN : Number(header);
  return Number.isFinite(charged) ? charged : chars * perChar;
}

/** Time spent writing: a beat's is the quest's, the genesis's the world's (kept on it instead). */
export function addGenerationTime(ms: number, scope: SpendScope = 'quest'): void {
  generationMs += ms;
  if (scope === 'quest') questMs += ms;
  changed();
}

/**
 * A quest begins in this sitting: a new one from nothing, a continued one from what its save says
 * it cost before. Requests already running belong to whatever came before and are not counted.
 */
export function beginQuestSpend(before: Spend = NO_SPEND): void {
  carried = before;
  questMs = 0;
  questSince = Date.now();
  changed();
}

/** What this quest has cost, every sitting of it: what was carried in plus this one's own requests. */
export function questSpend(): Spend {
  const now: Spend = { ...NO_SPEND, tokens: { ...NO_SPEND.tokens }, ms: questMs };
  for (const r of requests) {
    if (r.scope !== 'quest' || r.startedAt < questSince) continue;
    if (r.kind === 'voice') {
      now.voiceChars += r.chars;
      now.voiceCredits += r.credits;
      now.voiceCost += r.cost ?? 0;
    } else if (r.kind === 'music') {
      if (r.status !== 'ok') continue;
      now.musicSeconds += r.chars;
      now.musicCredits += r.credits;
      now.musicCost += r.cost ?? 0;
    } else if (r.kind === 'fal') {
      now.falCost += r.cost ?? 0;
      if (r.status === 'ok' && r.model.includes('trellis')) now.falModels += 1;
      if (r.status === 'ok' && (r.label === 'ground' || r.label === 'cover')) now.falTextures += 1;
    } else if (r.usage) {
      now.tokens.input += r.usage.input;
      now.tokens.output += r.usage.output;
      now.tokens.thoughts += r.usage.thoughts;
      if (r.cost === null) now.unpriced = true;
      else now.modelCost += r.cost;
    }
  }
  return addSpend(carried, now);
}

/**
 * A new quest: the console starts empty and the totals at zero — but for a fal.ai step still
 * running, which belongs to the world rather than to any quest and would otherwise vanish mid-way.
 */
export function resetDevlog(): void {
  requests = requests.filter((r) => r.kind === 'fal' && (r.status === 'waiting' || r.status === 'streaming'));
  generationMs = 0;
  changed();
}

export function questTotals(): QuestTotals {
  const totals: QuestTotals = {
    generationMs,
    modelCost: 0,
    unpriced: false,
    tokens: { input: 0, output: 0, thoughts: 0 },
    voiceChars: 0,
    voiceCredits: 0,
    voiceCost: 0,
    musicSeconds: 0,
    musicCredits: 0,
    musicCost: 0,
    falCost: 0,
    falModels: 0,
    falTextures: 0,
    requests: requests.length,
    errors: 0,
  };
  for (const r of requests) {
    if (r.status === 'error') totals.errors += 1;
    if (r.kind === 'voice') {
      totals.voiceChars += r.chars;
      totals.voiceCredits += r.credits;
      totals.voiceCost += r.cost ?? 0;
      continue;
    }
    if (r.kind === 'music') {
      if (r.status !== 'ok') continue;
      totals.musicSeconds += r.chars;
      totals.musicCredits += r.credits;
      totals.musicCost += r.cost ?? 0;
      continue;
    }
    if (r.kind === 'fal') {
      totals.falCost += r.cost ?? 0;
      if (r.status === 'ok' && r.model.includes('trellis')) totals.falModels += 1;
      if (r.status === 'ok' && (r.label === 'ground' || r.label === 'cover')) totals.falTextures += 1;
      continue;
    }
    if (r.usage) {
      totals.tokens.input += r.usage.input;
      totals.tokens.output += r.usage.output;
      totals.tokens.thoughts += r.usage.thoughts;
      if (r.cost === null) totals.unpriced = true;
      else totals.modelCost += r.cost;
    }
  }
  return totals;
}

/*
 * Where the start's time goes (owner, 27 Oct 2026: "about two minutes pass before the game is ready"):
 * from the click that starts a world or a quest, when each thing the reader waits for arrived. The
 * console's Start tab shows these beside every request made since, by when it began, first answered
 * and ended, so a slow start says which step it was slow in.
 */

/** What the start waits for, in the order it usually comes. */
export const STAGES = ['assets', 'world', 'quest', 'ground', 'cover', 'landmark', 'firstModel', 'hub', 'all'] as const;
export type Stage = (typeof STAGES)[number];

let timelineSince: number | null = null;
let timelineWhat: 'world' | 'quest' = 'world';
let stages: Partial<Record<Stage, number>> = {};

/** The start begins now: a new world, or a new quest in this one. */
export function beginTimeline(what: 'world' | 'quest'): void {
  timelineSince = Date.now();
  timelineWhat = what;
  stages = {};
  changed();
}

/** `stage` arrived, the first time only since the start began. */
export function markStage(stage: Stage): void {
  if (timelineSince === null || stages[stage] !== undefined) return;
  stages[stage] = Date.now() - timelineSince;
  changed();
}

export function timeline(): { since: number; what: 'world' | 'quest'; stages: Partial<Record<Stage, number>> } | null {
  return timelineSince === null ? null : { since: timelineSince, what: timelineWhat, stages };
}
