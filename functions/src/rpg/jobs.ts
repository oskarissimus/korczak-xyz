/*
 * The RPG's generation, run here so it outlives the page (owner, 28 Oct 2026: "when I switch apps
 * on the phone the quest stops generating; the server should do it and I should come back to it
 * finished — the same with the world"). The why and the shape of a job are in
 * `korczak-xyz/src/utils/rpg/jobs.ts`; this is the runner.
 *
 * A job is a document the browser writes under `users/{uid}/rpgJobs/{id}` with `status: 'queued'`.
 * `rpgJob` (index.ts) fires on the write, claims it in a transaction (so a second delivery of the
 * same event does nothing), and does what it says on the account's own keys from
 * `users/{uid}/keys/config` — never the owner's, never a secret of ours:
 *
 * - `llm`: the models in order, streamed, each answer checked with the game's own parser
 *   (`parseBeat`, `parseWorlds`, `parseHubSizes`, compiled in from the site), moving on as the browser
 *   does — a 404, 429, 503, a 400 naming the model, a stall or a timeout, or an unplayable answer.
 *   The answer so far, the tail of the thoughts and each finished try are written back at most once
 *   a second, which is what the developer console and the progress bar read.
 * - `fal`: FLUX.1 [schnell] draws, TRELLIS (through fal's queue) models; a picture alone for the
 *   ground and the cover.
 *
 * A world born with `pieces` creates its hub's jobs at once (`worldPieceJobs`), which fire this
 * function in turn: the village is being built while the phone is in a pocket.
 */

import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { db } from '../runtime';
import { keysFrom } from '../../../korczak-xyz/src/utils/accountKeys/keys';
import { parseBeat, type BeatContext } from '../../../korczak-xyz/src/utils/rpg/quest';
import {
  askedFor,
  parseHubSizes,
  parseWorlds,
  pickWorld,
  typicalityTarget,
  type GenesisContext,
} from '../../../korczak-xyz/src/utils/rpg/genesis';
import { FAL_IMAGE_MODEL, FAL_MESH_MODEL, FAL_PRICES, imageCost } from '../../../korczak-xyz/src/utils/rpg/falPrompts';
import {
  JOB_BUDGET_MS,
  JOBS,
  KEEP_MS,
  MODEL_MS,
  STALL_MS,
  textRandom,
  worldPieceJobs,
  type FalProgress,
  type FalSpec,
  type JobCurrent,
  type JobDoc,
  type JobTry,
  type LlmSpec,
} from '../../../korczak-xyz/src/utils/rpg/jobs';

/** How often a running job writes its progress at most. Firestore's own guidance is a write a second per document. */
const FLUSH_MS = 1000;
const THOUGHTS_KEPT = 4000;

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

/** The job's document, written no more than once a second unless a step ends. */
class Progress {
  private pending: Record<string, unknown> = {};
  private last = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly ref: DocumentReference) {}

  set(fields: Record<string, unknown>, now = false): Promise<void> {
    Object.assign(this.pending, fields);
    if (now) return this.flush();
    if (!this.timer) {
      const wait = Math.max(0, this.last + FLUSH_MS - Date.now());
      this.timer = setTimeout(() => void this.flush(), wait);
    }
    return Promise.resolve();
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const fields = this.pending;
    this.pending = {};
    this.last = Date.now();
    if (Object.keys(fields).length === 0) return this.chain.then(() => undefined);
    this.chain = this.chain.then(() => this.ref.update({ ...fields, heartbeat: Date.now() })).catch((e) => console.warn('rpgJob write', e));
    return this.chain.then(() => undefined);
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

/** Reads a server-sent event stream, every `data:` payload parsed; resets the stall timer on each chunk. */
async function readEvents(response: Response, kick: () => void, onData: (data: any) => void): Promise<void> {
  if (!response.body) {
    for (const line of (await response.text()).split('\n')) handleLine(line, onData);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    kick();
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, newline), onData);
      buffer = buffer.slice(newline + 1);
    }
  }
  handleLine(buffer, onData);
}

function handleLine(line: string, onData: (data: any) => void): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return;
  let data: unknown;
  try {
    data = JSON.parse(trimmed.slice(5));
  } catch {
    return;
  }
  onData(data);
}

