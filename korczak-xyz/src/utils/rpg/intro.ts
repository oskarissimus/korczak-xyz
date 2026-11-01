/*
 * The intro: a story of the world told over a slideshow while the world is being made (owner, 1 Nov
 * 2026: "an intro during the world's generation — a very fast model makes some six frames one after
 * another and tells the story, to bring us into the world, not the quest, which is still being
 * written. The Witcher 3 does this: the loading screen is an entry into the story and its mood. A
 * pleasant ElevenLabs voice from the catalogue, not a designed one, so it starts at once; low latency
 * to the loading screen is the key thing; the picture can be poor, it must be fast"). Behind a
 * Settings switch, on unless turned off (`rpg-intro`).
 *
 * Everything is ordered for the first sound and the first picture:
 * 1. **The click**: the prologue (`prologue`, the same words every time) starts speaking at once,
 *    streamed (`playStream`) — and after the first time it comes from the account's bucket for
 *    nothing. It covers the seconds before anything about the world is known.
 * 2. **The genesis names the world** (`sketchWorld`: the chosen candidate's sentence, ~1 s after its
 *    first token): `introSketch` asks the narration of a very fast model with no thinking
 *    (`INTRO_MODELS`), streamed line by line (`introScript.ts`).
 * 3. **Each frame's line** starts its clip (Flash v2.5, a premade storyteller's voice, two at a time
 *    so ElevenLabs' concurrency is left for the game) and its picture (FLUX schnell, 768×432, ~1 s),
 *    while the frames before it are still being told.
 * Every request goes through the gateway (`apiFetch`) and into the `~` console under `intro`, the
 * model's tokens, the clips and the pictures each priced apart; the Start tab marks the first voice
 * and the first picture, and the intro's own figures sit at its top (`introView`).
 *
 * It belongs to the world's start: a skip, a failed genesis, a dialogue or leaving to the menu stop
 * it (`stopIntro`), and it ends by itself after the last frame — the game behind it has been
 * building all along.
 */

import { apiFetch, serverCost } from './gateway';
import { endRequest, markStage, startRequest, voiceCredits } from './devlog';
import { streamGoogleText } from './storyteller';
import { FAL_IMAGE_MODEL, imageCost } from './falPrompts';
import { FLASH_MODEL, speechRequest } from './audioTags';
import { voiceCreditsPerChar } from './cost';
import { outOfFunds } from './funds';
import { playClip, playStream, streamingAudio } from './voice';
import { introPrompt, parseIntro, picturePrompt, prologue, readingMs } from './introScript';
import type { WorldSketch } from './genesis';
import type { Lang } from './quest';
import { recordMeasurement } from '../../lib/sentry';

/**
 * Who writes the narration, in order: the fastest first. `gemini-3.1-flash-lite` with no thinking
 * config answered its first token in 0.63 s on 1 Nov 2026 (asked for `minimal` thinking it took
 * 4.4 s); `gemini-flash-lite-latest` (3.5 Flash-Lite that day) 0.82 s; 3 Flash 0.93 s.
 */
export const INTRO_MODELS: { model: string; thinking?: 'minimal' }[] = [
  { model: 'gemini-3.1-flash-lite' },
  { model: 'gemini-flash-lite-latest' },
  { model: 'gemini-3-flash-preview', thinking: 'minimal' },
];

/**
 * The narrator: George, ElevenLabs' premade "warm, captivating storyteller". Premade rather than a
 * library voice because a library voice is slow the first time an account speaks with it (11–17 s,
 * `voice.ts`), which is the one wait this exists to avoid. Premade voices end on 31 Dec 2026 for
 * accounts like the owner's (`rpg.md`, *Voice*): before then this becomes a library storyteller,
 * warmed once.
 */
export const NARRATOR_VOICE = 'JBFqnCBsd6RMkjVDRZzb';
const NARRATOR = 'narrator';

/** The pictures' size: 16:9, a third of a megapixel, so fal bills its smallest unit ($0.003). */
export const PICTURE_SIZE = { width: 768, height: 432 } as const;

/** How long a frame's narration waits for its own picture before it starts anyway. */
const PICTURE_WAIT_MS = 1500;
/** Clips fetched at once: the game's own voices and the score share the account's concurrency. */
const CLIPS_AT_ONCE = 2;

export interface IntroOptions {
  lang: Lang;
  /** The Google key or the account's handle for it: the narration. */
  google: string;
  /** fal.ai, for the pictures; without it the frames are words on the dark. */
  fal: string | null;
  /** ElevenLabs, for the voice; without it each frame stays up for a reader's time. */
  voice: string | null;
  /** The player's own description of the world, if they gave one. */
  wish?: string;
}

