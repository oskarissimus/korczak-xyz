/*
 * The quest giver's voice: ElevenLabs on the reader's own key from the account store, or, with
 * `DEMO_VOICE_KEY` in its place, through the demo function on the owner's (`demo.ts`).
 *
 * One `<audio>` element for the life of the tab, primed inside the Start click, for the reason
 * `utils/backseat/speech.ts` gives at length: iOS unlocks the element a gesture touched, not the
 * page, so a fresh `new Audio()` built after a fetch is refused. Clips are cached by text, so
 * walking back through a dialogue does not pay for the same line twice.
 */

import { DEMO_VOICE_KEY, rpgDemoUrl } from './demo';
import { findVoice, sharedVoicesOf, voiceListsOf, type SharedVoice, type VoiceLists, type VoiceWho } from './voicePick';
import { endRequest, startRequest, updateRequest, voiceCredits } from './devlog';
import { outOfFunds } from './funds';
import { DesignRefused, DESIGN_MODEL, designVoice, findDesigned, previewText, type DesignWho } from './voiceDesign';
import { FLASH_MODEL, refusedModel, speechRequest, TAG_MODEL, voicing as voicingOf } from './audioTags';
import { voiceCreditsPerChar } from './cost';
import type { Lang } from './quest';

/** Flash for every line without an audio tag; a tagged line goes to `TAG_MODEL` (`audioTags.ts`). */
export const VOICE_MODEL = FLASH_MODEL;

/** v4 refused (the plan, the voice, a model gone): tags go unsaid for the session, the words still on Flash. */
let tagsOff = false;

function voicing(text: string): { model: string; text: string } {
  return voicingOf(text, !tagsOff);
}

/**
 * Premade voices every ElevenLabs account has: George or Rachel for the quest giver, Brian for the
 * hunter, so the two sides of a conversation never sound like one person.
 */
export const VOICES = {
  male: 'JBFqnCBsd6RMkjVDRZzb',
  female: '21m00Tcm4TlvDq8ikWAM',
  player: 'nPczCjzI2devNBz1zQrb',
} as const;

export type VoiceName = keyof typeof VOICES;

export interface SpokenLine {
  text: string;
  /** The premade voice, and the fallback when the library has none for `who`. */
  voice: VoiceName;
  /** A character's line: their own voice from the Voice Library (`voicePick.ts`). */
  who?: VoiceWho;
}

/**
 * The library searches this browser has made, kept a day: every character of a gender and age
 * picks from the same search, so a quest asks it a handful of times at most.
 */
const LISTS_KEY = 'rpg-voice-lists';
const LISTS_MS = 24 * 3600_000;
const lists = new Map<string, Promise<SharedVoice[]>>();
/** The key cannot use the library (a free plan cannot through the API): premade voices only. */
let libraryOff = false;

function storedLists(): Record<string, { at: number; voices: SharedVoice[] }> {
  try {
    return JSON.parse(localStorage.getItem(LISTS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function storeList(url: string, voices: SharedVoice[]): void {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify({ ...storedLists(), [url]: { at: Date.now(), voices } }));
  } catch {
    /* asked again next time */
  }
}

/**
 * A filtered library search takes 8 to 14 seconds (a clip about one), so a character's first line
 * used to wait that long. The demo function keeps every search of a language for a week and hands
 * them all over in one request (`voicePick.ts`, `voiceQueries`); the game asks for them when a
 * quest starts, and searches with the reader's own key only for what they did not cover.
 */
const served = new Map<Lang, Promise<VoiceLists>>();

export function prefetchVoices(lang: Lang): void {
  if (served.has(lang)) return;
  const url = rpgDemoUrl();
  if (!url) return;
  const lists = (async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'voices', lang }),
    });
    if (!response.ok) throw new Error(`voices ${response.status}`);
    const got = voiceListsOf((await response.json())?.lists, lang);
    // An empty answer is an answer too: the high-quality searches often have nothing in Polish.
    for (const [u, voices] of Object.entries(got)) storeList(u, voices);
    return got;
  })();
  served.set(lang, lists);
  lists.catch(() => served.delete(lang));
}