/** One model's turn, streamed into `current`. */
async function askModel(spec: LlmSpec, key: string, model: string, current: JobCurrent, onChange: () => void): Promise<string> {
  const controller = new AbortController();
  let reason: string | null = null;
  const fire = (why: string) => {
    reason = why;
    controller.abort();
  };
  let stall: ReturnType<typeof setTimeout> = setTimeout(() => fire(`no answer for ${STALL_MS / 1000}s`), STALL_MS);
  const kick = () => {
    clearTimeout(stall);
    stall = setTimeout(() => fire(`no answer for ${STALL_MS / 1000}s`), STALL_MS);
  };
  const cap = setTimeout(() => fire(`still writing after ${MODEL_MS / 1000}s`), MODEL_MS);
  const started = Date.now();
  const first = () => {
    if (current.firstMs === null) current.firstMs = Date.now() - started;
  };
  try {
    if (spec.provider === 'google') {
      const gemma = model.startsWith('gemma');
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: spec.prompt }] }],
            generationConfig: {
              temperature: spec.temperature,
              maxOutputTokens: 16384,
              ...(gemma
                ? {}
                : {
                    responseMimeType: 'application/json',
                    thinkingConfig: { includeThoughts: true, ...(spec.thinking ? { thinkingLevel: spec.thinking } : {}) },
                  }),
            },
          }),
        },
      );
      if (!response.ok) throw new ProviderError(await errorText(response), response.status);
      let why: string | null = null;
      await readEvents(response, kick, (data) => {
        if (data?.error) throw new ProviderError(data.error.message ?? 'stream error', data.error.code ?? null);
        if (data?.modelVersion && !current.servedBy) current.servedBy = data.modelVersion;
        const candidate = data?.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (typeof part?.text !== 'string') continue;
          first();
          if (part.thought === true) current.thoughts = (current.thoughts + part.text).slice(-THOUGHTS_KEPT);
          else current.text += part.text;
        }
        const u = data?.usageMetadata;
        if (u) current.usage = { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0 };
        why = candidate?.finishReason ?? data?.promptFeedback?.blockReason ?? why;
        onChange();
      });
      if (!current.text) throw new ProviderError(`empty answer (${why ?? 'no candidates'})`, response.status);
      return current.text;
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: Math.min(spec.temperature, 1.2),
        response_format: { type: 'json_object' },
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: spec.prompt }],
      }),
    });
    if (!response.ok) throw new ProviderError(await errorText(response), response.status);
    await readEvents(response, kick, (data) => {
      if (data?.model && !current.servedBy) current.servedBy = data.model;
      const delta = data?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        first();
        current.text += delta;
      }
      const u = data?.usage;
      if (u) current.usage = { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, thoughts: 0 };
      onChange();
    });
    if (!current.text) throw new ProviderError('empty answer', response.status);
    return current.text;
  } catch (e) {
    if (reason && e instanceof Error && e.name === 'AbortError') throw new ProviderError(reason, null, true);
    throw e;
  } finally {
    clearTimeout(stall);
    clearTimeout(cap);
  }
}

/** The same rule as the browser's `tryNext`: what is worth the next model. */
function tryNext(e: unknown): boolean {
  if (e instanceof TypeError) return true; // the connection went
  if (!(e instanceof ProviderError)) return false;
  return (
    e.timedOut ||
    e.status === 404 ||
    e.status === 429 ||
    e.status === 500 ||
    e.status === 503 ||
    (e.status === 400 && /model|not (found|supported|available)/i.test(e.message))
  );
}

