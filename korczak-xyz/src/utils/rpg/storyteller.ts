/*
 * Asks a model for one beat of a quest (`quest.ts`), with the reader's own key from the account store (see
 * `.claude/rules/account-keys.md`), straight from the browser like every other app here.
 *
 * Google first, OpenAI only without a Google key. On Google the models are tried in order
 * (`modelChain`: the one chosen on the intro screen, then `GOOGLE_MODELS`), strongest first, in
 * JSON mode, because availability is per project (see `backseat.md`, the demo's "no longer
 * available to new users"); then Gemma, which has no JSON mode. A model that is not on offer (404,
 * a 400 naming the model), out of quota (429), overloaded (503), silent or too slow moves to the
 * next; anything else, a rejected key above all, ends the attempt.
 *
 * Every answer is streamed, thought summaries included, into the developer console's record
 * (`devlog.ts`), with its tokens and approximate cost, so a slow beat can be watched being written
 * rather than waited out.
 *
 * Every call comes back as a `StoryAttempt` — the prompt, each model tried, the raw answer, the
 * error — whether it worked or not, so the caller can record it (`questLog.ts`). The first version
 * returned null on any failure and logged a breadcrumb nobody could read, and the only symptom was
 * the hand-written quest, every time.
 */

import { beatPrompt, parseBeat, type Beat, type BeatContext, type Job } from './quest';
import { appendText, endRequest, startRequest, updateRequest, type DevRequest } from './devlog';
import type { Usage } from './cost';

// The strongest first (owner, Oct 2026: "the better model first, and a fallback; we will move to a
// cheaper one when we optimise for cost"). Flash-Lite, first until then, wrote briefings and slid
// into third-person narration where a line should be spoken. Named versions rather than the
// `-latest` aliases where one exists, so the console says which model wrote a beat; the aliases are
// still on the picker. `gemma-3-27b-it` was withdrawn (404) in Oct 2026.
export const GOOGLE_MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemma-4-31b-it',
];
export const OPENAI_MODEL = 'gpt-4.1';

/**
 * What the intro screen offers (owner, Oct 2026: "choose the model at the start, to try the
 * variants"). The chosen one is asked first and the usual order follows it as the fallback.
 */
export const MODEL_CHOICES: { id: string; provider: 'google' | 'openai' }[] = [
  ...[
    'gemini-3.1-pro-preview',
    'gemini-4-argon',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemma-4-31b-it',
  ].map((id) => ({ id, provider: 'google' as const })),
  { id: OPENAI_MODEL, provider: 'openai' },
];

/*
 * Two limits per model, and moving on when either runs out. Pro thinks before it writes: in Oct 2026
 * its first token took 3–40s on a one-line prompt, and a whole beat could pass the old single 90s
 * limit for the whole attempt — which then ended it, with no Flash asked at all, and the reader
 * staring at "the fates are deciding" for a minute and a half. Now the stream shows it working, a
 * model silent for `STALL_MS` is given up on, and so is one still going after `MODEL_MS`.
 */
const STALL_MS = 60_000;
const MODEL_MS = 180_000;

export interface StoryKeys {
  google: string | null;
  openai: string | null;
}

export type QuestSource = 'google' | 'openai' | 'static';

export type StoryOutcome = 'generated' | 'no-key' | 'unusable' | 'failed';

export interface ModelTry {
  model: string;
  status: number | null;
  ms: number;
  /** Until the first byte of the answer, thinking included. */
  firstMs: number | null;
  error: string | null;
  usage: Usage | null;
  /** Dollars, approximately (`cost.ts`); null when the model has no price there. */
  cost: number | null;
}

export interface StoryAttempt {
  outcome: StoryOutcome;
  provider: QuestSource;
  /** The model whose answer was used, or the last one tried. */
  model: string | null;
  seed: string;
  /** Which beat of the quest; 0 is the opening. */
  index: number;
  /** What this beat asks of the hunter, and what each decision leads to: the game's, not the model's. */
  job: Job | null;
  plan: (Job | null)[];
  prompt: string;
  tries: ModelTry[];
  /** What the model sent back, whole. Null when nothing answered. */
  raw: string | null;
  error: string | null;
  ms: number;
  beat: Beat | null;
}

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

