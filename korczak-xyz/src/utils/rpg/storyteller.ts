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
 * With no key of the reader's own, the demo (`demo.ts`) when it is open: the same Google models,
 * asked through our function on the owner's key, inside a budget in dollars. Its stream is Google's
 * own, read by the same code. A demo cap reached moves to the next, cheaper model, which may still
 * fit what is left; the demo switched off ends the attempt.
 *
 * Every call comes back as a `StoryAttempt` — the prompt, each model tried, the raw answer, the
 * error — whether it worked or not, so the caller can record it (`questLog.ts`). The first version
 * returned null on any failure and logged a breadcrumb nobody could read, and the only symptom was
 * the hand-written quest, every time.
 */

import { beatPrompt, parseBeat, type Beat, type BeatContext, type Job, type QuestMood } from './quest';
import {
  askedFor,
  genesisPrompt,
  genesisTemperature,
  hubSizesPrompt,
  parseHubSizes,
  parseWorlds,
  pickWorld,
  previewWorld,
  typicalityTarget,
  type GenesisContext,
  type HubSizes,
  type WorldBible,
} from './genesis';
import { appendText, endRequest, startRequest, updateRequest, type DevRequest } from './devlog';
import type { Usage } from './cost';
import { demoRefusal, rpgDemoUrl } from './demo';
import { DEMO_MODELS, type RpgDemoReason } from './demoLimits';
import { llmJobId, textRandom, type JobDoc, type JobParse, type LlmSpec } from './jobs';
import { jobsOn, runServerJob } from './serverJobs';

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
 * What writes the world and the quest's opening when the start should be quick (owner, 27 Oct 2026:
 * "about two minutes pass before the game is ready; maybe a faster model, maybe less thinking").
 * Measured that day on the same prompts: the genesis 72 s on Pro thinking as usual, 48 s on Pro
 * thinking little, 20 s on this one thinking little — and that was the old four-world answer; the
 * opening beat 45 s, 33 s and 10 s. The later beats keep the chosen model, written while the hero
 * walks and talks. `gemini-3.8-flash` writes as well but streamed at two thirds the speed that day.
 */
export const FAST_MODEL = 'gemini-3-flash-preview';

/** How hard a Gemini model thinks before it writes: `low` for what the reader is waiting on. */
export type { Thinking } from './jobs';
import type { Thinking } from './jobs';

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
  /** No key of the reader's own, and the demo is open: write on the owner's, through `demo.ts`. */
  demo?: boolean;
}

export type QuestSource = 'google' | 'openai' | 'demo' | 'static';

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
  /** The quest's tone and tie (`drawMood`), when it has one. */
  mood?: QuestMood;
  prompt: string;
  tries: ModelTry[];
  /** What the model sent back, whole. Null when nothing answered. */
  raw: string | null;
  error: string | null;
  ms: number;
  beat: Beat | null;
  /** Why the demo said no, when it did: a cap for the day or the demo switched off. */
  refusal: RpgDemoReason | null;
}

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly timedOut = false,
    readonly refusal: RpgDemoReason | null = null,
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

async function askGoogle(
  key: string,
  model: string,
  prompt: string,
  temperature: number,
  dog: Watchdog,
  entry: DevRequest,
  thinking?: Thinking,
  onText?: (soFar: string) => void,
): Promise<string> {
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
        temperature,
        // Room for thinking as well as the answer: a thinking model counts both against this,
        // and a quest in Polish is ~1500 tokens on its own.
        maxOutputTokens: 16384,
        // The thought summaries are what the console shows while Pro is still deciding.
        ...(gemma
          ? {}
          : { responseMimeType: 'application/json', thinkingConfig: { includeThoughts: true, ...(thinking ? { thinkingLevel: thinking } : {}) } }),
      },
    }),
  });
  if (!response.ok) throw new ProviderError(await errorText(response), response.status);
  return readGoogle(response, dog, entry, onText);
}

/**
 * The demo: the context goes to our function, which builds the same prompt and passes Google's
 * stream back byte for byte. A refusal of its own carries a `reason`; anything else is Google's.
 */
