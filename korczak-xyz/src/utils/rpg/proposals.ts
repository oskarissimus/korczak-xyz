/*
 * The menu's four proposed worlds (owner, 2 Nov 2026: "the player opens the game and has four
 * proposed worlds generated for them — not whole worlds with a bible and assets, only proposals a
 * world can be generated from — each with a cover picture, and under them the menu as it is, where
 * you can still type your own idea"). The words and the reader are `proposalScript.ts`; this asks
 * for them, draws the covers and keeps the set.
 *
 * - **Cheap and quick.** The same model as the intro's narration (`INTRO_MODELS`: Flash-Lite with no
 *   thinking, ~1 s to the first token, a fraction of a cent for all four), streamed, so each card
 *   appears as its lines end; each cover is FLUX schnell at 768×432 ($0.003), started the moment its
 *   proposal's `I:` line is whole. Without a fal.ai key a card is its two colours.
 * - **Made once, kept until used.** The set is kept per language in localStorage `rpg-proposals` and
 *   shown again on every visit to the menu; picking one marks the set used (`pickedProposal`), and the
 *   next visit draws four new ones, unlike every world played so far (`pastWorlds`). ↻ draws a new
 *   set at once. The covers' URLs are the gateway's bucket copies (`assetStore.ts`), so they last.
 * - **Everything is in the `~` console**: the requests are labelled `proposals` (the model's stream,
 *   its errors, tokens and cost; each cover with its price), and `ProposalStats` heads the Start tab
 *   with this set's model, times and totals, kept here because a new world clears the request list.
 *   Sentry Logs `rpg.proposals` has the times and how it ended, never the words.
 *
 * Only on the reader's own Google key: the demo builds every prompt on its server, and this is not
 * one of them.
 */

import { apiFetch, serverCost } from './gateway';
import { endRequest, startRequest, type DevRequest } from './devlog';
import { streamGoogleText } from './storyteller';
import { FAL_IMAGE_MODEL, imageCost } from './falPrompts';
import { outOfFunds } from './funds';
import { drawWords } from './seedWords';
import { pastWorlds } from './worldSave';
import { rpgSet } from './storage';
import { INTRO_MODELS, PICTURE_SIZE } from './intro';
import {
  coverPrompt,
  parseProposals,
  PROPOSAL_COUNT,
  PROPOSAL_KINDS,
  proposalPrompt,
  validProposal,
  type Proposal,
} from './proposalScript';
import type { Lang } from './quest';
import { recordMeasurement } from '../../lib/sentry';

export const PROPOSALS_KEY = 'rpg-proposals';
export const PROPOSAL_LABEL = 'proposals';

export interface ProposalsView {
  lang: Lang | null;
  items: Proposal[];
  /** The proposals are being written (the covers may still be drawing after). */
  writing: boolean;
  /** Covers still being drawn. */
  drawing: number;
  model: string | null;
  /** When this set was asked for; 0 for one read back from storage. */
  since: number;
  /** Ms from the ask: the first card, all four written, the last cover in. */
  firstMs: number | null;
  writtenMs: number | null;
  coversMs: number | null;
  error: string | null;
  /** This set's requests, for the console's figures: held here, since a new world clears the console's list. */
  requests: DevRequest[];
}

const EMPTY: ProposalsView = {
  lang: null,
  items: [],
  writing: false,
  drawing: 0,
  model: null,
  since: 0,
  firstMs: null,
  writtenMs: null,
  coversMs: null,
  error: null,
  requests: [],
};

let view: ProposalsView = EMPTY;
const listeners = new Set<() => void>();
let controller: AbortController | null = null;

export function subscribeProposals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function proposalsView(): ProposalsView {
  return view;
}

function set(patch: Partial<ProposalsView>): void {
  view = { ...view, ...patch };
  for (const l of listeners) l();
}

interface Kept {
  at: number;
  used?: boolean;
  items: Proposal[];
}

