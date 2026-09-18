/*
 * The ride: a camera, a timer, and one voice at a time.
 *
 * The whole app is this loop — take a frame, ask a model what an annoying passenger would say
 * about it, say it — and almost every line here is about the two ways that loop goes wrong.
 *
 * ONE ROUND AT A TIME, ALWAYS. The obvious implementation is `setInterval` firing a request every
 * fifteen seconds, and it is wrong in a way that only shows up on a bad connection: a vision call
 * that takes twenty seconds means the next one starts before the last has been spoken, and the
 * passenger ends up talking over itself with remarks about roads that are already behind you. So
 * the schedule is a chain of `setTimeout`s, each set only when the previous round has finished
 * SPEAKING — the interval is a gap between remarks, not a request rate.
 *
 * THE FRAME IS THE TRUTH AND IT SPOILS FAST. A remark is about a moment that is already gone by
 * the time it is spoken; the only question is how gone. Everything slow is therefore abortable and
 * the abort is taken at every exit — Stop, unmount, a settings change — because a request left in
 * flight resolves into a passenger commenting on a junction from two minutes ago.
 *
 * WHAT IS NOT KEPT. The remarks are state in this hook and nowhere else: no localStorage (the
 * budget argument in `utils/backseat/storage.ts`) and no Firestore (there is no second device that
 * wants to read what your passenger said on the way to the shops). The list is capped at
 * `MAX_REMARKS` for the same reason any in-memory log is — a three-hour drive is 700 remarks and
 * the screen shows six.
 *
 * WHY THE HIDDEN PAGE IS NOT AN ERROR. On iOS the camera stream is suspended the moment the app is
 * backgrounded or the screen locks, and `videoWidth` reads 0 until it resumes. That is the normal
 * state of a phone in a cradle, so a null frame retries shortly rather than stopping the ride —
 * and the wake lock is held precisely to make it rarer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { canStart } from '../utils/backseat/defaults';
import {
  cameraConstraints,
  cameraSupported,
  captureFrame,
  classifyCameraError,
  secureContext,
  type CameraFailure,
} from '../utils/backseat/frame';
import { isRepeat, recentTexts, sanitizeRemark, systemPrompt, USER_PROMPT } from '../utils/backseat/remarks';
import { cancelSpeech, primeSpeech, speak } from '../utils/backseat/speech';
import type { BackseatConfig, Remark, RideStatus } from '../utils/backseat/types';
import { askForRemark, VisionError } from '../utils/backseat/vision';
import { createWakeLock } from '../utils/wakeLock';

/** Six on screen, fifty in memory: enough to scroll back over the last quarter of an hour. */
const MAX_REMARKS = 50;

/** How soon to look again when the camera had no picture to give. */
const NO_FRAME_RETRY_MS = 2000;

/**
 * Consecutive provider failures before the ride gives up.
 *
 * Not one: a single 429 or a dropped connection in a tunnel is an ordinary event on a drive and
 * stopping for it would make the app unusable in exactly the place it is used. Not unlimited
 * either — a ride that goes on firing failing requests every fifteen seconds is spending somebody
 * else's rate limit to achieve silence.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

export type { RideStatus };

export interface RideApi {
  status: RideStatus;
  /** Attach to the `<video>`; the hook owns the stream. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Newest first, which is the order the screen reads in. */
  remarks: Remark[];
  /** The one being spoken, or the last one spoken. Null before the first. */
  current: Remark | null;
  speaking: boolean;
  /** Something worth a banner. Cleared by starting again. */
  error: string | null;
  /** A camera refusal, which needs a different sentence from a provider error. */
  cameraError: CameraFailure | null;
  start: () => void;
  stop: () => void;
  /** Shut the passenger up mid-sentence without ending the ride. */
  hush: () => void;
  /** Close the error banner. The ride, if it survived the error, is untouched. */
  dismissError: () => void;
}

let remarkCounter = 0;

function nextRemarkId(): string {
  remarkCounter += 1;
  return `r${Date.now().toString(36)}-${remarkCounter}`;
}

