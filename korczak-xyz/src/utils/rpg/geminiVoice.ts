/*
 * The characters' voices on Gemini's TTS (owner, 27 Nov 2026: "switch to Gemini Flash; keep the
 * setting in Settings but Gemini Flash the default"). Measured that day on a real line of Magister
 * Elara's (150 characters, Polish): 3.4–4.0 s for the whole clip on `gemini-3.8-flash-tts`, ~250 audio
 * tokens, $0.0023 at $9 per million (doubling on 1 Jan 2027) — about a quarter of ElevenLabs' Flash on
 * its API pricing, and the audio tags (`[sighs]`) are acted rather than read, on the same model.
 *
 * - **No developer instruction**: the 3.8 TTS models refuse `systemInstruction` (400 "Developer
 *   instruction is not enabled for this model"), and a style sentence in the text is read out loud.
 *   So the character's manner travels the way the tags do, as one bracketed direction at the start of
 *   the line (`[anxious, hurried]`), taken from the `Emotion:` the model wrote in their voice.
 * - **Prebuilt voices**, chosen by gender and age and then by the name's hash, so a character keeps
 *   theirs across lines, quests and reloads; the hero always the same one.
 * - **PCM back**: 16-bit little-endian mono at 24 kHz, base64 in the JSON. `pcmToWav` puts a RIFF
 *   header on it, which every browser's `<audio>` plays, iOS included.
 */

import type { VoiceWho } from './voicePick';

/** The default voice engine's model; Flash-Lite is the cheaper sibling ($6 against $9 per 1M audio tokens). */
export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';

export type VoiceEngine = 'gemini' | 'elevenlabs';
export const DEFAULT_VOICE_ENGINE: VoiceEngine = 'gemini';

export function voiceEngineOf(stored: string | null): VoiceEngine {
  return stored === 'elevenlabs' ? 'elevenlabs' : DEFAULT_VOICE_ENGINE;
}

/**
 * Gemini's prebuilt voices by gender (their speech-generation guide), split by how old they sound to
 * the ear: the "youthful", "upbeat" and "bright" ones young, "mature" and "gravelly" old.
 */
const VOICES = {
  female: {
    young: ['Leda', 'Zephyr', 'Autonoe', 'Laomedeia'],
    middle_aged: ['Kore', 'Aoede', 'Callirrhoe', 'Despina', 'Erinome', 'Pulcherrima', 'Vindemiatrix', 'Achernar'],
    old: ['Gacrux', 'Sulafat'],
  },
  male: {
    young: ['Puck', 'Fenrir', 'Sadachbia', 'Achird'],
    middle_aged: [
      'Charon',
      'Orus',
      'Iapetus',
      'Umbriel',
      'Algieba',
      'Schedar',
      'Zubenelgenubi',
      'Alnilam',
      'Enceladus',
    ],
    old: ['Algenib', 'Rasalgethi', 'Sadaltager'],
  },
} as const;

/** The hero, and the narrator-like fallbacks when a line has no character. */
export const GEMINI_VOICES = {
  player: 'Orus',
  male: 'Charon',
  female: 'Kore',
} as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The voice a line is spoken in: the hero's own, else the character's by gender, age and name. */
export function geminiVoiceFor(voice: keyof typeof GEMINI_VOICES, who?: VoiceWho): string {
  if (voice === 'player' || !who) return GEMINI_VOICES[voice];
  const list = VOICES[who.gender][who.age ?? 'middle_aged'];
  return list[hash(who.name) % list.length];
}

/**
 * The manner the line is said in, as a bracketed direction: the `Emotion:` of the voice the model
 * described ("Native Polish. Female, 40s. Persona: … Emotion: Anxious, hurried. …"), lower-cased,
 * at most six words. Nothing when there is none.
 */
export function mannerTag(description: string | undefined): string {
  const m = /emotion\s*:\s*([^.\n]+)/i.exec(description ?? '');
  if (!m) return '';
  const words = m[1]
    .replace(/[[\]()]/g, '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 6)
    .join(' ');
  return words ? `[${words}] ` : '';
}

/** The request for one clip, through the gateway like any other Google request (`apiFetch`). */
export function geminiSpeechRequest(
  key: string,
  voiceName: string,
  text: string,
  model: string = GEMINI_TTS_MODEL,
): [string, { method: 'POST'; headers: Record<string, string>; body: string }] {
  return [
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    },
  ];
}

export interface GeminiClip {
  pcm: Uint8Array;
  rate: number;
  usage: { input: number; output: number; thoughts: number };
}

/** The audio out of Gemini's answer, or an error saying why there is none. */
export function geminiClipOf(json: unknown): GeminiClip {
  const answer = json as {
    candidates?: {
      content?: {
        parts?: { inlineData?: { data?: string; mimeType?: string } }[];
      };
      finishReason?: string;
    }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };
  const candidate = answer?.candidates?.[0];
  const part = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error(`Gemini TTS: no audio (${candidate?.finishReason ?? 'empty answer'})`);
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1]) || 24_000;
  const u = answer.usageMetadata ?? {};
  return {
    pcm: base64Bytes(part.inlineData.data),
    rate,
    usage: {
      input: u.promptTokenCount ?? 0,
      output: u.candidatesTokenCount ?? 0,
      thoughts: u.thoughtsTokenCount ?? 0,
    },
  };
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The clip as something an `<audio>` plays. Google's docs describe raw 16-bit PCM (`audio/L16;…rate=24000`),
 * which needs a header; on 27 Nov 2026 `gemini-3.8-flash-tts` answered `audio/wav` with the RIFF header
 * already on. Either is taken, by the bytes rather than the label.
 */
export function clipBlob(clip: GeminiClip): Blob {
  const b = clip.pcm;
  const riff = b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  return riff ? new Blob([b as BlobPart], { type: 'audio/wav' }) : pcmToWav(b, clip.rate);
}

/** 16-bit mono PCM with a RIFF/WAVE header in front. */
export function pcmToWav(pcm: Uint8Array, rate: number): Blob {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, pcm.length, true);
  return new Blob([header, pcm as BlobPart], { type: 'audio/wav' });
}