export interface IntroFrameView {
  text: string;
  /** The picture, loaded and ready to show; null until then, or when it failed. */
  image: string | null;
}

/** What the overlay and the console read. */
export interface IntroView {
  on: boolean;
  since: number;
  /** The world's name, once the genesis has said it. */
  name: string | null;
  /** The prologue first, then the narration's frames as they stream. */
  frames: IntroFrameView[];
  /** The frame being told. */
  current: number;
  /** The narration is still being written (or not yet asked). */
  writing: boolean;
  model: string | null;
  /** Ms from the click: the first sound, the first picture on screen, the world named, the narration's first frame and its end. */
  firstVoiceMs: number | null;
  firstPictureMs: number | null;
  sketchMs: number | null;
  firstLineMs: number | null;
  writtenMs: number | null;
  error: string | null;
}

const OFF: IntroView = {
  on: false,
  since: 0,
  name: null,
  frames: [],
  current: 0,
  writing: false,
  model: null,
  firstVoiceMs: null,
  firstPictureMs: null,
  sketchMs: null,
  firstLineMs: null,
  writtenMs: null,
  error: null,
};

let view: IntroView = OFF;
/** The last intro's figures, kept for the console after it has ended. */
let lastView: IntroView | null = null;
const listeners = new Set<() => void>();