function readAll(): Record<Lang, Kept> {
  try {
    const raw = JSON.parse(localStorage.getItem(PROPOSALS_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<Lang, Kept> = {};
    for (const lang of ['en', 'pl'] as const) {
      const k = raw?.[lang] as Record<string, unknown> | undefined;
      if (!k || !Array.isArray(k.items)) continue;
      const items = k.items.map(validProposal).filter((p): p is Proposal => p !== null);
      if (items.length) out[lang] = { at: Number(k.at) || 0, used: k.used === true, items };
    }
    return out;
  } catch {
    return {};
  }
}

function keep(lang: Lang, kept: Kept): void {
  const all = readAll();
  all[lang] = kept;
  rpgSet(PROPOSALS_KEY, JSON.stringify(all));
}

export interface ProposalKeys {
  /** The Google key or the account's handle for it. */
  google: string;
  fal: string | null;
}

/**
 * The menu is showing: the kept set of this language, or four new ones when there is none or the
 * last was used. Covers a kept set lacks (made with no fal.ai key then) are drawn now.
 */
export function ensureProposals(lang: Lang, keys: ProposalKeys): void {
  if (view.lang === lang && (view.writing || view.items.length)) {
    fillCovers(keys);
    return;
  }
  const kept = readAll()[lang];
  if (kept && !kept.used) {
    controller?.abort();
    controller = new AbortController();
    view = { ...EMPTY, lang, items: kept.items };
    for (const l of listeners) l();
    fillCovers(keys);
    return;
  }
  void drawProposals(lang, keys);
}

/** A proposal was picked: the next visit to the menu draws a new set. */
export function pickedProposal(lang: Lang): void {
  const kept = readAll()[lang];
  if (kept) keep(lang, { ...kept, used: true });
  if (view.lang === lang) {
    controller?.abort();
    view = EMPTY;
    for (const l of listeners) l();
  }
}

function since(): number {
  return Date.now() - view.since;
}

/** Four new proposals, written by the fastest model that answers, each card's cover started as it comes. */
export async function drawProposals(lang: Lang, keys: ProposalKeys): Promise<void> {
  controller?.abort();
  const mine = new AbortController();
  controller = mine;
  const signal = mine.signal;
  view = { ...EMPTY, lang, writing: true, since: Date.now() };
  for (const l of listeners) l();
  const words = drawWords(PROPOSAL_KINDS.length * 2);
  const prompt = proposalPrompt({
    lang,
    seeds: PROPOSAL_KINDS.map((_, i) => words.slice(i * 2, i * 2 + 2)),
    avoid: pastWorlds(),
  });
  const started = new Set<number>();
  const absorb = (soFar: string, final: boolean) => {
    if (signal.aborted) return;
    const parsed = parseProposals(soFar, final);
    if (!parsed.length) return;
    // Covers already drawn stay with their card.
    const items = parsed.map((p, i) => ({ ...p, image: view.items[i]?.image ?? null }));
    set({ items, ...(view.firstMs === null ? { firstMs: since() } : {}) });
    items.forEach((p, i) => {
      if (p.picture && !started.has(i) && keys.fal) {
        started.add(i);
        void drawCover(i, p.picture, keys.fal, signal);
      }
    });
  };
  let error: string | null = null;
  for (const { model, thinking } of INTRO_MODELS) {
    if (signal.aborted) return;
    const entry = startRequest('model', model, null, '', PROPOSAL_LABEL);
    set({ model, requests: [...view.requests, entry] });
    try {
      const text = await streamGoogleText(keys.google, model, prompt, { temperature: 1.2, thinking, signal }, entry, (soFar) => absorb(soFar, false));
      endRequest(entry, null);
      absorb(text, true);
      error = view.items.length ? null : 'no proposals in the answer';
      if (!error) break;
    } catch (e) {
      const message = signal.aborted ? 'stopped' : e instanceof Error ? e.message : String(e);
      endRequest(entry, message);
      error = message;
      if (signal.aborted || view.items.length) break;
    }
  }
  if (signal.aborted) return;
  set({ writing: false, writtenMs: since(), error: view.items.length ? null : error });
  if (view.items.length) keep(lang, { at: Date.now(), items: view.items });
  if (!view.drawing) finished();
}

/** Covers for a kept set that has none (made without a fal.ai key, or a cover that failed). */
function fillCovers(keys: ProposalKeys): void {
  if (!keys.fal || view.writing || !controller) return;
  view.items.forEach((p, i) => {
    if (p.picture && !p.image && !pendingCovers.has(i)) void drawCover(i, p.picture, keys.fal!, controller!.signal);
  });
}

const pendingCovers = new Set<number>();

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

async function drawCover(at: number, picture: string, fal: string, signal: AbortSignal): Promise<void> {
  const prompt = coverPrompt(picture);
  const entry = startRequest('fal', FAL_IMAGE_MODEL, null, prompt, PROPOSAL_LABEL);
  pendingCovers.add(at);
  set({ drawing: view.drawing + 1, requests: [...view.requests, entry] });
  try {
    if (outOfFunds('fal')) throw new Error('skipped: no money left on fal.ai');
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      response = await apiFetch(`https://fal.run/${FAL_IMAGE_MODEL}`, {
        method: 'POST',
        headers: { Authorization: `Key ${fal}`, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ prompt, image_size: PICTURE_SIZE, num_inference_steps: 4, num_images: 1, enable_safety_checker: true }),
      });
      // Four at once can meet the account's limit (`rpg.md`, fal.ai's concurrency): asked again.
      if (response.status !== 429 || attempt >= 3) break;
      await sleep(1000 * 2 ** attempt, signal);
    }
    if (!response.ok) throw new Error(`${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`);
    const url = ((await response.json()) as { images?: { url?: string }[] }).images?.[0]?.url;
    if (!url) throw new Error('no image in the answer');
    endRequest(entry, null, { cost: imageCost(PICTURE_SIZE.width, PICTURE_SIZE.height), serverCost: serverCost(response), text: `${prompt}\n→ ${url}` });
    if (signal.aborted) return;
    const items = view.items.map((p, i) => (i === at ? { ...p, image: url } : p));
    set({ items });
    if (!view.writing && view.lang) {
      const kept = readAll()[view.lang];
      keep(view.lang, { at: kept?.at ?? Date.now(), items });
    }
  } catch (e) {
    if (entry.status !== 'ok') endRequest(entry, signal.aborted ? 'stopped' : e instanceof Error ? e.message : String(e));
  } finally {
    pendingCovers.delete(at);
    if (!signal.aborted) {
      set({ drawing: Math.max(0, view.drawing - 1) });
      if (!view.drawing && !view.writing) finished();
    }
  }
}

