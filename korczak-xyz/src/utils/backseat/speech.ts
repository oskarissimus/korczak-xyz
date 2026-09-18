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
 *     user event or iOS silently ignores it — and every one after it. `primeVoices` is called from
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
 * ELEVENLABS HAS NONE OF THOSE AND TWO OF ITS OWN, both of which shipped broken and produced
 * exactly one symptom between them: the device voice works and the ElevenLabs voice is silent.
 *
 *  1. **The unlock is per element, and the element must already exist when the gesture happens.**
 *     The first version built `new Audio(url)` after `await fetch(...)`, which is several seconds
 *     and one network round trip after the click that started the ride — so on iOS every clip was
 *     blocked before a sample of it played. Priming "an" audio element does not help either: iOS
 *     blesses the *element* a gesture touched, not the page. So there is exactly one
 *     `clipPlayer` for the life of the tab, it is created and played silently inside the Start
 *     handler by `primeVoices`, and every clip after that is the same element with a new `src`.
 *     The header comment used to claim the Start button covered this "because the element is
 *     created and played from the same handler chain". It was not, and it did not.
 *  2. **Their `speed` is a narrower range than ours.** The app's rate runs 0.5–2 because that is
 *     what a speech synthesiser takes; ElevenLabs accepts 0.7–1.2 and answers 422 to anything
 *     outside it — before a byte of audio is generated. So the request is clamped to what they
 *     accept and `playbackRate` makes up the difference, which is what the device engine was
 *     doing for the whole range anyway.
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

/*
 * THE ONE AUDIO ELEMENT.
 *
 * Every ElevenLabs clip plays through this, for the life of the tab, because iOS grants playback
 * to the element a user gesture touched rather than to the page. A fresh `new Audio()` per clip is
 * a fresh element nobody has tapped, and it is refused.
 */
let clipPlayer: HTMLAudioElement | null = null;

function clipElement(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!clipPlayer) {
    clipPlayer = new Audio();
    clipPlayer.preload = 'auto';
  }
  return clipPlayer;
}

/**
 * 50ms of silence, inline.
 *
 * It has to be a real decodable clip rather than an empty `src`: the element is unlocked by
 * actually beginning to play something inside the gesture, and an element that errored on a
 * missing source has played nothing. Muting it instead would be worse — iOS treats a muted play
 * as a muted play, and grants nothing for audible playback afterwards.
 */
const SILENT_CLIP =
  'data:audio/wav;base64,' +
  'UklGRhQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * Wake both engines from inside a user gesture.
 *
 * Called from the Start button's own handler, and from the Test button on the setup sheet, which
 * is why testing a voice also makes the first remark of the next ride audible.
 *
 * Nothing here is awaited and nothing throws: an engine that refuses to be primed will refuse to
 * speak, and the ride reports that when it happens rather than before it has been tried.
 */
export function primeVoices(): void {
  // The synthesiser: a single space rather than an empty string, because some engines drop an
  // empty utterance without treating it as the gesture-blessed one.
  if (speechSupported()) {
    try {
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      window.speechSynthesis.speak(utterance);
    } catch {
      /* Reported when it is actually used, not here. */
    }
  }

  // The clip player: begin a silent clip and stop it. What matters is that this element has now
  // played something inside a gesture; what it played is irrelevant.
  const player = clipElement();
  if (!player) return;
  try {
    player.src = SILENT_CLIP;
    const started = player.play();
    if (started) {
      void started
        .then(() => {
          player.pause();
          player.currentTime = 0;
        })
        .catch(() => {
          /* Desktop browsers that need no unlocking refuse this harmlessly. */
        });
    }
  } catch {
    /* Same. */
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

/** What ElevenLabs will accept in `voice_settings.speed`. Outside it the request is a 422. */
export const ELEVENLABS_MIN_SPEED = 0.7;
export const ELEVENLABS_MAX_SPEED = 1.2;

/**
 * The app's rate, split between the two things that can deliver it.
 *
 * The slider runs 0.5–2 because that is what a speech synthesiser takes, and ElevenLabs answers
 * 422 to anything outside 0.7–1.2 — before generating a byte, so the whole remark is lost rather
 * than merely spoken at the wrong speed. So their half is clamped to what they accept and the
 * element's `playbackRate` makes up the rest, which multiplies out to the rate that was asked
 * for. Within their range `playbackRate` stays 1 and the audio is untouched.
 */
export function splitSpeed(rate: number): { speed: number; playbackRate: number } {
  const wanted = Math.min(2, Math.max(0.5, Number.isFinite(rate) ? rate : 1));
  const speed = Math.min(ELEVENLABS_MAX_SPEED, Math.max(ELEVENLABS_MIN_SPEED, wanted));
  return { speed, playbackRate: wanted / speed };
}

/**
 * ElevenLabs, for anybody who wants the passenger to sound like a person.
 *
 * The plain `/text-to-speech/{voice}` endpoint, not sloper's `/with-timestamps`: that one exists
 * to hold a picture for exactly as long as the narration, and nothing here is timed against
 * anything. What comes back is an MP3, played through the one unlocked element at the top of this
 * file — never a fresh `new Audio()`, for the reason given there.
 */
async function speakWithElevenLabs(options: SpeakOptions, apiKey: string, voiceId: string) {
  const { speed, playbackRate } = splitSpeed(options.rate);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        text: options.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.4, similarity_boost: 0.75, speed },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.detail?.message ||
        error?.detail ||
        error?.message ||
        `Voice generation failed: ${response.status}`,
    );
  }

  const player = clipElement();
  if (!player) throw new Error('This browser will not play audio clips.');

  const url = URL.createObjectURL(await response.blob());

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };

      /*
       * The same safety net the synthesiser has, and it is needed here for a different reason.
       * There is one element, so anything that replaces its `src` mid-clip — the Test button
       * pressed during a ride, a second clip arriving somehow — drops the old clip without firing
       * `ended` or `error` on it. That promise would then never settle, and the round that is
       * awaiting it never schedules the next one: the passenger stops talking for good.
       */
      const timer = setTimeout(() => finish(), speechTimeoutMs(options.text, options.rate));

      const onAbort = () => {
        player.pause();
        finish();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      player.onended = () => finish();
      player.onerror = () => finish(new Error('The voice clip would not play.'));

      player.src = url;
      player.playbackRate = playbackRate;
      // `play()` rejects rather than throwing, and the rejection is the one worth reporting: on
      // iOS it is `NotAllowedError`, which means this element was never unlocked by a gesture.
      void player.play().catch((err) =>
        finish(err instanceof Error ? err : new Error('The voice clip would not play.')),
      );
    });
  } finally {
    // The element outlives the clip, so its handlers have to be taken off or the next clip
    // resolves the previous one's promise.
    player.onended = null;
    player.onerror = null;
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
