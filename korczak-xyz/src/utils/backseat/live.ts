/*
 * Gemini Live: the photograph goes in and the voice comes out, over one WebSocket.
 *
 * The other two engines are a chain — a vision call writes the sentence, then a speech engine
 * reads it — and the wait before the first word is the sum of both. Here a native-audio model
 * looks at the frame and answers in speech directly, streamed as raw PCM, and the first chunk is
 * played the moment it lands. Asked for by the owner in Oct 2026 after the chain had already been
 * cut down (`backseat.md`, *The wait from photograph to voice*).
 *
 * WHAT IT GIVES UP, which is why it is a third engine and not a replacement:
 *
 *  - **The text is a transcript of audio already playing.** `sanitizeRemark` and the repeat drop
 *    cannot stop anything before it is heard; they only tidy what is shown and remembered. A
 *    native-audio model does not read asterisks aloud the way a synthesiser would, and the prompt
 *    still forbids them, but the code no longer has the last word.
 *  - **Google's voices, not ElevenLabs'.** One of the prebuilt `LIVE_VOICES`.
 *  - **The rate slider does nothing.** Raw PCM sped up is a chipmunk; the model is asked for pace
 *    in words instead, if at all.
 *
 * ONE SESSION PER REMARK, OPENED EARLY. A Live session keeps everything it has been sent, so a
 * ride on one session would carry every earlier frame into every later answer, slower and dearer
 * each round, and the per-round system prompt (the angle, the last six remarks) could not change.
 * So each remark gets a fresh session — and since the handshake and `setup` are a round trip or
 * two of pure waiting, the ride opens the next one (`prepareLive`) while the current remark is
 * still being spoken, with the next round's prompt already in it. By the time the snapshot is
 * taken the socket is open and set up, and the only wait left is the model's.
 *
 * THE AUDIO IS WEB AUDIO, AND IT HAS ITS OWN iOS UNLOCK. PCM chunks are scheduled back to back on
 * one `AudioContext`, which, like the clip element in `speech.ts`, must be created and started
 * inside a real gesture or iOS keeps it suspended for ever. `primeLiveAudio` is that, and it is
 * called from the Start and Test handlers beside `primeVoices`. It also sets
 * `navigator.audioSession.type = 'playback'` where it exists (iOS 17+): Web Audio otherwise plays
 * as "ambient" and the ring/silent switch mutes it, which in a car reads as a broken app.
 */

import { VisionError } from './vision';
export { DEFAULT_LIVE_MODEL, DEFAULT_LIVE_VOICE } from './defaults';
import type { Frame } from './types';

/** Google's prebuilt voices, which every Live model takes. */
export const LIVE_VOICES = [
  'Kore',
  'Puck',
  'Charon',
  'Fenrir',
  'Aoede',
  'Leda',
  'Orus',
  'Zephyr',
  'Autonoe',
  'Callirrhoe',
  'Despina',
  'Enceladus',
  'Erinome',
  'Gacrux',
  'Iapetus',
  'Laomedeia',
  'Pulcherrima',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zubenelgenubi',
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Rasalgethi',
] as const;

const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** Same warmth as the Gemini vision call (`vision.ts`), for the same reason. */
const LIVE_TEMPERATURE = 1.3;

/** Room for one sentence of speech: audio tokens are ~25 a second, and a remark is under ten. */
const LIVE_MAX_TOKENS = 600;

/** A session that never says `setupComplete` is a dead one; a ride should not wait on it. */
const SETUP_TIMEOUT_MS = 10000;

/** From the frame being sent to the first sound, beyond which the round gives up. */
const ANSWER_TIMEOUT_MS = 20000;

// --- the model list ------------------------------------------------------------------------

/**
 * Models a key can open a Live session on: anything that takes `bidiGenerateContent`. Native audio
 * first — it is the one that speaks rather than reading its own text aloud — and newest first
 * within each, by name, which is how Google dates them.
 */
