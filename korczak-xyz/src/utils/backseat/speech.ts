/*
 * Saying it out loud.
 *
 * Two engines, and the default is the free one. A phone already has a speech synthesiser; asking
 * somebody for a second API key and a second bill to hear "oh, slow down" is a bad trade, so
 * `device` is the default and ElevenLabs is the upgrade for anybody who wants a voice with a
 * personality to match the persona.
 *
 * FOUR THINGS ABOUT `speechSynthesis` THAT ARE NOT OPTIONAL, all of them learnt the hard way and
 * all of them iOS:
 *
 *  1. **The voice list is empty on the first read.** Chrome and Safari populate it asynchronously
 *     and fire `voiceschanged` when they have. A settings screen that reads it once at mount shows
 *     an empty dropdown for ever. `watchVoices` is the subscription that fixes it.
 *  2. **It has to be unlocked by a gesture.** The first utterance must be spoken inside a real
 *     user event or iOS silently ignores it — and every one after it. `primeSpeech` is called from
 *     the Start button's own handler for exactly this, and it speaks a single space, which is
 *     inaudible and still counts as the unlocking utterance.
 *  3. **It stops when the page is hidden, and does not resume.** A ride continues while the phone
 *     is on the dashboard with the screen off — that is the whole use — so the wake lock is held
 *     and anything queued while hidden is dropped rather than left to pile up and all play at once
 *     on the way back.
 *  4. **`onend` does not always fire.** A cancelled or interrupted utterance can leave the promise
 *     pending for ever, and a ride whose speaker never reports finishing stops speaking entirely.
 *     Every `speak` here is raced against a timeout derived from the length of the text.
 *
 * ElevenLabs has none of those problems and one of its own: it is an `<audio>` element, which on
 * iOS needs the same gesture unlocking. The same Start button covers it, because the element is
 * created and played from the same handler chain.
 */

import type { BackseatConfig } from './types';

export interface SpeakOptions {
  text: string;
  /** BCP-47, for the device synthesiser. ElevenLabs takes the language from the text. */
  lang: string;
  rate: number;
  signal?: AbortSignal;
}

/** What the settings screen shows in the device-voice dropdown. */
export interface DeviceVoice {
  uri: string;
  name: string;
  lang: string;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function listDeviceVoices(): DeviceVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis
    .getVoices()
    .map((voice) => ({ uri: voice.voiceURI, name: voice.name, lang: voice.lang }));
}

/**
 * The voice list, now and whenever the browser fills it in.
 *
 * Returns an unsubscribe. The immediate call is not redundant with the event: Chrome has the list
 * ready on a second page load and never fires `voiceschanged` at all, so a subscriber that waited
 * for the event would wait for ever on exactly the browsers where it works.
 */
export function watchVoices(onChange: (voices: DeviceVoice[]) => void): () => void {
  if (!speechSupported()) return () => {};

  const publish = () => onChange(listDeviceVoices());
  publish();

  window.speechSynthesis.addEventListener('voiceschanged', publish);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', publish);
}

/**
 * The voice to use: the one chosen if it is still installed, else the best match for the language,
 * else whatever the browser defaults to.
 *
 * "Still installed" is not hypothetical — voices come and go with OS updates and with the language
 * packs somebody has downloaded, and a saved `voiceURI` that no longer resolves makes the
 * synthesiser fall back to a voice in the wrong language, which reads Polish as English phonetics.
 */
export function pickVoice(
  voices: DeviceVoice[],
  preferredUri: string,
  lang: string,
): DeviceVoice | null {
  if (voices.length === 0) return null;

  const chosen = voices.find((voice) => voice.uri === preferredUri);
  if (chosen) return chosen;

  const prefix = lang.toLowerCase().slice(0, 2);
  return voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix)) ?? null;
}

/**
 * How long to wait for an utterance before giving up on it.
 *
 * Roughly 14 characters a second at normal rate, with a floor and a generous margin, because the
 * cost of guessing low is a remark cut off and the cost of guessing high is a few seconds of a
 * queue not advancing. It exists only because `onend` is unreliable; when the event fires, the
 * timeout is cleared and none of this arithmetic matters.
 */
export function speechTimeoutMs(text: string, rate: number): number {
  const seconds = (text.length / 14) * (1 / Math.max(0.5, rate));
  return Math.round(Math.max(4000, Math.min(30000, seconds * 1000 + 4000)));
}

