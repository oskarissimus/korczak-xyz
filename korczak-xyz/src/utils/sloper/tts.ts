/*
 * The narration, from ElevenLabs.
 *
 * Two things here are not obvious and both change how the video sounds:
 *
 * `previous_text` / `next_text`. Each scene is a separate request, so without them the model
 * reads every scene as a standalone sentence — full stop, breath, restart — and the cuts between
 * scenes sound like six people reading six cards. Given the neighbouring scripts it carries the
 * prosody across. Neither is billed; only `text` is.
 *
 * `/with-timestamps`. The response carries a character-level alignment, which is turned into word
 * timings here. It is not for subtitles: the last word's end time is the scene's audio duration,
 * and *that* is how long the scene's image is held on screen at assembly. Falling back to an
 * `<audio>` element's `duration` works but needs a decode and a round trip through the DOM, so it
 * is only used when the alignment is missing.
 */

import { ConcurrencyLimiter } from './concurrency';
import type { WordTiming } from './types';

export interface TtsOptions {
  text: string;
  voiceId: string;
  model: string;
  speed: number;
  previousText?: string;
  nextText?: string;
}

export interface TtsResult {
  data: Blob;
  dataUrl: string;
  duration: number;
  timing?: { words: WordTiming[]; totalDuration: number };
}

/** ElevenLabs' concurrency ceiling is per plan, so the width is a setting rather than a constant. */
export function createTtsLimiter(maxConcurrent: number): ConcurrencyLimiter {
  return new ConcurrencyLimiter(Math.max(1, Math.min(10, maxConcurrent)));
}

export async function generateTtsAudio(
  apiKey: string,
  options: TtsOptions,
  signal?: AbortSignal,
): Promise<TtsResult> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/with-timestamps`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        text: options.text,
        model_id: options.model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: options.speed },
        previous_text: options.previousText,
        next_text: options.nextText,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail?.message || `TTS generation failed: ${response.status}`);
  }

  const result = await response.json();

  const audioBase64: string = result.audio_base64;
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mpeg' });

  const timing = wordsFromAlignment(result.alignment);
  const duration = timing?.totalDuration || (await getAudioDuration(blob));

  return {
    data: blob,
    dataUrl: `data:audio/mpeg;base64,${audioBase64}`,
    duration,
    timing,
  };
}

interface Alignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

/** Characters into words, splitting on spaces and closing the last word at the end of the array. */
export function wordsFromAlignment(
  alignment: Alignment | undefined,
): { words: WordTiming[]; totalDuration: number } | undefined {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!chars || !starts || !ends) return undefined;

  const words: WordTiming[] = [];
  let current = '';
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const isLast = i === chars.length - 1;

    if (char === ' ' || isLast) {
      if (isLast && char !== ' ') {
        if (current === '') wordStart = starts[i];
        current += char;
        wordEnd = ends[i];
      }
      if (current.trim()) words.push({ word: current.trim(), start: wordStart, end: wordEnd });
      current = '';
      wordStart = ends[i];
    } else {
      if (current === '') wordStart = starts[i];
      current += char;
      wordEnd = ends[i];
    }
  }

  return { words, totalDuration: words.length > 0 ? words[words.length - 1].end : 0 };
}

/** Duration via the media element, for the case where no alignment came back. */
export function getAudioDuration(audioBlob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(audioBlob);

    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the generated audio'));
    };

    audio.src = url;
  });
}