export function filterLiveModels(
  models: { name: string; supportedGenerationMethods?: string[] }[],
): string[] {
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('bidiGenerateContent'))
    .map((m) => m.name.replace('models/', ''))
    .sort((a, b) => {
      const na = a.includes('native-audio') ? 0 : 1;
      const nb = b.includes('native-audio') ? 0 : 1;
      return na - nb || b.localeCompare(a);
    });
}

export async function fetchLiveModels(
  apiKey: string,
): Promise<{ success: boolean; models: string[]; error?: string }> {
  if (!apiKey.trim()) return { success: false, models: [], error: 'API key is required' };
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
    );
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) {
        return { success: false, models: [], error: 'Invalid Google API key' };
      }
      return { success: false, models: [], error: `API error: ${response.status}` };
    }
    const data = await response.json();
    return { success: true, models: filterLiveModels(data?.models ?? []) };
  } catch (err) {
    return {
      success: false,
      models: [],
      error: err instanceof Error ? err.message : 'Network error fetching models',
    };
  }
}

// --- the audio ------------------------------------------------------------------------------

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** Wake the Web Audio half from inside a gesture. Never throws and never awaits. */
export function primeLiveAudio(): void {
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {
    /* Older iOS and every other browser: nothing to set. */
  }
  const ctx = audioContext();
  if (!ctx) return;
  try {
    void ctx.resume().catch(() => undefined);
    // A real (silent) buffer started inside the gesture, which is what iOS counts.
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* Reported when it is used, not here. */
  }
}

/** Little-endian 16-bit PCM, base64, to the floats Web Audio wants. */
export function pcmToFloat(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const samples = new Float32Array(new ArrayBuffer(Math.floor(binary.length / 2) * 4));
  for (let i = 0; i < samples.length; i += 1) {
    const lo = binary.charCodeAt(2 * i);
    const hi = binary.charCodeAt(2 * i + 1);
    let value = (hi << 8) | lo;
    if (value >= 0x8000) value -= 0x10000;
    samples[i] = value / 0x8000;
  }
  return samples;
}

/** `audio/pcm;rate=24000` → 24000. Live has always said 24 kHz, so that is the fallback. */
export function pcmRate(mimeType: string | undefined): number {
  const match = /rate=(\d+)/.exec(mimeType ?? '');
  return match ? Number(match[1]) : 24000;
}

// --- the session ----------------------------------------------------------------------------

export interface LiveSettings {
  apiKey: string;
  model: string;
  voice: string;
  system: string;
}

export interface LiveAsk {
  /** None for the setup sheet's Test button, which asks for a line rather than a look. */
  frame: Frame | null;
  user: string;
  /** Aborts everything: Stop, a settings change, teardown. */
  signal?: AbortSignal;
  /** Stops the voice and ends the remark early, but is not a failure: the Hush button. */
  hush?: AbortSignal;
  /** The first sound, as it is scheduled to play. */
  onStart?: () => void;
  /** The transcript so far, each time it grows. */
  onText?: (soFar: string) => void;
}

export interface LiveAnswer {
  /** What the model said, as Google transcribed it. Empty if it said nothing. */
  text: string;
  /** Whether any audio was played. */
  spoke: boolean;
}

/**
 * Models that answered `thinkingConfig` in `setup` with a refusal. Live models differ on whether
 * they think at all; asking for none is the latency point, and one that will not take the field
 * is asked again without it and remembered, the same shape as `NO_MINIMAL` in `vision.ts`.
 */
const NO_THINKING_CONFIG = new Set<string>();

function closeError(event: CloseEvent): VisionError {
  const reason = event.reason || `Live connection closed (${event.code})`;
  // Google closes with 1007/1008 and the reason in words; a key it rejects says "API key".
  const status = /api key|permission|denied|unauthori/i.test(reason) ? 403 : null;
  return new VisionError(reason, status);
}