/**
 * The unlocking utterance, spoken from inside a user gesture.
 *
 * A single space rather than an empty string: some engines drop an empty utterance without
 * treating it as the gesture-blessed one, which is the whole point of the call.
 */
export function primeSpeech(): void {
  if (!speechSupported()) return;
  try {
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  } catch {
    // An engine that refuses to be primed will refuse to speak, and the ride reports that when
    // it happens rather than before it has been tried.
  }
}

export function cancelSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* Nothing was speaking. */
  }
}

function speakWithDevice(options: SpeakOptions, voiceUri: string): Promise<void> {
  if (!speechSupported()) {
    return Promise.reject(new Error('This browser has no speech synthesiser.'));
  }

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.lang = options.lang;
    utterance.rate = options.rate;

    const voice = pickVoice(listDeviceVoices(), voiceUri, options.lang);
    if (voice) {
      const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voice.uri);
      if (match) utterance.voice = match;
    }

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };

    // The safety net described at the top of the file. Without it one missing `onend` stops the
    // ride speaking for the rest of the journey, with no error anywhere.
    const timer = setTimeout(() => finish(), speechTimeoutMs(options.text, options.rate));

    const onAbort = () => {
      cancelSpeech();
      finish();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    utterance.onend = () => finish();
    // `interrupted` and `canceled` arrive here too, and both are ordinary: they are what a Stop
    // button produces. Only a genuine synthesis failure is worth reporting.
    utterance.onerror = (event) => {
      const reason = (event as SpeechSynthesisErrorEvent).error;
      finish(
        reason === 'interrupted' || reason === 'canceled'
          ? undefined
          : new Error(`Speech failed: ${reason}`),
      );
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      finish(err instanceof Error ? err : new Error('Speech failed'));
    }
  });
}

/**
 * ElevenLabs, for anybody who wants the passenger to sound like a person.
 *
 * The plain `/text-to-speech/{voice}` endpoint, not sloper's `/with-timestamps`: that one exists
 * to hold a picture for exactly as long as the narration, and nothing here is timed against
 * anything. What comes back is an MP3, played through an `<audio>` element and revoked after.
 */
async function speakWithElevenLabs(options: SpeakOptions, apiKey: string, voiceId: string) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        text: options.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.4, similarity_boost: 0.75, speed: options.rate },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.detail?.message || `Voice generation failed: ${response.status}`);
  }

  const url = URL.createObjectURL(await response.blob());

  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(url);
      audio.playbackRate = 1;

      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };

      const onAbort = () => {
        audio.pause();
        finish();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      audio.onended = () => finish();
      audio.onerror = () => finish(new Error('The voice clip would not play.'));
      void audio.play().catch((err) => finish(err instanceof Error ? err : undefined));
    });
  } finally {
    // Always, including on an abort: one object URL per remark for an hour is a leak nobody would
    // look for in an app whose memory is supposed to be empty.
    URL.revokeObjectURL(url);
  }
}

/** One remark, spoken by whichever engine the settings name. Resolves when it has finished. */
export function speak(config: BackseatConfig, options: SpeakOptions): Promise<void> {
  if (config.voice.engine === 'elevenlabs') {
    const key = config.apiKeys.elevenLabs;
    if (!key) return Promise.reject(new Error('No ElevenLabs key.'));
    return speakWithElevenLabs(options, key, config.voice.voiceId);
  }
  return speakWithDevice(options, config.voice.deviceVoiceUri);
}

/**
 * The voices on an ElevenLabs account, and the key check that comes free with asking for them.
 *
 * Same principle as the model list: a key that fills the dropdown is a key that works, so there is
 * no separate validate button.
 */
export interface ElevenLabsVoice {
  id: string;
  name: string;
}

export interface VoiceListResult {
  success: boolean;
  voices: ElevenLabsVoice[];
  error?: string;
}

export async function fetchElevenLabsVoices(apiKey: string): Promise<VoiceListResult> {
  if (!apiKey.trim()) return { success: false, voices: [], error: 'API key is required' };

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, voices: [], error: 'Invalid ElevenLabs API key' };
      }
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        voices: [],
        error: error?.detail?.message || `API error: ${response.status}`,
      };
    }

    const data = await response.json();
    const voices = ((data?.voices ?? []) as { voice_id: string; name: string }[])
      .map((voice) => ({ id: voice.voice_id, name: voice.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, voices };
  } catch (err) {
    return {
      success: false,
      voices: [],
      error: err instanceof Error ? err.message : 'Network error fetching voices',
    };
  }
}