async function askDemo(
  model: string,
  body: DemoAsk,
  dog: Watchdog,
  entry: DevRequest,
  thinking?: Thinking,
  onText?: (soFar: string) => void,
): Promise<string> {
  const url = rpgDemoUrl();
  if (!url) throw new ProviderError('demo: no address', null, false, 'disabled');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: dog.controller.signal,
    body: JSON.stringify({ ...body, model, ...(thinking ? { thinking } : {}) }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* not JSON: Google's or a proxy's */
    }
    const refusal = demoRefusal(parsed);
    const message = (parsed as { error?: { message?: string } } | null)?.error?.message || body.slice(0, 500);
    throw new ProviderError(message, response.status, false, refusal);
  }
  return readGoogle(response, dog, entry, onText);
}

async function readGoogle(response: Response, dog: Watchdog, entry: DevRequest, onText?: (soFar: string) => void): Promise<string> {
  let text = '';
  let why: string | null = null;
  await readEvents(response, dog, (data) => {
    if (data?.error) throw new ProviderError(data.error.message ?? 'stream error', data.error.code ?? null);
    if (data?.modelVersion && !entry.servedBy) updateRequest(entry, { servedBy: data.modelVersion });
    const candidate = data?.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text !== 'string') continue;
      appendText(entry, part.text, part.thought === true);
      if (!part.thought) {
        text += part.text;
        onText?.(text);
      }
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

async function askOpenAi(
  key: string,
  prompt: string,
  temperature: number,
  dog: Watchdog,
  entry: DevRequest,
  onText?: (soFar: string) => void,
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: dog.controller.signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      // OpenAI's scale is the same 0–2, but it turns to noise sooner than Gemini's.
      temperature: Math.min(temperature, 1.2),
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
      onText?.(text);
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
  if (dropped(e)) return true;
  if (!(e instanceof ProviderError)) return false;
  // A cap is a dollar amount, and the next model in the chain is cheaper and may still fit it.
  if (e.refusal) return e.refusal === 'ip-cap' || e.refusal === 'all-cap';
  return (
    e.timedOut ||
    e.status === 404 ||
    e.status === 429 ||
    e.status === 503 ||
    (e.status === 400 && /model|not (found|supported|available)/i.test(e.message))
  );
}

/**
 * The connection itself went: Safari's "Load failed", Chrome's "Failed to fetch", a stream cut off
 * mid-answer. On a phone that is a lost signal or a locked screen, not the model refusing, so it is
 * worth the next model (owner, Oct 2026: a Pro beat on LTE ended the quest with "Load failed" and
 * no second try). A TypeError with any other message is a bug and still ends it.
 */
export function dropped(e: unknown): boolean {
  return e instanceof TypeError && /load failed|failed to fetch|network|connection|terminated/i.test(e.message);
}

/** How many times an attempt asks a model again after the background cut it, before moving on. */
const BACKGROUND_RETRIES = 3;

/** Resolves once the page is in view: iOS cuts a hidden page's requests, so asking then is wasted. */
function whenVisible(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const seen = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', seen);
      resolve();
    };
    document.addEventListener('visibilitychange', seen);
  });
}