export function subscribeIntro(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function introView(): IntroView {
  return view;
}

/** The intro being told, or the last one told this sitting: the console's figures. */
export function lastIntro(): IntroView | null {
  return view.on ? view : lastView;
}

function set(patch: Partial<IntroView>): void {
  view = { ...view, ...patch };
  for (const l of listeners) l();
}

interface Work {
  text: string;
  picture: string | null;
  clip: Promise<string | null> | null;
  image: Promise<string | null> | null;
}

interface Run {
  o: IntroOptions;
  controller: AbortController;
  work: Work[];
  /** The narration has been asked for. */
  sketched: boolean;
  /** The narration has ended, with or without frames. */
  narrated: boolean;
  /** Woken whenever a frame or the narration's end arrives. */
  wake: (() => void)[];
  urls: string[];
  clipsRunning: number;
  clipQueue: (() => void)[];
}

let run: Run | null = null;

function poke(r: Run): void {
  const waiting = r.wake;
  r.wake = [];
  for (const w of waiting) w();
}

function changed(r: Run): Promise<void> {
  return new Promise((resolve) => r.wake.push(resolve));
}

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

function since(r: Run): number {
  return Date.now() - (r === run ? view.since : Date.now());
}

/** Inside the click that starts a new world, after `primeVoice`. */
export function startIntro(o: IntroOptions): void {
  stopIntro();
  const controller = new AbortController();
  const r: Run = {
    o,
    controller,
    work: [{ text: prologue(o.lang), picture: null, clip: null, image: null }],
    sketched: false,
    narrated: false,
    wake: [],
    urls: [],
    clipsRunning: 0,
    clipQueue: [],
  };
  run = r;
  view = { ...OFF, on: true, since: Date.now(), frames: [{ text: prologue(o.lang), image: null }], writing: true };
  lastView = null;
  for (const l of listeners) l();
  void tell(r);
}

/** Skipped, or the start it belonged to is gone: everything in flight stops. */
export function stopIntro(): void {
  const r = run;
  if (!r) return;
  run = null;
  r.controller.abort();
  poke(r);
  // The clips' blob URLs: nothing will play them now.
  setTimeout(() => r.urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
  report(r, 'stopped');
  lastView = { ...view, on: false };
  view = OFF;
  for (const l of listeners) l();
}

/** The genesis has said what the world is: the narration is asked for, once. */
export function introSketch(sketch: WorldSketch): void {
  const r = run;
  if (!r || r.sketched) return;
  r.sketched = true;
  set({ name: sketch.name, sketchMs: since(r) });
  void narrate(r, sketch);
}

async function narrate(r: Run, sketch: WorldSketch): Promise<void> {
  const prompt = introPrompt({ lang: r.o.lang, sketch, wish: r.o.wish });
  const signal = r.controller.signal;
  let error: string | null = null;
  for (const { model, thinking } of INTRO_MODELS) {
    if (signal.aborted) return;
    const entry = startRequest('model', model, null, '', 'intro');
    if (r === run) set({ model });
    try {
      const text = await streamGoogleText(r.o.google, model, prompt, { temperature: 1, thinking, signal }, entry, (soFar) => absorb(r, soFar, false));
      endRequest(entry, null);
      absorb(r, text, true);
      error = null;
      break;
    } catch (e) {
      const message = signal.aborted ? 'skipped' : e instanceof Error ? e.message : String(e);
      endRequest(entry, message);
      error = message;
      // Frames already told stand; only an answer with none is worth another model.
      if (signal.aborted || r.work.length > 1) break;
    }
  }
  r.narrated = true;
  if (r === run) set({ writing: false, writtenMs: since(r), ...(error && r.work.length <= 1 ? { error } : {}) });
  poke(r);
}

/** The narration so far, read into frames; each new line starts its clip, each new picture its drawing. */
function absorb(r: Run, soFar: string, final: boolean): void {
  if (r !== run) return;
  const lines = parseIntro(soFar, final);
  let grew = false;
  lines.forEach((line, i) => {
    const at = i + 1;
    let w = r.work[at];
    if (!w) {
      w = { text: line.text, picture: null, clip: null, image: null };
      r.work[at] = w;
      if (r.o.voice) w.clip = fetchClip(r, line.text);
      grew = true;
    }
    if (line.picture && !w.picture) {
      w.picture = line.picture;
      if (r.o.fal) w.image = drawPicture(r, at, line.picture);
    }
  });
  if (!grew) return;
  set({
    frames: r.work.map((w, i) => ({ text: w.text, image: view.frames[i]?.image ?? null })),
    ...(view.firstLineMs === null ? { firstLineMs: since(r) } : {}),
  });
  poke(r);
}

/** ElevenLabs' request for one narrated line; `stream` asks the endpoint that sends audio as it is made. */
function speech(key: string, text: string, lang: Lang, stream: boolean): [string, RequestInit] {
  const [url, init] = speechRequest(key, NARRATOR_VOICE, text, lang, FLASH_MODEL);
  return [stream ? url.replace(/(\/v1\/text-to-speech\/\w+)/, '$1/stream') : url, { ...init, signal: run?.controller.signal }];
}

async function speak(r: Run, text: string, stream: boolean): Promise<Response> {
  const response = await apiFetch(...speech(r.o.voice!, text, r.o.lang, stream));
  // The gateway learns `/stream` with its next deploy; until then, the whole clip.
  if (stream && response.status === 404) return apiFetch(...speech(r.o.voice!, text, r.o.lang, false));
  return response;
}

function voiceEntry(text: string) {
  return startRequest('voice', `${FLASH_MODEL} · ${NARRATOR}`, null, text, 'intro');
}

function endVoice(entry: ReturnType<typeof voiceEntry>, response: Response, text: string): void {
  endRequest(entry, null, {
    chars: text.length,
    credits: voiceCredits(text.length, response.headers.get('character-cost'), voiceCreditsPerChar(FLASH_MODEL)),
    serverCost: serverCost(response),
  });
}

async function failure(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body?.detail?.message || (typeof body?.detail === 'string' ? body.detail : '') || `ElevenLabs ${response.status}`;
}

/** A frame's clip, whole, as a blob URL; null when it could not be had (the frame is then read). */
async function fetchClip(r: Run, text: string): Promise<string | null> {
  if (outOfFunds('elevenlabs')) return null;
  if (r.clipsRunning >= CLIPS_AT_ONCE) await new Promise<void>((resolve) => r.clipQueue.push(resolve));
  r.clipsRunning += 1;
  const entry = voiceEntry(text);
  try {
    if (r.controller.signal.aborted) throw new Error('skipped');
    const response = await speak(r, text, false);
    if (!response.ok) throw new Error(await failure(response));
    const url = URL.createObjectURL(await response.blob());
    r.urls.push(url);
    endVoice(entry, response, text);
    return url;
  } catch (e) {
    endRequest(entry, r.controller.signal.aborted ? 'skipped' : e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    r.clipsRunning -= 1;
    r.clipQueue.shift()?.();
  }
}

/** The prologue, heard as it streams in; false when it could not be (the caller then reads it). */
async function streamClip(r: Run, text: string, onPlaying: () => void): Promise<boolean> {
  if (outOfFunds('elevenlabs')) return false;
  const entry = voiceEntry(text);
  try {
    const response = await speak(r, text, true);
    if (!response.ok) throw new Error(await failure(response));
    // Priced from the headers, which come first; the clip itself is still arriving.
    endVoice(entry, response, text);
    await playStream(response, r.controller.signal, onPlaying);
    return true;
  } catch (e) {
    if (entry.status !== 'ok') endRequest(entry, r.controller.signal.aborted ? 'skipped' : e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** A frame's picture from FLUX schnell, loaded into the browser before it is shown. */
async function drawPicture(r: Run, at: number, picture: string): Promise<string | null> {
  const prompt = picturePrompt(picture);
  const entry = startRequest('fal', FAL_IMAGE_MODEL, null, prompt, 'intro');
  const signal = r.controller.signal;
  try {
    if (outOfFunds('fal')) throw new Error('skipped: no money left on fal.ai');
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      response = await apiFetch(`https://fal.run/${FAL_IMAGE_MODEL}`, {
        method: 'POST',
        headers: { Authorization: `Key ${r.o.fal}`, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ prompt, image_size: PICTURE_SIZE, num_inference_steps: 4, num_images: 1, enable_safety_checker: true }),
      });
      // fal.ai at the account's limit while the hub's models run: a picture late is better than none.
      if (response.status !== 429 || attempt >= 2) break;
      await sleep(1000 * 2 ** attempt, signal);
    }
    if (!response.ok) throw new Error(`${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`);
    const url = ((await response.json()) as { images?: { url?: string }[] }).images?.[0]?.url;
    if (!url) throw new Error('no image in the answer');
    endRequest(entry, null, { cost: imageCost(PICTURE_SIZE.width, PICTURE_SIZE.height), serverCost: serverCost(response), text: `${prompt}\n→ ${url}` });
    await preload(url, signal);
    if (r === run) {
      const frames = view.frames.map((f, i) => (i === at ? { ...f, image: url } : f));
      set({ frames });
      shownPicture(r);
    }
    return url;
  } catch (e) {
    if (entry.status !== 'ok') endRequest(entry, signal.aborted ? 'skipped' : e instanceof Error ? e.message : String(e));
    return null;
  }
}

function preload(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') return resolve();
    const img = new Image();
    const t = setTimeout(() => reject(new Error('picture: no load in 10 s')), 10_000);
    img.onload = () => {
      clearTimeout(t);
      resolve();
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error('picture would not load'));
    };
    signal.addEventListener('abort', () => reject(new Error('skipped')), { once: true });
    img.src = url;
  });
}

/** The picture the overlay shows: the latest one loaded up to the frame being told — or the first frame's, already during the prologue. */
export function shownImage(v: IntroView): string | null {
  for (let i = Math.min(v.frames.length - 1, Math.max(v.current, 1)); i >= 0; i--) {
    if (v.frames[i]?.image) return v.frames[i].image;
  }
  return null;
}

function shownPicture(r: Run): void {
  if (r !== run || view.firstPictureMs !== null || !shownImage(view)) return;
  set({ firstPictureMs: since(r) });
  markStage('introPicture');
}

function heard(r: Run): void {
  if (r !== run || view.firstVoiceMs !== null) return;
  set({ firstVoiceMs: since(r) });
  markStage('introVoice');
}

/** Tells the frames in order, each as soon as it (and, briefly, its picture) is ready, and ends after the last. */
async function tell(r: Run): Promise<void> {
  const signal = r.controller.signal;
  for (let i = 0; ; i++) {
    while (r.work.length <= i && !r.narrated) {
      await changed(r);
      if (signal.aborted) return;
    }
    if (r.work.length <= i) break;
    const w = r.work[i];
    if (i > 0 && w.image) await Promise.race([w.image, sleep(PICTURE_WAIT_MS, signal)]);
    if (signal.aborted) return;
    set({ current: i });
    shownPicture(r);
    let spoken = false;
    if (r.o.voice) {
      if (i === 0 && streamingAudio()) {
        spoken = await streamClip(r, w.text, () => heard(r));
      } else {
        const url = i === 0 ? await fetchClip(r, w.text) : await w.clip;
        if (signal.aborted) return;
        if (url) {
          spoken = await playClip(url, signal, () => heard(r)).then(
            () => true,
            () => false,
          );
        }
      }
    }
    if (signal.aborted) return;
    if (!spoken) await sleep(readingMs(w.text), signal);
    else await sleep(350, signal);
    if (signal.aborted) return;
  }
  if (r !== run) return;
  report(r, view.frames.length > 1 ? 'told' : 'empty');
  run = null;
  lastView = { ...view, on: false };
  view = OFF;
  for (const l of listeners) l();
}

/** Sentry Logs: how long the first sound and picture took, and how the intro ended. Nothing of what it said. */
function report(r: Run, outcome: 'told' | 'stopped' | 'empty'): void {
  if (r.controller.signal.aborted && outcome !== 'stopped') return;
  recordMeasurement('rpg.intro', {
    outcome,
    lang: r.o.lang,
    voice: Boolean(r.o.voice),
    pictures: Boolean(r.o.fal),
    model: view.model,
    frames: view.frames.length - 1,
    firstVoiceMs: view.firstVoiceMs,
    firstPictureMs: view.firstPictureMs,
    sketchMs: view.sketchMs,
    firstLineMs: view.firstLineMs,
    writtenMs: view.writtenMs,
    shownMs: Date.now() - view.since,
  });
}