async function servedList(url: string): Promise<SharedVoice[] | null> {
  const lang: Lang = new URL(url).searchParams.get('language') === 'pl' ? 'pl' : 'en';
  const lists = served.get(lang);
  if (!lists) return null;
  try {
    return (await lists)[url] ?? null;
  } catch {
    return null;
  }
}

function listVoices(key: string, url: string): Promise<SharedVoice[]> {
  let found = lists.get(url);
  if (found) return found;
  found = (async () => {
    const stored = storedLists()[url];
    if (stored && Date.now() - stored.at < LISTS_MS) return stored.voices;
    const handed = await servedList(url);
    if (handed) return handed;
    const response = await fetch(url, { headers: { 'xi-api-key': key } });
    if (response.status === 401 || response.status === 403) libraryOff = true;
    if (!response.ok) throw new Error(`ElevenLabs ${response.status}`);
    const voices = sharedVoicesOf(await response.json()).map(({ voice_id, rate, fiat_rate, verified_languages }) => ({
      voice_id,
      rate,
      fiat_rate,
      verified_languages: (verified_languages ?? []).map(({ language, model_id }) => ({ language, model_id })),
    }));
    storeList(url, voices);
    return voices;
  })();
  lists.set(url, found);
  found.catch(() => lists.delete(url));
  return found;
}

/*
 * Designed voices (`voiceDesign.ts`): each character the model described gets one, made the first
 * time they are needed (when their beat arrives, by `warmVoices`) and found again by name after
 * that. Cached here by world and name; a refusal that will not change this session (the plan, the
 * month's voice operations) turns designing off and every character falls back to the library.
 */
/** `-hq`: the ids cached before every design asked for studio quality are not reused (`voiceDesign.ts`). */
const DESIGNED_KEY = 'rpg-designed-voices-hq';
const designed = new Map<string, Promise<string | null>>();
let designOff = false;
let voiceWorld = 'world';

/** The world whose characters are speaking: a name is a different person in another world. */
export function setVoiceWorld(id: string): void {
  voiceWorld = id;
}

function storedDesigns(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DESIGNED_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function storeDesign(id: string, voiceId: string | null): void {
  try {
    const all = storedDesigns();
    if (voiceId) all[id] = voiceId;
    else delete all[id];
    localStorage.setItem(DESIGNED_KEY, JSON.stringify(all));
  } catch {
    /* found again by name */
  }
}

function designedVoice(key: string, who: DesignWho, lang: Lang): Promise<string | null> {
  const id = `${voiceWorld}|${who.name}`;
  let found = designed.get(id);
  if (found) return found;
  found = (async () => {
    const stored = storedDesigns()[id];
    if (stored) return stored;
    const existing = await findDesigned(fetch, key, voiceWorld, who.name).catch(() => null);
    if (existing) {
      storeDesign(id, existing);
      return existing;
    }
    // The account has no credits left (`funds.ts`): the library's voice instead, as on a refusal.
    if (outOfFunds('elevenlabs')) return null;
    // Into the console like a clip: a design is charged for its preview text, about a credit a character.
    const sample = previewText(who, lang);
    const entry = startRequest('voice', `${DESIGN_MODEL} · ${who.name}`, null, who.voice);
    try {
      const voiceId = await designVoice(fetch, key, voiceWorld, who, lang);
      endRequest(entry, null, { chars: sample.length, credits: sample.length });
      storeDesign(id, voiceId);
      return voiceId;
    } catch (e) {
      if (e instanceof DesignRefused) designOff = true;
      endRequest(entry, e instanceof Error ? e.message : String(e));
      return null;
    }
  })();
  designed.set(id, found);
  return found;
}

/** A designed voice that ElevenLabs no longer has (rotated out elsewhere): made again next time. */
function forgetDesigned(who: VoiceWho): void {
  const id = `${voiceWorld}|${who.name}`;
  designed.delete(id);
  storeDesign(id, null);
}

/** The character's own voice: designed when the model described one, else from the library. */
async function characterVoice(key: string, line: SpokenLine, lang: Lang): Promise<{ id: string; designed: boolean } | null> {
  const who = line.who;
  if (!who) return null;
  if (who.voice && !designOff) {
    const id = await designedVoice(key, { name: who.name, gender: who.gender, voice: who.voice, sample: who.sample }, lang);
    if (id) return { id, designed: true };
  }
  const library = await libraryVoice(key, line, lang);
  return library ? { id: library, designed: false } : null;
}

/** The character's library voice, or null for the premade one. */
async function libraryVoice(key: string, line: SpokenLine, lang: Lang): Promise<string | null> {
  if (!line.who || libraryOff) return null;
  try {
    return await findVoice(line.who, lang, VOICE_MODEL, (url) => listVoices(key, url), Object.values(VOICES));
  } catch {
    return null;
  }
}

function speak(key: string, voiceId: string, text: string, lang: Lang, model: string = VOICE_MODEL): Promise<Response> {
  return fetch(...speechRequest(key, voiceId, text, lang, model));
}

/** 50ms of silence, the same clip the backseat driver primes with. */
const SILENT_CLIP =
  'data:audio/wav;base64,' +
  'UklGRhQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAA=';

let player: HTMLAudioElement | null = null;
const clips = new Map<string, Promise<string>>();
let current: AbortController | null = null;

function element(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
  }
  return player;
}

