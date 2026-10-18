/*
 * The quest giver's voice: ElevenLabs on the reader's own key from the account store.
 *
 * One `<audio>` element for the life of the tab, primed inside the Start click, for the reason
 * `utils/backseat/speech.ts` gives at length: iOS unlocks the element a gesture touched, not the
 * page, so a fresh `new Audio()` built after a fetch is refused. Clips are cached by text, so
 * walking back through a dialogue does not pay for the same line twice.
 */

import { endRequest, startRequest, voiceCredits } from './devlog';
import type { Lang } from './quest';

/** Their low-latency model; it speaks Polish and English with the same voices. */
export const VOICE_MODEL = 'eleven_flash_v2_5';

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
  voice: VoiceName;
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
  const entry = startRequest('voice', `${VOICE_MODEL} · ${line.voice}`, null, line.text);
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICES[line.voice]}?output_format=mp3_44100_64`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: line.text,
          model_id: VOICE_MODEL,
          language_code: lang,
          voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        }),
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.detail?.message || error?.detail || `ElevenLabs ${response.status}`);
    }
    const url = URL.createObjectURL(await response.blob());
    endRequest(entry, null, {
      chars: line.text.length,
      credits: voiceCredits(line.text.length, response.headers.get('character-cost')),
    });
    return url;
  } catch (e) {
    endRequest(entry, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

function clipFor(key: string, line: SpokenLine, lang: Lang): Promise<string> {
  const cacheKey = `${line.voice}:${lang}:${line.text}`;
  let clip = clips.get(cacheKey);
  if (!clip) {
    clip = fetchClip(key, line, lang);
    clips.set(cacheKey, clip);
    // A failed request is not cached: the next attempt may well work.
    clip.catch(() => clips.delete(cacheKey));
  }
  return clip;
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