export function useBackseatRide(config: BackseatConfig, lang: string): RideApi {
  const [status, setStatus] = useState<RideStatus>('idle');
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [current, setCurrent] = useState<Remark | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<CameraFailure | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * Two abort controllers, not one, and the split is load-bearing.
   *
   * Hush stops the sentence and leaves the ride running, so it must not also abort a vision call
   * that has not answered yet — aborting that one ends the round without scheduling the next, and
   * the passenger goes quiet for the rest of the journey after a single tap. Teardown aborts both.
   */
  const visionAbortRef = useRef<AbortController | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const failuresRef = useRef(0);
  const wakeLockRef = useRef<ReturnType<typeof createWakeLock> | null>(null);

  /*
   * Which attempt to start is the current one.
   *
   * `getUserMedia` does not resolve until somebody has answered the permission dialog, which can
   * be a minute, and Stop is on the screen behind it. The stream then arrives for a ride that has
   * already been called off — and a stream nobody holds a reference to is a camera light that
   * stays on over an idle page, which is the most alarming thing a page like this can do. Every
   * start takes a number and hands the stream straight back if the number has moved on.
   */
  const startIdRef = useRef(0);

  /*
   * The settings, readable from the loop without being one of its dependencies.
   *
   * The loop is a chain of timeouts started once; if it closed over `config` it would go on using
   * whatever the settings were when Start was pressed, and changing the interval mid-ride would do
   * nothing until the next ride. A ref is read at the top of every round instead, so a change
   * takes effect on the next remark.
   */
  const configRef = useRef(config);
  configRef.current = config;

  const langRef = useRef(lang);
  langRef.current = lang;

  /* The spoken history, for the prompt. Kept beside the state because the loop needs it
     synchronously and `setState` is not readable on the same tick it is called. */
  const historyRef = useRef<Remark[]>([]);

  const pushRemark = useCallback((remark: Remark) => {
    historyRef.current = [...historyRef.current, remark].slice(-MAX_REMARKS);
    // Newest first for the screen; the history ref stays oldest-first, which is the order the
    // prompt wants.
    setRemarks([...historyRef.current].reverse());
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Everything that has to stop, in the order it has to stop in. */
  const teardown = useCallback(() => {
    runningRef.current = false;
    // Anything still on its way in belongs to a ride that no longer exists.
    startIdRef.current += 1;
    clearTimer();

    visionAbortRef.current?.abort();
    visionAbortRef.current = null;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;

    cancelSpeech();

    // Stopping the tracks is what turns the camera light off. A stream left running is the single
    // most alarming thing a page like this can do.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;

    wakeLockRef.current?.release();
    wakeLockRef.current = null;

    setSpeaking(false);
  }, [clearTimer]);

  const stop = useCallback(() => {
    teardown();
    setStatus('idle');
  }, [teardown]);

  /** One round: a frame, a remark, a sentence. Schedules the next one itself. */
  const round = useCallback(async () => {
    if (!runningRef.current) return;

    const settings = configRef.current;
    const startedAt = Date.now();

    const schedule = (delayMs: number) => {
      if (!runningRef.current) return;
      clearTimer();
      timerRef.current = setTimeout(() => void round(), Math.max(500, delayMs));
    };

    /** The gap measured from the START of this round, so a slow provider does not add to it. */
    const untilNext = () =>
      settings.remarks.intervalSeconds * 1000 - (Date.now() - startedAt);

    const video = videoRef.current;
    if (!video) {
      schedule(NO_FRAME_RETRY_MS);
      return;
    }

    const frame = captureFrame(video);
    if (!frame) {
      // Ordinary, not an error: a backgrounded tab, a locked phone, or the first second after the
      // stream was handed over. See the note at the top of the file.
      schedule(NO_FRAME_RETRY_MS);
      return;
    }

    const visionController = new AbortController();
    visionAbortRef.current = visionController;

    try {
      const raw = await askForRemark({
        provider: settings.vision.provider,
        apiKey: settings.apiKeys[settings.vision.provider === 'google' ? 'google' : 'openai'] ?? '',
        model: settings.vision.model,
        system: systemPrompt({
          persona: settings.remarks.persona,
          intensity: settings.remarks.intensity,
          lang: langRef.current,
          recent: recentTexts(historyRef.current),
        }),
        user: USER_PROMPT,
        frame,
        signal: visionController.signal,
      });

      if (!runningRef.current) return;
      failuresRef.current = 0;

      const text = sanitizeRemark(raw);
      if (!text || isRepeat(text, recentTexts(historyRef.current))) {
        // A dropped round costs one interval of silence and is much cheaper than the same
        // sentence twice, which is what makes the app read as broken.
        log.debug('backseat.remark.dropped', { repeat: Boolean(text) });
        schedule(untilNext());
        return;
      }

      const remark: Remark = { id: nextRemarkId(), text, at: startedAt, error: null };
      pushRemark(remark);
      setCurrent(remark);

      const speechController = new AbortController();
      speechAbortRef.current = speechController;

      setSpeaking(true);
      try {
        await speak(settings, {
          text,
          lang: langRef.current === 'pl' ? 'pl-PL' : 'en-GB',
          rate: settings.voice.rate,
          signal: speechController.signal,
        });
      } catch (e) {
        // The remark exists and is on the screen; only the voice failed. Worth marking on the
        // line itself rather than in a banner, because the next one may well speak fine.
        log.warn('backseat.speak.failed', describeError(e));
        historyRef.current = historyRef.current.map((r) =>
          r.id === remark.id
            ? { ...r, error: e instanceof Error ? e.message : 'Speech failed' }
            : r,
        );
        setRemarks([...historyRef.current].reverse());
      } finally {
        setSpeaking(false);
      }

      if (!runningRef.current) return;
      schedule(untilNext());
    } catch (e) {
      if (!runningRef.current) return;
      // An abort is a Stop or a settings change, not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return;

      const message = e instanceof Error ? e.message : 'The model would not answer.';
      log.warn('backseat.vision.failed', describeError(e));

      if (e instanceof VisionError && e.fatal) {
        // A rejected key will not start working on the next attempt, and going on would be
        // fifteen seconds of silence for ever with no explanation.
        setError(message);
        stop();
        return;
      }

      failuresRef.current += 1;
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setError(message);
        stop();
        return;
      }

      // Shown, but the ride continues: a tunnel is not a reason to end the joke.
      setError(message);
      schedule(untilNext());
    }
  }, [clearTimer, pushRemark, stop]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    if (!canStart(configRef.current)) return;

    setError(null);
    setCameraError(null);
    failuresRef.current = 0;

    if (!secureContext()) {
      setCameraError('unsupported');
      return;
    }
    if (!cameraSupported()) {
      setCameraError('unsupported');
      return;
    }

    /*
     * The unlocking utterance, spoken here and nowhere else: this function is called straight from
     * the Start button's click handler, which is the only place iOS accepts one. Move it into the
     * async body below and the ride goes silent on every iPhone, with nothing in any log.
     */
    primeSpeech();

    setStatus('starting');
    const startId = startIdRef.current + 1;
    startIdRef.current = startId;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          cameraConstraints(configRef.current.camera.facing),
        );

        // Stop pressed, or the island unmounted, while the permission dialog was open. The stream
        // arrived anyway and has to be given straight back.
        if (startIdRef.current !== startId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // `playsInline` is set on the element in JSX; without it iOS Safari takes the video
          // fullscreen the moment it plays, which puts the camera over the whole app.
          await video.play().catch(() => undefined);
        }

        wakeLockRef.current = createWakeLock();
        wakeLockRef.current.request();

        runningRef.current = true;
        setStatus('running');
        void round();
      } catch (e) {
        if (startIdRef.current !== startId) return;
        log.warn('backseat.camera.failed', describeError(e));
        setCameraError(classifyCameraError(e));
        setStatus('idle');
      }
    })();
  }, [round]);

  /** Stop the sentence, keep the ride. The next round is already scheduled and is unaffected. */
  const hush = useCallback(() => {
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    cancelSpeech();
    setSpeaking(false);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  // A ride does not survive the island being torn down, and the camera must not either.
  useEffect(() => teardown, [teardown]);

  return {
    status,
    videoRef,
    remarks,
    current,
    speaking,
    error,
    cameraError,
    start,
    stop,
    hush,
    dismissError,
  };
}