/** Server messages arrive as Blobs in browsers and as strings elsewhere. */
async function messageJson(data: unknown): Promise<Record<string, unknown> | null> {
  try {
    const text =
      typeof data === 'string'
        ? data
        : data instanceof Blob
          ? await data.text()
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : '';
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * One Live session, set up and waiting for exactly one remark.
 *
 * Open it early (`prepareLive`), then `ask` once. It closes itself when the remark has been heard,
 * and `close` is safe to call at any point, any number of times.
 */
export class LiveSession {
  readonly settings: LiveSettings;
  readonly ready: Promise<void>;
  private socket: WebSocket | null = null;
  private listener: ((message: Record<string, unknown>) => void) | null = null;
  private closedWith: VisionError | null = null;
  private onClosed: ((error: VisionError) => void) | null = null;
  private used = false;

  constructor(settings: LiveSettings) {
    this.settings = settings;
    this.ready = this.open(!NO_THINKING_CONFIG.has(settings.model)).catch(async (e) => {
      if (
        e instanceof VisionError &&
        /thinking/i.test(e.message) &&
        !NO_THINKING_CONFIG.has(settings.model)
      ) {
        NO_THINKING_CONFIG.add(settings.model);
        return this.open(false);
      }
      throw e;
    });
    // A session prepared and never used must not leave an unhandled rejection behind it.
    this.ready.catch(() => undefined);
  }

  /** Open and set up; resolves on `setupComplete`. */
  private open(withThinkingConfig: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { apiKey, model, voice, system } = this.settings;
      let socket: WebSocket;
      try {
        socket = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(apiKey)}`);
      } catch (e) {
        reject(new VisionError(e instanceof Error ? e.message : 'Live connection failed', null));
        return;
      }
      this.socket = socket;
      this.closedWith = null;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new VisionError('Gemini Live did not answer the setup.', null));
      }, SETUP_TIMEOUT_MS);

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            setup: {
              model: `models/${model}`,
              generationConfig: {
                responseModalities: ['AUDIO'],
                temperature: LIVE_TEMPERATURE,
                maxOutputTokens: LIVE_MAX_TOKENS,
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                ...(withThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
              },
              systemInstruction: { parts: [{ text: system }] },
              // The words, for the screen, the history and the saved record — see the header.
              outputAudioTranscription: {},
            },
          }),
        );
      };

      socket.onmessage = (event) => {
        void messageJson(event.data).then((message) => {
          if (!message) return;
          if (!settled && 'setupComplete' in message) {
            settled = true;
            clearTimeout(timer);
            resolve();
            return;
          }
          this.listener?.(message);
        });
      };

      socket.onerror = () => {
        /* Every error is followed by a close, which carries the reason. */
      };

      socket.onclose = (event) => {
        const error = closeError(event);
        this.closedWith = error;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
          return;
        }
        this.onClosed?.(error);
      };
    });
  }

  /** Whether this session can still take its one remark. */
  get usable(): boolean {
    return (
      !this.used && this.closedWith === null && this.socket?.readyState !== WebSocket.CLOSED
    );
  }

  close(): void {
    this.listener = null;
    this.onClosed = null;
    try {
      this.socket?.close();
    } catch {
      /* Already closed. */
    }
  }

  /**
   * Send the frame, play the answer as it streams, and resolve once the last sample has played
   * (or the Hush button was pressed). Rejects with a `VisionError` on a failure, or an
   * `AbortError` on `signal`.
   */
  async ask(request: LiveAsk): Promise<LiveAnswer> {
    if (this.used) throw new Error('A Live session takes one remark.');
    this.used = true;

    const abortError = () => new DOMException('Aborted', 'AbortError');
    if (request.signal?.aborted) {
      this.close();
      throw abortError();
    }

    await this.ready;
    if (this.closedWith) throw this.closedWith;

    const ctx = audioContext();
    if (!ctx) {
      this.close();
      throw new Error('This browser cannot play Gemini Live audio.');
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const sources: AudioBufferSourceNode[] = [];
    let playAt = 0;
    let started = false;
    let text = '';

    try {
      return await new Promise<LiveAnswer>((resolve, reject) => {
        let finished = false;
        let endTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          clearTimeout(answerTimer);
          if (endTimer) clearTimeout(endTimer);
          request.signal?.removeEventListener('abort', onAbort);
          request.hush?.removeEventListener('abort', onHush);
          this.close();
        };
        const stopAudio = () => {
          for (const source of sources) {
            try {
              source.stop();
            } catch {
              /* Not started, or already ended. */
            }
          }
        };
        const done = (answer: LiveAnswer) => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve(answer);
        };
        const fail = (error: Error) => {
          if (finished) return;
          finished = true;
          stopAudio();
          cleanup();
          reject(error);
        };

        const answerTimer = setTimeout(() => {
          if (!started) fail(new VisionError('Gemini Live took too long to answer.', null));
        }, ANSWER_TIMEOUT_MS);

        const onAbort = () => fail(abortError());
        const onHush = () => {
          stopAudio();
          done({ text: text.trim(), spoke: started });
        };
        request.signal?.addEventListener('abort', onAbort, { once: true });
        request.hush?.addEventListener('abort', onHush, { once: true });

        /** Resolve when what has been scheduled has played. */
        const finishWhenPlayed = () => {
          const remaining = Math.max(0, playAt - ctx.currentTime);
          endTimer = setTimeout(
            () => done({ text: text.trim(), spoke: started }),
            remaining * 1000 + 50,
          );
        };

        let turnComplete = false;
        this.onClosed = (error) => {
          // Closed after the turn: the audio already here still plays out.
          if (turnComplete) return;
          if (started) finishWhenPlayed();
          else fail(error);
        };

        this.listener = (message) => {
          const content = message.serverContent as
            | {
                modelTurn?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
                outputTranscription?: { text?: string };
                turnComplete?: boolean;
                interrupted?: boolean;
              }
            | undefined;
          if (!content) return;

          for (const part of content.modelTurn?.parts ?? []) {
            const data = part.inlineData?.data;
            if (!data || !part.inlineData?.mimeType?.startsWith('audio/')) continue;
            const samples = pcmToFloat(data);
            if (samples.length === 0) continue;
            const buffer = ctx.createBuffer(1, samples.length, pcmRate(part.inlineData.mimeType));
            buffer.copyToChannel(samples, 0);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            // Back to back, with a hair of headroom on the first so it is not clipped.
            playAt = Math.max(playAt, ctx.currentTime + (started ? 0 : 0.02));
            source.start(playAt);
            playAt += buffer.duration;
            sources.push(source);
            if (!started) {
              started = true;
              request.onStart?.();
            }
          }

          if (content.outputTranscription?.text) {
            text += content.outputTranscription.text;
            request.onText?.(text.trim());
          }

          if (content.turnComplete) {
            turnComplete = true;
            finishWhenPlayed();
          }
        };

        const parts: Record<string, unknown>[] = [];
        if (request.frame) {
          parts.push({
            inlineData: { mimeType: request.frame.mimeType, data: request.frame.base64 },
          });
        }
        parts.push({ text: request.user });
        this.socket?.send(
          JSON.stringify({
            clientContent: { turns: [{ role: 'user', parts }], turnComplete: true },
          }),
        );
      });
    } finally {
      this.listener = null;
      this.onClosed = null;
    }
  }
}

/** Open a session now, to be asked later. */
export function prepareLive(settings: LiveSettings): LiveSession {
  return new LiveSession(settings);
}

/** Whether a prepared session was set up for these settings and can still be used. */
export function sessionFits(session: LiveSession | null, settings: Omit<LiveSettings, 'system'>) {
  return (
    session !== null &&
    session.usable &&
    session.settings.apiKey === settings.apiKey &&
    session.settings.model === settings.model &&
    session.settings.voice === settings.voice
  );
}
