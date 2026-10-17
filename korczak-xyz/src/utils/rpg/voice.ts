/*
 * The quest giver's voice: ElevenLabs on the reader's own key from the account store.
 *
 * One `<audio>` element for the life of the tab, primed inside the Start click, for the reason
 * `utils/backseat/speech.ts` gives at length: iOS unlocks the element a gesture touched, not the
 * page, so a fresh `new Audio()` built after a fetch is refused. Clips are cached by text, so
 * walking back through a dialogue does not pay for the same line twice.
 */

import type { Lang } from './quest';

/** Their low-latency model; it speaks Polish and English with the same voices. */
export const VOICE_MODEL = 'eleven_flash_v2_5';

/** Premade voices every ElevenLabs account has: George and Rachel. */
export const VOICES = {
  male: 'JBFqnCBsd6RMkjVDRZzb',
  female: '21m00Tcm4TlvDq8ikWAM',
} as const;

export type VoiceGender = keyof typeof VOICES;

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

async function fetchClip(key: string, text: string, gender: VoiceGender, lang: Lang): Promise<string> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICES[gender]}?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
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
  return URL.createObjectURL(await response.blob());
}

/**
 * Speaks one line, stopping whatever was speaking. Resolves when it has been started (or skipped
 * because a newer line replaced it); rejects with the provider's reason.
 */
export async function speakLine(
  key: string,
  text: string,
  gender: VoiceGender,
  lang: Lang,
): Promise<void> {
  stopVoice();
  const el = element();
  if (!el) return;
  const controller = new AbortController();
  current = controller;

  const cacheKey = `${gender}:${lang}:${text}`;
  let clip = clips.get(cacheKey);
  if (!clip) {
    clip = fetchClip(key, text, gender, lang);
    clips.set(cacheKey, clip);
    // A failed request is not cached: the next attempt may well work.
    clip.catch(() => clips.delete(cacheKey));
  }
  const url = await clip;
  if (controller.signal.aborted) return;
  el.src = url;
  await el.play();
}
