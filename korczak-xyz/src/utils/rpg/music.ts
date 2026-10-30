/*
 * The score under the game: a track composed by ElevenLabs' Music API for the world and the quest's
 * tone (owner, 30 Oct 2026: "a generated soundtrack in ElevenLabs — music only for now, fitted to
 * the world's climate and the RPG"). No sound effects.
 *
 * - **What it is asked for**: the world's own `music` line (English, written by the genesis beside
 *   the landmark and the terrain) or, for a world from before it, one put together from the look and
 *   the bible; then the quest's tone (`TONE_MUSIC`), then the same rules for every track —
 *   instrumental, under dialogue, no drops, ending as it began so it loops.
 * - **Once per world and tone**: up to four tracks a world, kept in the Cache API (`rpg-music`), so
 *   a new quest of a tone this world has had plays at once and costs nothing. This browser only;
 *   another device composes its own.
 * - **Priced from the length**: ElevenLabs bills music per generation, ~900 credits a minute
 *   (pricing page, Oct 2026: "Eleven Music 900 credits per minute", $0.15 a minute on the API price
 *   list), or the response's own `character-cost` where the browser may read it.
 * - **Played through Web Audio**, not an `<audio>` element: iOS ignores `volume` on a media element,
 *   so the music could not sit under the voices there. One AudioContext, resumed inside the Start
 *   click (the same iOS rule as `voice.ts`'s `primeVoice`), two buffer sources crossfading at every
 *   loop so its seam is never heard, and a master gain that ducks while somebody speaks.
 */

import type { WorldBible } from './genesis';
import type { Tone } from './quest';
import { endRequest, startRequest, updateRequest } from './devlog';
import { MUSIC_CREDITS_PER_MINUTE } from './cost';

/** The newest model first; a key or plan that may not use it falls back to v1 for the session. */
export const MUSIC_MODEL = 'music_v2_5';
export const MUSIC_FALLBACK = 'music_v1';

/** Two minutes: long enough that the loop is not noticed on a walk, ~1,800 credits a track. */
export const MUSIC_MS = 120_000;

/** What each tone sounds like, said to the model after the world. */
export const TONE_MUSIC: Record<Tone, string> = {
  light: 'warm, gentle and unhurried, the calm of an ordinary good day',
  comic: 'playful and light-footed, a little mischievous, with a wink',
  adventure: 'adventurous, wonder and quiet momentum, curiosity about what lies ahead',
  grim: 'melancholic and tense, sparse, low drones and a sense of foreboding',
};

/** The rules every track gets: it is a background score, and it must loop. */
const RULES =
  'Instrumental only, no vocals, no choir singing words. Background score for exploring an open-world RPG: ' +
  'steady and unobtrusive, sitting under spoken dialogue, no big drops, no sudden stops, no fade-out. ' +
  'A seamless loop that ends the way it begins.';

const TIME: Record<WorldBible['look']['time'], string> = {
  dawn: 'at dawn',
  day: 'by day',
  dusk: 'at dusk',
  night: 'at night',
};

const WEATHER: Record<WorldBible['look']['weather'], string | null> = {
  none: null,
  rain: 'rain-soaked',
  snow: 'wintry and cold',
  ash: 'smouldering and desolate',
  spores: 'eerie and organic',
  sparks: 'industrial and electric',
};

const FLORA: Record<WorldBible['look']['flora'], string | null> = {
  pines: 'among pine woods',
  broadleaf: 'among leafy woods',
  dead: 'among dead trees',
  fungi: 'among giant fungi, otherworldly',
  spires: 'among crystal spires, alien',
  none: null,
};

/**
 * The world in a sentence a music model can use. A world with its own `music` line has it; one from
 * before is described from its look in English and its bible as written (perhaps Polish, which the
 * model reads, if less surely).
 */
