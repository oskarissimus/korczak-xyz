/*
 * The developer console's record (`~` in the game): every request this quest made — each model asked
 * for a beat and each ElevenLabs clip — with what streamed back so far, its error, its tokens and
 * what it cost. The game is in active development and the owner wants to watch it work (Oct 2026:
 * "show the tokens streaming, show the errors, the cost of the quest, and the total time it took").
 *
 * A module-level store rather than React state: the storyteller and the voice write to it from deep
 * inside a request, and the console subscribes. Cleared when a quest starts. This browser only;
 * the durable record of a beat is still `questLog.ts`.
 */

import { tokenCost, voiceCost, VOICE_CREDITS_PER_CHAR, type Usage } from './cost';

export type DevStatus = 'waiting' | 'streaming' | 'ok' | 'error';

export interface DevRequest {
  id: number;
  kind: 'model' | 'voice';
  /** The model asked for, or the voice. */
  model: string;
  /** The model that answered, when the provider says (`modelVersion`); what is priced. */
  servedBy: string | null;
  /** Which beat, for a model request. */
  beat: number | null;
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
  /** Characters spoken and credits charged, for a clip. */
  chars: number;
  credits: number;
  /** Dollars, approximately; null when the model has no price. */
  cost: number | null;
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
  requests: number;
  errors: number;
}

let requests: DevRequest[] = [];
let generationMs = 0;
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

/** Keeps the console from growing without end over a long session of quests. */
const KEEP = 400;

export function startRequest(kind: DevRequest['kind'], model: string, beat: number | null, text = ''): DevRequest {
  const entry: DevRequest = {
    id: nextId++,
    kind,
    model,
    servedBy: null,
    beat,
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
  if (entry.kind === 'voice') entry.cost = voiceCost(entry.credits);
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
}

/** A clip's credits: ElevenLabs' own count where its response says, else the list rate. */
export function voiceCredits(chars: number, header: string | null): number {
  const charged = header === null ? NaN : Number(header);
  return Number.isFinite(charged) ? charged : chars * VOICE_CREDITS_PER_CHAR;
}

export function addGenerationTime(ms: number): void {
  generationMs += ms;
  changed();
}

/** A new quest: the console starts empty and the totals at zero. */
export function resetDevlog(): void {
  requests = [];
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