/** Call from inside a click. Harmless where no unlock is needed. */
export function primeVoice(): void {
  const el = element();
  if (!el) return;
  try {
    el.src = SILENT_CLIP;
    void el.play()?.then(() => el.pause()).catch(() => {});
  } catch {
    /* Reported when a line is actually spoken. */
  }
}

export function stopVoice(): void {
  current?.abort();
  current = null;
  player?.pause();
}

async function fetchClip(key: string, line: SpokenLine, lang: Lang): Promise<string> {
  // Into the developer console with what it cost: ElevenLabs' own `character-cost` header where the
  // browser is allowed to read it, else the list rate (`cost.ts`).
  // The console shows what was sent, tags and all, under the model that spoke it.
  let said = voicing(line.text);
  const entry = startRequest('voice', `${said.model} · ${line.who?.name ?? line.voice}`, null, said.text);
  try {
    const demo = key === DEMO_VOICE_KEY;
    const demoUrl = demo ? rpgDemoUrl() : null;
    if (demo && !demoUrl) throw new Error('demo: no address');
    let response = demoUrl
      ? await fetch(demoUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'voice', text: line.text, voice: line.voice, who: line.who, lang }),
        })
      : await ownClip(key, line, lang, said);
    if (!demoUrl && !response.ok && said.model === TAG_MODEL && refusedModel(response.status)) {
      // v4 would not: the same line without its tags, on Flash, and Flash from now on.
      tagsOff = true;
      said = voicing(line.text);
      updateRequest(entry, { model: `${said.model} · ${line.who?.name ?? line.voice} (${TAG_MODEL} ${response.status})`, text: said.text });
      response = await ownClip(key, line, lang, said);
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.detail?.message || error?.detail || `ElevenLabs ${response.status}`);
    }
    const url = URL.createObjectURL(await response.blob());
    // The demo says which model it used (`x-demo-model`); the rate follows the model.
    const model = response.headers.get('x-demo-model') ?? said.model;
    endRequest(entry, null, {
      chars: said.text.length,
      credits: voiceCredits(said.text.length, response.headers.get('character-cost'), voiceCreditsPerChar(model)),
    });
    return url;
  } catch (e) {
    endRequest(entry, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/**
 * On the reader's key: the character's library voice, and the premade one if the library has none
 * or will not speak it (a plan that may not use library voices through the API says so here).
 */
async function ownClip(key: string, line: SpokenLine, lang: Lang, said = voicing(line.text)): Promise<Response> {
  const own = await characterVoice(key, line, lang);
  if (own) {
    const response = await speak(key, own.id, said.text, lang, said.model);
    // The model refused, not the voice: the caller falls back to Flash before blaming the voice.
    if (said.model === TAG_MODEL && refusedModel(response.status)) return response;
    if (response.ok || response.status === 429 || response.status >= 500) return response;
    if (own.designed) {
      if ([400, 404].includes(response.status) && line.who) forgetDesigned(line.who);
    } else if ([401, 402, 403].includes(response.status)) {
      // Not allowed to use library voices: none again this session. Anything else: this line only.
      libraryOff = true;
    }
  }
  return speak(key, VOICES[line.voice], said.text, lang, said.model);
}

function clipFor(key: string, line: SpokenLine, lang: Lang): Promise<string> {
  const cacheKey = `${line.voice}:${line.who?.name ?? ''}:${lang}:${line.text}`;
  let clip = clips.get(cacheKey);
  // No credits left on the reader's account (`funds.ts`): every line would fail the same way, so
  // none is asked and the game reads in silence. The demo speaks on the owner's account, not theirs.
  if (!clip && key !== DEMO_VOICE_KEY && outOfFunds('elevenlabs')) return Promise.reject(new Error('skipped: no credits left on ElevenLabs'));
  if (!clip) {
    clip = fetchClip(key, line, lang);
    clips.set(cacheKey, clip);
    // A failed request is not cached: the next attempt may well work.
    clip.catch(() => clips.delete(cacheKey));
  }
  return clip;
}

/**
 * ElevenLabs is slow the first time an account speaks with a library voice: 11 to 17 seconds for
 * that clip, then about one second for every later one, whatever the text (measured on the demo, Oct
 * 2026; a voice used the day before was still quick). So each character's voice speaks a single
 * character as soon as the beat that brings them in arrives, while the hunter walks over, and
 * their first real line comes at the ordinary speed. Kept by name (`rpg-voice-warm`): the name
 * picks the voice, and a voice once warm has stayed warm.
 */
const WARM_KEY = 'rpg-voice-warm';
const warming = new Set<string>();

function warmNames(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(WARM_KEY) ?? '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function warmVoices(key: string, who: readonly VoiceWho[], lang: Lang): void {
  const warm = warmNames();
  for (const w of who) {
    // A described voice is a new voice, whatever was warmed under the name before.
    const id = `${voiceWorld}|${lang}:${w.name}${w.voice ? '|designed-hq' : ''}`;
    if (warm.includes(id) || warming.has(id)) continue;
    warming.add(id);
    fetchClip(key, { text: '.', voice: w.gender, who: w }, lang)
      .then((url) => {
        URL.revokeObjectURL(url);
        try {
          localStorage.setItem(WARM_KEY, JSON.stringify([...warmNames().filter((n) => n !== id), id].slice(-500)));
        } catch {
          /* warmed again next time */
        }
      })
      .catch(() => warming.delete(id));
  }
}

/** Plays one clip to its end, or until `signal` aborts. */
function play(el: HTMLAudioElement, url: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = (err?: Error) => {
      el.onended = null;
      el.onerror = null;
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      el.pause();
      done();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    el.onended = () => done();
    el.onerror = () => done(new Error('The voice clip would not play.'));
    el.src = url;
    void el.play().catch((e) => done(e instanceof Error ? e : new Error('The voice clip would not play.')));
  });
}

/**
 * Speaks lines one after another — the hunter's choice, then the answer — stopping whatever was
 * speaking. Every clip is requested at once, so the answer is ready when the question ends.
 * Resolves when the last has finished or a newer call replaced this one. `onStart` is told as each
 * line begins, which is when the dialogue shows the answer (owner, Oct 2026: the answer should
 * appear when its speaker starts talking, not while the hunter's line is still being read).
 */
export async function speakLines(
  key: string,
  lines: SpokenLine[],
  lang: Lang,
  onStart?: (line: SpokenLine) => void,
): Promise<void> {
  stopVoice();
  const el = element();
  if (!el || lines.length === 0) return;
  const controller = new AbortController();
  current = controller;
  const pending = lines.map((line) => clipFor(key, line, lang));
  for (const [i, clip] of pending.entries()) {
    const url = await clip;
    if (controller.signal.aborted) return;
    onStart?.(lines[i]);
    await play(el, url, controller.signal);
    if (controller.signal.aborted) return;
  }
}