/** The set is whole: the last cover's time, and Sentry Logs. */
function finished(): void {
  if (!view.since) return;
  const coversMs = view.items.some((p) => p.image) ? since() : null;
  set({ coversMs });
  const t = proposalTotals(view);
  recordMeasurement('rpg.proposals', {
    outcome: view.items.length >= PROPOSAL_COUNT ? 'whole' : view.items.length ? 'partial' : 'failed',
    lang: view.lang,
    model: view.model,
    proposals: view.items.length,
    covers: view.items.filter((p) => p.image).length,
    firstMs: view.firstMs,
    writtenMs: view.writtenMs,
    coversMs,
    usd: Math.round(t.total * 10000) / 10000,
  });
}

export interface ProposalTotals {
  input: number;
  output: number;
  modelUsd: number;
  covers: number;
  coversUsd: number;
  total: number;
  errors: number;
}

/** What this set cost: the words and the covers apart, and how many requests failed. */
export function proposalTotals(v: ProposalsView): ProposalTotals {
  const models = v.requests.filter((r) => r.kind === 'model');
  const covers = v.requests.filter((r) => r.kind === 'fal' && r.status === 'ok');
  const modelUsd = models.reduce((n, r) => n + (r.cost ?? 0), 0);
  const coversUsd = covers.reduce((n, r) => n + (r.cost ?? 0), 0);
  return {
    input: models.reduce((n, r) => n + (r.usage?.input ?? 0), 0),
    output: models.reduce((n, r) => n + (r.usage?.output ?? 0), 0),
    modelUsd,
    covers: covers.length,
    coversUsd,
    total: modelUsd + coversUsd,
    errors: v.requests.filter((r) => r.status === 'error' && r.error !== 'stopped').length,
  };
}
