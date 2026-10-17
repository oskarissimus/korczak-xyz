/*
 * Asks a model for one beat of a quest (`quest.ts`), with the reader's own key from the account store (see
 * `.claude/rules/account-keys.md`), straight from the browser like every other app here.
 *
 * Google first, OpenAI only without a Google key. On Google the models are tried in order
 * (`GOOGLE_MODELS`): a Flash-Lite alias in JSON mode, because availability is per project (see
 * `backseat.md`, the demo's "no longer available to new users") and an alias follows whatever is
 * current; then Gemma, which has no JSON mode and no `systemInstruction`. A model that is not on
 * offer (404, a 400 naming the model) or out of quota (429) moves to the next; anything else ends
 * the attempt.
 *
 * Every call comes back as a `StoryAttempt` — the prompt, each model tried, the raw answer, the
 * error — whether it worked or not, so the caller can record it (`questLog.ts`). The first version
 * returned null on any failure and logged a breadcrumb nobody could read, and the only symptom was
 * the hand-written quest, every time.
 */

import { beatPrompt, parseBeat, type Beat, type BeatContext, type Job } from './quest';

// Flash before Flash-Lite since the beats (Oct 2026): Lite slid into third-person narration where
// a line should be spoken, and a beat is mostly written while the last answer is still being read.
export const GOOGLE_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemma-3-27b-it'];
export const OPENAI_MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 45_000;

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
  error: string | null;
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

async function askGoogle(key: string, model: string, prompt: string, signal: AbortSignal): Promise<string> {
  const gemma = model.startsWith('gemma');
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
    `:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1,
        // Room for thinking as well as the answer: a thinking model counts both against this,
        // and a quest in Polish is ~1500 tokens on its own.
        maxOutputTokens: 8192,
        ...(gemma ? {} : { responseMimeType: 'application/json' }),
      },
    }),
  });
  if (!response.ok) throw new ProviderError(await errorText(response), response.status);
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .filter((p: { thought?: boolean }) => !p?.thought)
        .map((p: { text?: string }) => p?.text ?? '')
        .join('')
    : '';
  if (!text) {
    const why = candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? 'no candidates';
    throw new ProviderError(`empty answer (${why})`, response.status);
  }
  return text;
}

async function askOpenAi(key: string, prompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new ProviderError(await errorText(response), response.status);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * Worth asking the next model: this key cannot use this one (404, a 400 naming the model), or its
 * quota for it is spent (429 — quotas are per model on AI Studio, so Gemma may still answer).
 */
function tryNext(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false;
  return (
    e.status === 404 ||
    e.status === 429 ||
    (e.status === 400 && /model|not (found|supported|available)/i.test(e.message))
  );
}

function describe(e: unknown): string {
  if (e instanceof ProviderError) return e.status ? `${e.status}: ${e.message}` : e.message;
  if (e instanceof DOMException && e.name === 'AbortError') return `timed out after ${TIMEOUT_MS / 1000}s`;
  return e instanceof Error ? e.message : String(e);
}

export async function generateBeat(keys: StoryKeys, ctx: BeatContext): Promise<StoryAttempt> {
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const models = provider === 'google' ? GOOGLE_MODELS : [OPENAI_MODEL];
  try {
    for (const model of models) {
      const t0 = Date.now();
      attempt.model = model;
      try {
        attempt.raw =
          provider === 'google'
            ? await askGoogle(keys.google!, model, prompt, controller.signal)
            : await askOpenAi(keys.openai!, prompt, controller.signal);
        attempt.beat = parseBeat(attempt.raw, ctx);
        attempt.tries.push({
          model,
          status: 200,
          ms: Date.now() - t0,
          error: attempt.beat ? null : 'the answer was not a playable beat',
        });
        if (attempt.beat) break;
        // An unplayable answer from one model is worth one from the next.
        attempt.outcome = 'unusable';
        attempt.error = 'the answer was not a playable beat';
      } catch (e) {
        attempt.tries.push({
          model,
          status: e instanceof ProviderError ? e.status : null,
          ms: Date.now() - t0,
          error: describe(e),
        });
        if (attempt.outcome !== 'unusable') {
          attempt.outcome = 'failed';
          attempt.error = describe(e);
        }
        if (!tryNext(e)) break;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  attempt.ms = Date.now() - started;
  if (attempt.beat) {
    attempt.outcome = 'generated';
    attempt.error = null;
  }
  return attempt;
}