export function worldMusic(world: WorldBible): string {
  if (world.music) return world.music;
  const look = world.look;
  const mood = [WEATHER[look.weather], look.water === 'flooded' ? 'watery' : null, FLORA[look.flora], TIME[look.time]]
    .filter(Boolean)
    .join(', ');
  const setting = [world.tone, world.tech, world.climate].filter(Boolean).join('; ');
  return `Score for a world that feels ${mood}.${setting ? ` Its tone, technology and climate: "${setting}".` : ''}`;
}

/** The whole prompt: the world, the quest's tone, the rules. */
export function musicPrompt(world: WorldBible, tone: Tone | null): string {
  return [worldMusic(world), tone ? `Mood: ${TONE_MUSIC[tone]}.` : null, RULES].filter(Boolean).join(' ');
}

/** A track's credits: ElevenLabs' own count where its response says, else the list rate for its length. */
export function musicCredits(ms: number, header: string | null): number {
  const charged = header === null ? NaN : Number(header);
  return Number.isFinite(charged) && charged > 0 ? charged : (ms / 60_000) * MUSIC_CREDITS_PER_MINUTE;
}

/** Statuses that say this model is not for this key or plan, rather than that the request was bad. */
function refused(status: number): boolean {
  return status === 400 || status === 403 || status === 422;
}

let model = MUSIC_MODEL;
/** A refusal that will hold all session (no key, no paid plan, no credits): no more asking. */
let musicOff = false;

const CACHE = 'rpg-music';
const tracks = new Map<string, Promise<ArrayBuffer>>();

function cacheUrl(worldId: string, tone: Tone | null): string {
  const origin = typeof location === 'undefined' ? 'https://korczak.xyz' : location.origin;
  return `${origin}/__rpg-music/${encodeURIComponent(worldId)}/${tone ?? 'any'}/${MUSIC_MS}`;
}

async function cached(url: string): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const hit = await (await caches.open(CACHE)).match(url);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function keep(url: string, bytes: ArrayBuffer): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await (await caches.open(CACHE)).put(url, new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } }));
  } catch {
    /* composed again next time */
  }
}