function describe(e: unknown): string {
  if (e instanceof ProviderError) return e.status ? `${e.status}: ${e.message}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

/**
 * The order to ask in: the chosen model first, then the usual order for that provider. The demo is
 * Google's list, less anything the function does not offer.
 */
export function modelChain(provider: 'google' | 'openai' | 'demo', chosen: string | null): string[] {
  if (provider === 'demo') return modelChain('google', chosen).filter((m) => (DEMO_MODELS as readonly string[]).includes(m));
  const usual = provider === 'google' ? GOOGLE_MODELS : [OPENAI_MODEL];
  const pick = MODEL_CHOICES.find((m) => m.id === chosen && m.provider === provider);
  return pick ? [pick.id, ...usual.filter((m) => m !== pick.id)] : usual;
}

/** What the demo's function is asked for: a beat or a world, by the context it builds the prompt from. */
type DemoAsk = { kind: 'beat'; ctx: BeatContext } | { kind: 'world'; ctx: GenesisContext };

interface Ask<T> {
  prompt: string;
  temperature: number;
  /** What the demo's function is sent; none when the demo has nothing to answer it with. */
  demo: DemoAsk | null;
  /** The answer as the game can use it, or null when it cannot. */
  parse: (raw: string) => T | null;
  /** Which beat, for the console; null for a world. */
  beat: number | null;
  /** A word or two on what was asked, for the console's headline (a beat's tone and tie). */
  label?: string;
  /** What an unusable answer was not, for the console: a beat or a world unless said. */
  what?: string;
  /** Asked before the chain, when the reader is waiting on the answer (`FAST_MODEL`). */
  first?: string;
  /** How hard a Gemini model thinks; its own default when absent. */
  thinking?: Thinking;
  /** The answer so far, each time it grows. */
  onText?: (soFar: string) => void;
  /** Each model's turn begins, the first and every retry, at this time (the server's, for a job). */
  onTry?: (at: number) => void;
  /** What the server checks the answer with when it asks instead (`serverJobs.ts`). */
  job: { parse: JobParse; ctx: unknown; pieces?: boolean };
}

interface Asked<T> {
  outcome: StoryOutcome;
  provider: QuestSource;
  model: string | null;
  tries: ModelTry[];
  raw: string | null;
  error: string | null;
  ms: number;
  value: T | null;
  refusal: RpgDemoReason | null;
}

/**
 * Asks the chain of models, in order, until one answers with something `parse` can use. Every model
 * tried is recorded with its status and error; see the top of the file for what moves on and what
 * ends the attempt.
 */
async function askChain<T>(keys: StoryKeys, chosen: string | null, ask: Ask<T>): Promise<Asked<T>> {
  const started = Date.now();
  const provider: QuestSource = keys.google ? 'google' : keys.openai ? 'openai' : keys.demo ? 'demo' : 'static';
  const run: Asked<T> = { outcome: 'no-key', provider, model: null, tries: [], raw: null, error: null, ms: 0, value: null, refusal: null };
  if (provider === 'static' || (provider === 'demo' && !ask.demo)) return run;

  const chain = modelChain(provider, chosen);
  const first = ask.first && provider !== 'openai' && (provider !== 'demo' || (DEMO_MODELS as readonly string[]).includes(ask.first)) ? ask.first : null;
  const models = first ? [first, ...chain.filter((m) => m !== first)] : chain;

  // Signed in with the keys on the account: the server asks, and keeps asking with the phone in a
  // pocket (`jobs.ts`). Null is anything that means the browser should ask itself after all.
  if (provider !== 'demo' && jobsOn()) {
    const served = await askServer(provider, models, ask, run);
    if (served) {
      served.ms = Date.now() - started;
      return served;
    }
  }

  // A request the page's going to the background killed is not the model's fault: it is asked
  // again, the same model, once the page is back (owner, Oct 2026: on a phone, a new world asked for
  // and the app put in the background was simply gone on return). `hidden` notes that the page was
  // hidden at some point during the try, which is what makes a timeout or a cut one of those.
  let hidden = false;
  const onHide = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') hidden = true;
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
  let again = 0;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    // Nothing is asked while the page is hidden: iOS cuts it, so it would only be wasted.
    await whenVisible();
    hidden = false;
    const t0 = Date.now();
    run.model = model;
    const entry = startRequest('model', model, ask.beat, '', ask.label);
    const dog = new Watchdog();
    ask.onTry?.(t0);
    const record = (status: number | null, error: string | null) =>
      run.tries.push({ model, status, ms: Date.now() - t0, firstMs: entry.firstMs, error, usage: entry.usage, cost: entry.cost });
    try {
      try {
        run.raw =
          provider === 'google'
            ? await askGoogle(keys.google!, model, ask.prompt, ask.temperature, dog, entry, ask.thinking, ask.onText)
            : provider === 'demo'
              ? await askDemo(model, ask.demo!, dog, entry, ask.thinking, ask.onText)
              : await askOpenAi(keys.openai!, ask.prompt, ask.temperature, dog, entry, ask.onText);
      } catch (e) {
        throw dog.wrap(e);
      } finally {
        dog.done();
      }
      run.value = ask.parse(run.raw);
      const unplayable = run.value ? null : `the answer was not ${ask.what ?? `a playable ${ask.beat === null ? 'world' : 'beat'}`}`;
      endRequest(entry, unplayable);
      record(200, unplayable);
      if (run.value) break;
      // An unplayable answer from one model is worth one from the next.
      run.outcome = 'unusable';
      run.error = unplayable;
    } catch (e) {
      endRequest(entry, describe(e));
      record(e instanceof ProviderError ? e.status : null, describe(e));
      if (e instanceof ProviderError && e.refusal) run.refusal = e.refusal;
      if (run.outcome !== 'unusable') {
        run.outcome = 'failed';
        run.error = describe(e);
      }
      const background = hidden && (dropped(e) || (e instanceof ProviderError && e.timedOut));
      if (background && again < BACKGROUND_RETRIES) {
        again += 1;
        i -= 1;
        continue;
      }
      if (!tryNext(e)) break;
    }
  }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);

  run.ms = Date.now() - started;
  if (run.value) {
    run.outcome = 'generated';
    run.error = null;
    run.refusal = null;
  }
  return run;
}

/**
 * The chain asked by the server instead (`serverJobs.ts`): the same models in the same order, its
 * stream mirrored into the console a request per model's turn, and the answer parsed here as well
 * as there. Null when the browser should ask itself after all.
 */
async function askServer<T>(provider: 'google' | 'openai', models: string[], ask: Ask<T>, run: Asked<T>): Promise<Asked<T> | null> {
  const base = { kind: 'llm' as const, provider, models, prompt: ask.prompt, temperature: ask.temperature, thinking: ask.thinking ?? null, parse: ask.job.parse };
  const spec: LlmSpec = { ...base, ctx: JSON.stringify(ask.job.ctx ?? null), pieces: ask.job.pieces ?? false };
  // One console request per model's turn, by when the turn began.
  const entries = new Map<number, { entry: DevRequest; text: number; thoughts: string; ended: boolean }>();
  const turn = (model: string, at: number) => {
    let t = entries.get(at);
    if (!t) {
      const entry = startRequest('model', model, ask.beat, '', ask.label);
      updateRequest(entry, { startedAt: at, server: true });
      t = { entry, text: 0, thoughts: '', ended: false };
      entries.set(at, t);
      ask.onTry?.(at);
    }
    return t;
  };
  const job = await runServerJob(llmJobId(base), spec, (doc: JobDoc) => {
    for (const tr of doc.tries ?? []) {
      const t = turn(tr.model, tr.at);
      if (t.ended) continue;
      t.ended = true;
      updateRequest(t.entry, { servedBy: tr.servedBy ?? t.entry.servedBy, usage: tr.usage });
      endRequest(t.entry, tr.error);
      updateRequest(t.entry, { ms: tr.ms, firstMs: tr.firstMs });
    }
    const c = doc.current;
    if (!c) return;
    const t = turn(c.model, c.at);
    if (t.ended) return;
    if (c.text.length > t.text) {
      appendText(t.entry, c.text.slice(t.text), false);
      t.text = c.text.length;
      ask.onText?.(c.text);
    }
    if (c.thoughts !== t.thoughts) {
      // The server keeps only the thoughts' tail: the new part is what follows the old tail's end.
      const tail = t.thoughts.slice(-200);
      const at = tail ? c.thoughts.lastIndexOf(tail) : -1;
      appendText(t.entry, at >= 0 ? c.thoughts.slice(at + tail.length) : c.thoughts, true);
      t.thoughts = c.thoughts;
    }
    updateRequest(t.entry, { servedBy: c.servedBy ?? t.entry.servedBy, usage: c.usage ?? t.entry.usage, firstMs: c.firstMs });
  });
  if (!job) {
    // The browser asks after all: whatever the server had begun is not this attempt's.
    for (const t of entries.values()) if (!t.ended) endRequest(t.entry, 'handed back to the browser');
    return null;
  }
  for (const t of entries.values()) if (!t.ended) endRequest(t.entry, job.error ?? null);
  run.tries = (job.tries ?? []).map((tr) => ({
    model: tr.model,
    status: tr.status,
    ms: tr.ms,
    firstMs: tr.firstMs,
    error: tr.error,
    usage: tr.usage,
    cost: entries.get(tr.at)?.entry.cost ?? null,
  }));
  run.model = job.model ?? job.tries?.at(-1)?.model ?? null;
  run.raw = job.raw ?? null;
  if (job.status === 'done' && job.raw) {
    if (job.at) ask.onTry?.(job.at);
    run.value = ask.parse(job.raw);
  }
  if (run.value) {
    run.outcome = 'generated';
    run.error = null;
  } else {
    run.outcome = job.outcome === 'unusable' || job.status === 'done' ? 'unusable' : 'failed';
    run.error = job.error ?? (job.status === 'done' ? `the answer was not ${ask.what ?? 'playable'}` : 'failed on the server');
  }
  return run;
}

/** How a request the reader is waiting on is asked: a faster model first, thinking little. */
export interface Quick {
  first?: string;
  thinking?: Thinking;
}

/** `fast` is the quick start (`FAST_MODEL`, thinking little); off, the chosen model as usual. */
export function quick(fast: boolean): Quick {
  return fast ? { first: FAST_MODEL, thinking: 'low' } : {};
}

export async function generateBeat(keys: StoryKeys, ctx: BeatContext, chosen: string | null = null, how: Quick = {}): Promise<StoryAttempt> {
  const prompt = beatPrompt(ctx);
  const run = await askChain(keys, chosen, {
    ...how,
    prompt,
    temperature: 1,
    demo: { kind: 'beat', ctx },
    parse: (raw) => parseBeat(raw, ctx),
    beat: ctx.index,
    ...(ctx.mood && { label: `${ctx.mood.tone} · ${ctx.mood.tie}` }),
    job: { parse: 'beat', ctx },
  });
  return {
    outcome: run.outcome,
    provider: run.provider,
    model: run.model,
    seed: ctx.seed,
    index: ctx.index,
    job: ctx.job,
    plan: ctx.plan,
    ...(ctx.mood && { mood: ctx.mood }),
    prompt,
    tries: run.tries,
    raw: run.raw,
    error: run.error,
    ms: run.ms,
    beat: run.value,
    refusal: run.refusal,
  };
}

export interface WorldAttempt extends Omit<Asked<WorldBible>, 'value'> {
  prompt: string;
  seeds: string[];
  /** Every playable candidate, the chosen one among them. */
  candidates: WorldBible[];
  world: WorldBible | null;
}

/**
 * A new world (`genesis.ts`): four candidates sketched in one answer and the one the game's rule
 * picks written out. Asked at `genesisTemperature`, through the same chain of models as a beat.
 * `onPreview` is told once per model's turn as soon as what the hub is made from has streamed
 * (`previewWorld`), under the id the finished world will have, so its models can start early.
 */
export async function generateWorld(
  keys: StoryKeys,
  ctx: GenesisContext,
  chosen: string | null = null,
  how: Quick = {},
  onPreview?: (world: WorldBible) => void,
): Promise<WorldAttempt> {
  const prompt = genesisPrompt(ctx);
  let candidates: WorldBible[] = [];
  // Minted per model's turn, so a world started from one model's stream is never another's.
  let now = Date.now();
  let previewed = false;
  const run = await askChain(keys, chosen, {
    ...how,
    prompt,
    temperature: genesisTemperature(ctx.exotic),
    demo: { kind: 'world', ctx },
    parse: (raw) => {
      candidates = parseWorlds(raw, ctx, now);
      return pickWorld(candidates, typicalityTarget(ctx.exotic, askedFor(ctx)), () => textRandom(raw));
    },
    beat: null,
    job: { parse: 'world', ctx, pieces: true },
    onTry: (at) => {
      now = at;
      previewed = false;
    },
    onText: onPreview
      ? (soFar) => {
          if (previewed) return;
          const world = previewWorld(soFar, ctx, now);
          if (!world) return;
          previewed = true;
          onPreview(world);
        }
      : undefined,
  });
  const { value, ...rest } = run;
  return { ...rest, prompt, seeds: ctx.seeds, candidates, world: value };
}

/**
 * How big the hub's pieces are, for a world described before genesis asked (`hubSizesPrompt`). A
 * short answer, asked once per world and kept on it; the demo's function builds only beats and
 * worlds, so on the demo a world keeps the slots' own sizes.
 */
export async function generateHubSizes(
  keys: StoryKeys,
  world: WorldBible,
  chosen: string | null = null,
): Promise<{ sizes: HubSizes | null; tries: ModelTry[]; ms: number }> {
  const run = await askChain(keys, chosen, {
    prompt: hubSizesPrompt(world),
    temperature: 0.2,
    demo: null,
    parse: parseHubSizes,
    beat: null,
    job: { parse: 'sizes', ctx: null },
    what: 'a set of sizes',
  });
  // The tries too: what they cost is the world's (`WorldBible.spent`).
  return { sizes: run.value, tries: run.tries, ms: run.ms };
}