async function errorText(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || body.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

/**
 * One model's turn: its own abort, a watchdog that `kick` resets on every byte, and the reason it
 * fired. Any abort comes out of the request as a `ProviderError` marked `timedOut`.
 */
class Watchdog {
  readonly controller = new AbortController();
  reason: string | null = null;
  private stall: ReturnType<typeof setTimeout> | null = null;
  private cap: ReturnType<typeof setTimeout>;

  constructor() {
    this.cap = setTimeout(() => this.fire(`still writing after ${MODEL_MS / 1000}s`), MODEL_MS);
    this.kick();
  }

  kick() {
    if (this.stall) clearTimeout(this.stall);
    this.stall = setTimeout(() => this.fire(`no answer for ${STALL_MS / 1000}s`), STALL_MS);
  }

  private fire(reason: string) {
    this.reason = reason;
    this.controller.abort();
  }

  done() {
    if (this.stall) clearTimeout(this.stall);
    clearTimeout(this.cap);
  }

  /** Rethrows an abort as the timeout it was. */
  wrap(e: unknown): unknown {
    if (this.reason && e instanceof Error && e.name === 'AbortError') return new ProviderError(this.reason, null, true);
    return e;
  }
}

/**
 * Reads a server-sent event stream, handing each `data:` payload over parsed. Both providers stream
 * this way; a line that is not JSON (OpenAI's closing `[DONE]`) is skipped.
 */
async function readEvents(response: Response, dog: Watchdog, onData: (data: any) => void): Promise<void> {
  // A body that turns out not to be a stream at all (a proxy that buffered it, a test double) is one
  // JSON payload, read whole at the end.
  let raw = '';
  let events = 0;
  const line = (text: string) => {
    if (handleLine(text, onData)) events += 1;
  };
  if (!response.body) {
    raw = await response.text();
    raw.split('\n').forEach(line);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      dog.kick();
      const text = decoder.decode(value, { stream: true });
      if (events === 0 && raw.length < 1_000_000) raw += text;
      buffer += text;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    line(buffer);
  }
  if (events > 0) return;
  try {
    onData(JSON.parse(raw));
  } catch {
    /* nothing usable; the caller reports the empty answer */
  }
}

/** True when the line was an event; an error inside one is the caller's to throw. */
function handleLine(line: string, onData: (data: any) => void): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return false;
  let data: unknown;
  try {
    data = JSON.parse(trimmed.slice(5));
  } catch {
    return false; // `[DONE]`, or a keep-alive
  }
  onData(data);
  return true;
}

async function askGoogle(key: string, model: string, prompt: string, dog: Watchdog, entry: DevRequest): Promise<string> {
  const gemma = model.startsWith('gemma');
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: dog.controller.signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1,
        // Room for thinking as well as the answer: a thinking model counts both against this,
        // and a quest in Polish is ~1500 tokens on its own.
        maxOutputTokens: 16384,
        // The thought summaries are what the console shows while Pro is still deciding.
        ...(gemma ? {} : { responseMimeType: 'application/json', thinkingConfig: { includeThoughts: true } }),
      },
    }),
  });
  if (!response.ok) throw new ProviderError(await errorText(response), response.status);
  let text = '';
  let why: string | null = null;
  await readEvents(response, dog, (data) => {
    if (data?.error) throw new ProviderError(data.error.message ?? 'stream error', data.error.code ?? null);
    if (data?.modelVersion && !entry.servedBy) updateRequest(entry, { servedBy: data.modelVersion });
    const candidate = data?.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text !== 'string') continue;
      appendText(entry, part.text, part.thought === true);
      if (!part.thought) text += part.text;
    }
    const u = data?.usageMetadata;
    if (u) {
      updateRequest(entry, {
        usage: { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0 },
      });
    }
    why = candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? why;
  });
  if (!text) throw new ProviderError(`empty answer (${why ?? 'no candidates'})`, response.status);
  return text;
}