/** Into the console like a clip, under its own kind so its price stands apart from the voices. */
async function compose(key: string, prompt: string, label: string): Promise<ArrayBuffer> {
  const entry = startRequest('music', model, null, prompt, label);
  try {
    const ask = (m: string) =>
      fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, music_length_ms: MUSIC_MS, model_id: m, force_instrumental: true }),
      });
    let response = await ask(model);
    if (!response.ok && model !== MUSIC_FALLBACK && refused(response.status)) {
      // v2.5 would not: v1, for this track and the rest of the session.
      const was = `${model} ${response.status}`;
      model = MUSIC_FALLBACK;
      updateRequest(entry, { model: `${model} (${was})` });
      response = await ask(model);
    }
    if (!response.ok) {
      if ([401, 402, 403].includes(response.status)) musicOff = true;
      const error = await response.json().catch(() => ({}));
      const detail = error?.detail;
      throw new Error(
        (typeof detail === 'string' ? detail : detail?.message ?? (Array.isArray(detail) ? detail[0]?.msg : null)) ||
          `ElevenLabs ${response.status}`,
      );
    }
    updateRequest(entry, { text: `${prompt}\n\n♪ downloading…` });
    const bytes = await response.arrayBuffer();
    endRequest(entry, null, {
      text: prompt,
      chars: Math.round(MUSIC_MS / 1000),
      credits: musicCredits(MUSIC_MS, response.headers.get('character-cost')),
    });
    return bytes;
  } catch (e) {
    endRequest(entry, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** The world's track for this tone: from this browser's cache, else composed once and kept. */
export function musicFor(key: string, world: WorldBible, tone: Tone | null): Promise<ArrayBuffer> {
  const url = cacheUrl(world.id, tone);
  let track = tracks.get(url);
  if (track) return track;
  track = (async () => {
    const hit = await cached(url);
    if (hit) return hit;
    if (musicOff) throw new Error('ElevenLabs refused music this session');
    const bytes = await compose(key, musicPrompt(world, tone), tone ?? 'music');
    await keep(url, bytes.slice(0));
    return bytes;
  })();
  tracks.set(url, track);
  // A failure is not kept: the next quest may well get its music.
  track.catch(() => tracks.delete(url));
  return track;
}

/* ---- Playing it ---- */

/** The loudness of the score, and under a voice. */
export const MUSIC_VOLUME = 0.32;
export const MUSIC_DUCKED = 0.12;
/** How long one pass of the loop fades into the next, and a new track into the old. */
const CROSSFADE_S = 4;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ducked = false;
let playing: { id: string; stop: () => void } | null = null;
const decoded = new Map<string, Promise<AudioBuffer>>();

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = ducked ? MUSIC_DUCKED : MUSIC_VOLUME;
  master.connect(ctx.destination);
  return ctx;
}

/** Call from inside a click: iOS starts an AudioContext only from a gesture. */
export function primeMusic(): void {
  const c = context();
  if (c && c.state !== 'running') void c.resume().catch(() => {});
}

/** Lower the score while somebody speaks, raise it after. */
export function duckMusic(on: boolean): void {
  if (ducked === on) return;
  ducked = on;
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(on ? MUSIC_DUCKED : MUSIC_VOLUME, ctx.currentTime, 0.4);
}

/** A hidden page stops the score where it is; coming back goes on from there. */
export function pauseMusic(paused: boolean): void {
  if (!ctx) return;
  if (paused) void ctx.suspend().catch(() => {});
  else if (playing) void ctx.resume().catch(() => {});
}

/** Fades out whatever is playing. */
export function stopMusic(): void {
  playing?.stop();
  playing = null;
}

/** What is playing now: the world and tone's id, or null. */
export function playingMusic(): string | null {
  return playing?.id ?? null;
}

/**
 * Plays a track as an endless loop, each pass crossfading into the next, fading in over what played
 * before (which fades out). The same id again does nothing.
 */
export async function playMusic(id: string, bytes: ArrayBuffer): Promise<void> {
  if (playing?.id === id) return;
  const c = context();
  if (!c || !master) return;
  let buffer = decoded.get(id);
  if (!buffer) {
    buffer = c.decodeAudioData(bytes.slice(0));
    decoded.set(id, buffer);
    buffer.catch(() => decoded.delete(id));
  }
  const audio = await buffer;
  // Something else was asked for while it decoded.
  if (playing?.id === id) return;
  stopMusic();
  if (c.state !== 'running') void c.resume().catch(() => {});
  const out = master;
  const fade = Math.min(CROSSFADE_S, audio.duration / 4);
  const live = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const pass = (at: number) => {
    if (stopped) return;
    const src = c.createBufferSource();
    src.buffer = audio;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + fade);
    const end = at + audio.duration;
    gain.gain.setValueAtTime(1, end - fade);
    gain.gain.linearRampToValueAtTime(0, end);
    src.connect(gain).connect(out);
    const node = { src, gain };
    live.add(node);
    src.onended = () => {
      live.delete(node);
      gain.disconnect();
    };
    src.start(at);
    const next = end - fade;
    // Scheduled a couple of seconds ahead, on the context's own clock.
    timer = setTimeout(() => pass(next), Math.max(0, (next - c.currentTime - 2) * 1000));
  };
  pass(c.currentTime + 0.05);
  playing = {
    id,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const now = c.currentTime;
      for (const { src, gain } of live) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 2);
        try {
          src.stop(now + 2.1);
        } catch {
          /* already stopped */
        }
      }
    },
  };
}

/** The id `playMusic` and `musicFor` agree on for a world and tone. */
export function musicId(worldId: string, tone: Tone | null): string {
  return `${worldId}|${tone ?? 'any'}`;
}

/** The score's switch, kept per browser (`rpg-music`, `'0'` when off); on unless turned off. */
const ON_KEY = 'rpg-music';

export function loadMusicOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveMusicOn(on: boolean): void {
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0');
  } catch {
    /* on again next time */
  }
}