function describe(e: unknown): string {
  if (e instanceof ProviderError) return e.status ? `${e.status}: ${e.message}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Whether the answer is one the game can play, and for a world the world it will be. */
export function check(spec: LlmSpec, raw: string, at: number): { ok: boolean; world: ReturnType<typeof pickWorld> } {
  const ctx = JSON.parse(spec.ctx);
  if (spec.parse === 'beat') return { ok: parseBeat(raw, ctx as BeatContext) !== null, world: null };
  if (spec.parse === 'sizes') return { ok: parseHubSizes(raw) !== null, world: null };
  const g = ctx as GenesisContext;
  const world = pickWorld(parseWorlds(raw, g, at), typicalityTarget(g.exotic, askedFor(g)), () => textRandom(raw));
  return { ok: world !== null, world };
}

async function runLlm(uid: string, ref: DocumentReference, spec: LlmSpec, keys: ReturnType<typeof keysFrom>): Promise<void> {
  const key = spec.provider === 'google' ? keys.google : keys.openai;
  const progress = new Progress(ref);
  if (!key) {
    await progress.set({ status: 'failed', noKey: true, error: `no ${spec.provider} key on the account`, finishedAt: Date.now() }, true);
    return;
  }
  const started = Date.now();
  const tries: JobTry[] = [];
  let outcome: 'unusable' | 'failed' = 'failed';
  let error: string | null = null;
  for (const model of spec.models) {
    if (Date.now() - started > JOB_BUDGET_MS) {
      error = error ?? 'out of time';
      break;
    }
    const at = Date.now();
    const current: JobCurrent = { model, at, firstMs: null, text: '', thoughts: '', usage: null, servedBy: null };
    await progress.set({ current }, true);
    const record = (status: number | null, err: string | null) =>
      tries.push({ model, at, status, ms: Date.now() - at, firstMs: current.firstMs, error: err, usage: current.usage, servedBy: current.servedBy });
    try {
      const raw = await askModel(spec, key, model, current, () => void progress.set({ current }));
      const { ok, world } = check(spec, raw, at);
      const unplayable = ok ? null : `the answer was not ${spec.parse === 'sizes' ? 'a set of sizes' : `a playable ${spec.parse}`}`;
      record(200, unplayable);
      if (ok) {
        await progress.set(
          { status: 'done', outcome: 'generated', raw, model, at, tries, current: null, error: null, finishedAt: Date.now(), 'spec.ctx': FieldValue.delete() },
          true,
        );
        if (world && spec.pieces && keys.fal) await startPieces(uid, world);
        return;
      }
      outcome = 'unusable';
      error = unplayable;
      await progress.set({ tries, current: null }, true);
    } catch (e) {
      record(e instanceof ProviderError ? e.status : null, describe(e));
      if (outcome !== 'unusable') error = describe(e);
      await progress.set({ tries, current: null }, true);
      if (!tryNext(e)) break;
    }
  }
  await progress.set({ status: 'failed', outcome, error, tries, current: null, finishedAt: Date.now(), 'spec.ctx': FieldValue.delete() }, true);
}

/** The hub's and forest's pieces of a world just born; one already asked for by the browser is left as it is. */
async function startPieces(uid: string, world: NonNullable<ReturnType<typeof pickWorld>>): Promise<void> {
  const now = Date.now();
  await Promise.all(
    worldPieceJobs(world).map(({ id, spec }) =>
      db
        .doc(`users/${uid}/${JOBS}/${id}`)
        .create(fresh(spec, now))
        .catch(() => undefined),
    ),
  );
}

/** A new job's document, as the browser writes it too. */
export function fresh(spec: JobDoc['spec'], now: number): Record<string, unknown> {
  return {
    spec,
    status: 'queued',
    createdAt: now,
    heartbeat: null,
    finishedAt: null,
    error: null,
    expireAt: Timestamp.fromMillis(now + KEEP_MS),
  };
}

function falHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
    'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: null }),
  };
}

async function falFailure(res: Response): Promise<Error> {
  const detail = (await res.text().catch(() => '')).slice(0, 300);
  return new Error(`${res.status}${detail ? ` ${detail}` : ''}`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runFal(ref: DocumentReference, spec: FalSpec, key: string | null): Promise<void> {
  const progress = new Progress(ref);
  if (!key) {
    await progress.set({ status: 'failed', noKey: true, error: 'no fal.ai key on the account', finishedAt: Date.now() }, true);
    return;
  }
  const started = Date.now();
  const fal: FalProgress = { image: { url: null, ms: null, error: null, retry: null }, mesh: null };
  let cost = 0;
  try {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`https://fal.run/${FAL_IMAGE_MODEL}`, {
        method: 'POST',
        headers: falHeaders(key),
        body: JSON.stringify({
          prompt: spec.prompt,
          image_size: { width: spec.size, height: spec.size },
          num_inference_steps: 4,
          num_images: 1,
          enable_safety_checker: true,
        }),
      });
      if (res.status !== 429 || attempt >= 5) break;
      fal.image.retry = `429, fal.ai at its limit: again in ${2 ** attempt} s`;
      await progress.set({ fal }, true);
      await sleep(1000 * 2 ** attempt);
    }
    if (!res.ok) throw Object.assign(await falFailure(res), { step: 'image' });
    const image = ((await res.json()) as { images?: { url?: string }[] }).images?.[0]?.url;
    if (!image) throw Object.assign(new Error('no image in the answer'), { step: 'image' });
    cost += imageCost(spec.size, spec.size);
    fal.image = { url: image, ms: Date.now() - started, error: null, retry: null };
    if (spec.simplify === null) {
      const ms = Date.now() - started;
      await progress.set(
        { fal, status: 'done', result: { image, glb: null, costUsd: cost, ms, queuedMs: 0, at: Date.now() }, finishedAt: Date.now() },
        true,
      );
      return;
    }
    const meshStart = Date.now();
    fal.mesh = { state: 'queued', position: null, glb: null, kb: null, queuedMs: null, ms: null, error: null };
    await progress.set({ fal }, true);
    const submit = await fetch(`https://queue.fal.run/${FAL_MESH_MODEL}`, {
      method: 'POST',
      headers: falHeaders(key),
      body: JSON.stringify({ image_url: image, texture_size: 512, mesh_simplify: spec.simplify }),
    });
    if (!submit.ok) throw await falFailure(submit);
    const queued = (await submit.json()) as { status_url?: string; response_url?: string };
    if (!queued.status_url || !queued.response_url) throw new Error('the queue gave no request to follow');
    const auth = { Authorization: `Key ${key}` };
    const deadline = meshStart + 400_000;
    for (;;) {
      await sleep(2000);
      if (Date.now() > deadline) throw new Error('timed out in the queue');
      const r = await fetch(queued.status_url, { headers: auth });
      if (!r.ok) throw await falFailure(r);
      const s = (await r.json()) as { status?: string; queue_position?: number };
      if (s.status === 'IN_QUEUE') {
        fal.mesh.position = s.queue_position ?? null;
      } else {
        if (fal.mesh.queuedMs === null) fal.mesh.queuedMs = Date.now() - meshStart;
        fal.mesh.state = 'running';
      }
      await progress.set({ fal });
      if (s.status === 'COMPLETED') break;
    }
    const r = await fetch(queued.response_url, { headers: auth });
    if (!r.ok) throw await falFailure(r);
    const body = (await r.json()) as { model_mesh?: { url?: string; file_size?: number } };
    const glb = body.model_mesh?.url;
    if (!glb) throw new Error('no model in the answer');
    cost += FAL_PRICES.mesh;
    const queuedMs = fal.mesh.queuedMs ?? 0;
    fal.mesh = {
      ...fal.mesh,
      state: 'done',
      glb,
      kb: body.model_mesh?.file_size ? Math.round(body.model_mesh.file_size / 1024) : null,
      ms: Date.now() - meshStart,
    };
    await progress.set(
      { fal, status: 'done', result: { image, glb, costUsd: cost, ms: Date.now() - started, queuedMs, at: Date.now() }, finishedAt: Date.now() },
      true,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if ((e as { step?: string }).step === 'image' || !fal.mesh) fal.image.error = message;
    else fal.mesh.error = message;
    await progress.set({ fal, status: 'failed', error: message, costUsd: cost, finishedAt: Date.now() }, true);
  }
}

/** Claims a queued job and runs it. A job not queued, or claimed by another delivery, is left alone. */
export async function runJob(uid: string, jobId: string): Promise<void> {
  const ref = db.doc(`users/${uid}/${JOBS}/${jobId}`);
  const job = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = snap.data() as JobDoc | undefined;
    if (!doc || doc.status !== 'queued') return null;
    tx.update(ref, { status: 'running', heartbeat: Date.now() });
    return doc;
  });
  if (!job) return;
  try {
    const keySnap = await db.doc(`users/${uid}/keys/config`).get();
    const keys = keysFrom(keySnap.exists ? keySnap.data() : {});
    if (job.spec.kind === 'llm') await runLlm(uid, ref, job.spec, keys);
    else await runFal(ref, job.spec, keys.fal);
  } catch (e) {
    await ref.update({ status: 'failed', crashed: true, error: describe(e), finishedAt: Date.now(), heartbeat: Date.now() }).catch(() => undefined);
    throw e;
  }
}