async function askOpenAi(key: string, prompt: string, dog: Watchdog, entry: DevRequest): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: dog.controller.signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 1,
      response_format: { type: 'json_object' },
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new ProviderError(await errorText(response), response.status);
  let text = '';
  await readEvents(response, dog, (data) => {
    if (data?.model && !entry.servedBy) updateRequest(entry, { servedBy: data.model });
    const delta = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.message?.content;
    if (typeof delta === 'string') {
      text += delta;
      appendText(entry, delta, false);
    }
    const u = data?.usage;
    if (u) updateRequest(entry, { usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, thoughts: 0 } });
  });
  return text;
}

/**
 * Worth asking the next model: this key cannot use this one (404, a 400 naming the model), its
 * quota for it is spent (429 — quotas are per model on AI Studio, so Gemma may still answer), it is
 * overloaded (503), or it went quiet or ran too long.
 */
function tryNext(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false;
  return (
    e.timedOut ||
    e.status === 404 ||
    e.status === 429 ||
    e.status === 503 ||
    (e.status === 400 && /model|not (found|supported|available)/i.test(e.message))
  );
}

function describe(e: unknown): string {
  if (e instanceof ProviderError) return e.status ? `${e.status}: ${e.message}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

/** The order to ask in: the chosen model first, then the usual order for that provider. */
export function modelChain(provider: 'google' | 'openai', chosen: string | null): string[] {
  const usual = provider === 'google' ? GOOGLE_MODELS : [OPENAI_MODEL];
  const pick = MODEL_CHOICES.find((m) => m.id === chosen && m.provider === provider);
  return pick ? [pick.id, ...usual.filter((m) => m !== pick.id)] : usual;
}

export async function generateBeat(keys: StoryKeys, ctx: BeatContext, chosen: string | null = null): Promise<StoryAttempt> {
  const started = Date.now();
  const prompt = beatPrompt(ctx);
  const provider: QuestSource = keys.google ? 'google' : keys.openai ? 'openai' : 'static';
  const attempt: StoryAttempt = {
    outcome: 'no-key',
    provider,
    model: null,
    seed: ctx.seed,
    index: ctx.index,
    job: ctx.job,
    plan: ctx.plan,
    prompt,
    tries: [],
    raw: null,
    error: null,
    ms: 0,
    beat: null,
  };
  if (provider === 'static') return attempt;

  for (const model of modelChain(provider, chosen)) {
    const t0 = Date.now();
    attempt.model = model;
    const entry = startRequest('model', model, ctx.index);
    const dog = new Watchdog();
    const record = (status: number | null, error: string | null) =>
      attempt.tries.push({ model, status, ms: Date.now() - t0, firstMs: entry.firstMs, error, usage: entry.usage, cost: entry.cost });
    try {
      try {
        attempt.raw =
          provider === 'google'
            ? await askGoogle(keys.google!, model, prompt, dog, entry)
            : await askOpenAi(keys.openai!, prompt, dog, entry);
      } catch (e) {
        throw dog.wrap(e);
      } finally {
        dog.done();
      }
      attempt.beat = parseBeat(attempt.raw, ctx);
      const unplayable = attempt.beat ? null : 'the answer was not a playable beat';
      endRequest(entry, unplayable);
      record(200, unplayable);
      if (attempt.beat) break;
      // An unplayable answer from one model is worth one from the next.
      attempt.outcome = 'unusable';
      attempt.error = unplayable;
    } catch (e) {
      endRequest(entry, describe(e));
      record(e instanceof ProviderError ? e.status : null, describe(e));
      if (attempt.outcome !== 'unusable') {
        attempt.outcome = 'failed';
        attempt.error = describe(e);
      }
      if (!tryNext(e)) break;
    }
  }

  attempt.ms = Date.now() - started;
  if (attempt.beat) {
    attempt.outcome = 'generated';
    attempt.error = null;
  }
  return attempt;
}
