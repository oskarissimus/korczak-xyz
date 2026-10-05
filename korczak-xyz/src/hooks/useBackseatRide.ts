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
import { recordMeasurement } from '../lib/sentry';
import { canStart, speechLocale } from '../utils/backseat/defaults';
import { askDemo } from '../utils/backseat/demo';
import {
  cameraConstraints,
  cameraSupported,
  captureFrame,
  classifyCameraError,
  secureContext,
  type CameraFailure,
} from '../utils/backseat/frame';
import { BACKSEAT, type Flavour } from '../utils/backseat/flavour';
import {
  anglesFor,
  isRepeat,
  pickAngle,
  recentTexts,
  sanitizeRemark,
  systemPrompt,
  userPromptFor,
} from '../utils/backseat/remarks';
import { cancelSpeech, primeVoices, speak } from '../utils/backseat/speech';
import { prepareLive, primeLiveAudio, sessionFits, type LiveSession } from '../utils/backseat/live';
import type { BackseatConfig, Remark, RemarkLanguage, RideStatus } from '../utils/backseat/types';
import { RELEASE, rideIdFor, saveRound, type RoundRecord } from '../utils/backseat/rideLog';
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

export interface PendingRound {
  at: number;
  /** `looking`: the model has the photo. `voicing`: the sentence is being turned into speech. */
  stage: 'looking' | 'voicing';
}

/** The connection type where the browser says (Chrome, Android); absent on iOS. */
function networkType(): string | undefined {
  return (navigator as unknown as { connection?: { effectiveType?: string } }).connection
    ?.effectiveType;
}

export interface RideApi {
  status: RideStatus;
  /** Attach to the `<video>`; the hook owns the stream. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Newest first, which is the order the screen reads in. */
  remarks: Remark[];
  /** The one being spoken, or the last one spoken. Null before the first. */
  current: Remark | null;
  speaking: boolean;
  /**
   * The round waiting for its first sound: when the photograph was taken and what it is waiting
   * on. Null while speaking or between rounds. The ride screen counts up from `at`.
   */
  pending: PendingRound | null;
  /** The last round's photo-to-first-sound, kept on screen after the count stops. */
  lastLatencyMs: number | null;
  /**
   * Demo rides only: how many remarks this device has left today, as the function last said.
   * Null off the demo, and until the first answer. On the screen because a ride that is about to
   * stop at a cap should say so before it does rather than after.
   */
  demoRemaining: number | null;
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

/** What a Live session's prompt was built from, beyond the history and the angle. */
function promptKeyOf(config: BackseatConfig, lang: RemarkLanguage): string {
  return `${config.remarks.persona}|${config.remarks.intensity}|${lang}`;
}

function nextRemarkId(): string {
  remarkCounter += 1;
  return `r${Date.now().toString(36)}-${remarkCounter}`;
}

export function useBackseatRide(
  config: BackseatConfig,
  lang: RemarkLanguage,
  /** The account a ride's rounds are saved under (`rideLog.ts`); null saves nothing. */
  uid: string | null = null,
  /** Which app: the prompt, the folder the rounds are saved in, the measurement's name. */
  flavour: Flavour = BACKSEAT,
): RideApi {
  const [status, setStatus] = useState<RideStatus>('idle');
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [current, setCurrent] = useState<Remark | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRound | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [demoRemaining, setDemoRemaining] = useState<number | null>(null);
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

  const uidRef = useRef(uid);
  uidRef.current = uid;

  const flavourRef = useRef(flavour);
  flavourRef.current = flavour;
  /** This ride's id and how many rounds it has had, for the saved records. */
  const rideRef = useRef({ id: '', rounds: 0, angle: null as string | null });

  /*
   * Gemini Live's next session, opened while the current remark is still being spoken so that the
   * next snapshot finds it set up (see `live.ts`). It carries the prompt it was opened with, and
   * `promptKey` says what that prompt was built from: a persona or language changed in between
   * means a fresh session rather than a remark in the old voice.
   */
  const liveNextRef = useRef<{
    session: LiveSession;
    angle: string;
    system: string;
    promptKey: string;
  } | null>(null);
  /** The session answering right now, so teardown can close it. */
  const liveNowRef = useRef<LiveSession | null>(null);

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

    liveNextRef.current?.session.close();
    liveNextRef.current = null;
    liveNowRef.current?.close();
    liveNowRef.current = null;

    // Stopping the tracks is what turns the camera light off. A stream left running is the single
    // most alarming thing a page like this can do.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;

    wakeLockRef.current?.release();
    wakeLockRef.current = null;

    setSpeaking(false);
    setPending(null);
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
    /*
     * The demo: the looking is a function of ours on the site's key rather than a provider on the
     * reader's (`utils/backseat/demo.ts`). Everything else about the round is unchanged — the same
     * frame, the same sanitiser, the same repeat check, the same chain of timeouts — and that is
     * deliberate: the demo is the same app with a different payer, not a reduced one.
     */
    const demo = settings.demoMode;
    const app = flavourRef.current;
    const angles = anglesFor(app.id);
    const USER_PROMPT = userPromptFor(app.id);

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
    const frameMs = Date.now() - startedAt;
    // What the screen counts from: the photograph, until the first sound.
    setPending({ at: startedAt, stage: 'looking' });

    // Never both: there is no way to lend a Live WebSocket without lending the key, so
    // `demoRestrictions` has already moved a demo config off it. Belt and braces.
    const live = settings.voice.engine === 'live' && !demo;
    const liveSettings = {
      apiKey: settings.apiKeys.google ?? '',
      model: settings.voice.liveModel,
      voice: settings.voice.liveVoice,
    };
    // A session opened during the last remark, if it still fits what the settings now say.
    let prepared = liveNextRef.current;
    liveNextRef.current = null;
    if (
      prepared &&
      (!live ||
        prepared.promptKey !== promptKeyOf(settings, langRef.current) ||
        !sessionFits(prepared.session, liveSettings))
    ) {
      prepared.session.close();
      prepared = null;
    }

    const angle = prepared?.angle ?? pickAngle(rideRef.current.angle, Math.random, angles);
    rideRef.current.angle = angle;
    const system =
      prepared?.system ??
      systemPrompt({
        flavour: app.id,
        angle,
        persona: settings.remarks.persona,
        intensity: settings.remarks.intensity,
        lang: langRef.current,
        recent: recentTexts(historyRef.current),
      });
    rideRef.current.rounds += 1;
    // What this round is, for the saved record; `outcome` and the rest are filled in as it goes.
    const record: RoundRecord = {
      rideId: rideRef.current.id,
      n: rideRef.current.rounds,
      at: startedAt,
      provider: demo ? 'demo' : live ? 'google-live' : settings.vision.provider,
      model: demo ? 'demo' : live ? settings.voice.liveModel : settings.vision.model,
      persona: settings.remarks.persona,
      intensity: settings.remarks.intensity,
      angle,
      lang: langRef.current,
      // The demo's prompt is assembled by the function out of the persona, intensity and language
      // it was sent, so the one this browser would have used is not what the model saw.
      system: demo ? '(demo: the prompt is built by the roastDemo function)' : system,
      user: USER_PROMPT,
      raw: null,
      text: null,
      outcome: 'failed',
      error: null,
      release: RELEASE,
      voice:
        settings.voice.engine === 'elevenlabs'
          ? `elevenlabs:${settings.voice.elevenModel}`
          : live
            ? `live:${settings.voice.liveVoice}`
            : 'device',
      timings: {},
      trace: { frame: frameMs },
      network: networkType(),
    };
    const timings = record.timings!;
    const trace = record.trace!;
    const since = () => Date.now() - startedAt;
    const mark = (name: string) => {
      if (!(name in trace)) trace[name] = since();
    };
    /** The first sound: the end of the wait, on the screen and in the record. */
    const heard = () => {
      if (timings.firstSoundMs !== undefined) return timings.firstSoundMs;
      timings.firstSoundMs = since();
      mark('firstSound');
      setPending(null);
      setLastLatencyMs(timings.firstSoundMs);
      return timings.firstSoundMs;
    };
    const save = () => {
      trace.done = since();
      setPending(null);
      saveRound(uidRef.current, record, frame, app);
      // The wait from photograph to voice, which is what the passenger's timing lives or dies
      // on: one measurement per round, numbers and categories only — never the remark.
      recordMeasurement(`${app.id}.round`, {
        outcome: record.outcome,
        provider: record.provider,
        model: record.model,
        voice: record.voice,
        lang: record.lang,
        visionMs: timings.visionMs,
        firstSoundMs: timings.firstSoundMs,
        ttsMs:
          timings.firstSoundMs !== undefined && timings.visionMs !== undefined
            ? timings.firstSoundMs - timings.visionMs
            : undefined,
        doneMs: timings.doneMs,
        livePrepared: record.live?.prepared,
        liveRetried: record.live?.retried,
        network: record.network,
        chars: record.text?.length,
        frameBytes: Math.round((frame.base64.length * 3) / 4),
      });
    };

    try {
      if (live) {
        const speechController = new AbortController();
        speechAbortRef.current = speechController;
        const remark: Remark = { id: nextRemarkId(), text: '…', at: startedAt, error: null };
        let shown = false;
        const show = (patch: Partial<Remark>) => {
          Object.assign(remark, patch);
          if (!shown) {
            shown = true;
            pushRemark({ ...remark });
          } else {
            historyRef.current = historyRef.current.map((r) =>
              r.id === remark.id ? { ...remark } : r,
            );
            setRemarks([...historyRef.current].reverse());
          }
          setCurrent({ ...remark });
        };
        const events: [number, string][] = [];
        record.events = events;

        const askOn = async (session: LiveSession, wasPrepared: boolean) => {
          liveNowRef.current = session;
          try {
            return await session.ask({
              frame,
              user: USER_PROMPT,
              signal: visionController.signal,
              hush: speechController.signal,
              onMark: mark,
              onEvent: (kind) => {
                if (events.length < 120) events.push([since(), kind]);
              },
              onStart: () => {
                setSpeaking(true);
                show({ latencyMs: heard() });
              },
              onText: (soFar) => show({ text: soFar }),
            });
          } finally {
            liveNowRef.current = null;
            record.live = {
              ...record.live,
              prepared: wasPrepared,
              sessionAgeMs: startedAt - session.createdAt,
              setupMs: session.setupAt ? session.setupAt - session.createdAt : null,
              early: [...session.early],
              close: session.closeInfo
                ? {
                    code: session.closeInfo.code,
                    reason: session.closeInfo.reason,
                    ms: session.closeInfo.at - startedAt,
                  }
                : null,
              usage: session.usage,
              input: 'clientContent',
              thinkingOff: session.thinkingOff,
              audioChunks: session.audioChunks,
              audioSeconds: Math.round(session.audioSeconds * 100) / 100,
            };
          }
        };

        let answer;
        try {
          answer = await askOn(
            prepared?.session ?? prepareLive({ ...liveSettings, system }),
            Boolean(prepared),
          );
          /*
           * The first Live ride (3 Oct 2026) spoke once and then answered every prepared session
           * with nothing, in under a second, no error. Until the saved events say why, an empty
           * answer from a prepared session is asked again on a fresh one in the same round, and
           * both are on the record (`live.retry`, `live.retried`).
           */
          if (!answer.spoke && !answer.text && runningRef.current) {
            mark('live.retry');
            events.push([since(), '— retry on a fresh session —']);
            answer = await askOn(prepareLive({ ...liveSettings, system }), false);
            record.live = { ...record.live!, retried: true };
          }
          /*
           * Words with no sound: the 4 Oct test saw it once in ten on a Live model, a full
           * transcript and not one audio chunk. The sentence exists, so the phone's own
           * synthesiser says it rather than the round being lost.
           */
          if (!answer.spoke && answer.text && runningRef.current) {
            mark('live.deviceFallback');
            const fallbackText = sanitizeRemark(answer.text) || answer.text;
            show({ text: fallbackText });
            setSpeaking(true);
            await speak(
              { ...settings, voice: { ...settings.voice, engine: 'device' } },
              {
                text: fallbackText,
                lang: speechLocale(langRef.current),
                rate: settings.voice.rate,
                signal: speechController.signal,
                onMark: mark,
                onStart: () => show({ latencyMs: heard() }),
              },
            ).catch((e) => log.warn('backseat.live.fallback.failed', describeError(e)));
            answer = { ...answer, spoke: timings.firstSoundMs !== undefined };
            record.live = { ...record.live!, deviceFallback: true };
          }
          if (!answer.spoke && !answer.text && runningRef.current) {
            // Silence with no error is the one thing nobody can see from the driver's seat: it
            // goes to the banner and counts as a failure, so three in a row stop the ride.
            throw new VisionError(
              'Gemini Live answered with nothing (turn complete, no audio, no text).',
              null,
            );
          }
        } finally {
          setSpeaking(false);
        }
        timings.doneMs = since();
        record.raw = answer.text;

        if (!runningRef.current) return;
        failuresRef.current = 0;

        // Heard already, so this only tidies what is shown and remembered (see `live.ts`).
        const text = sanitizeRemark(answer.text) || answer.text || null;
        record.text = text;
        if (answer.spoke && text) {
          record.outcome = 'spoken';
          show({ text });
        } else {
          record.outcome = 'dropped_empty';
          if (shown) {
            historyRef.current = historyRef.current.filter((r) => r.id !== remark.id);
            setRemarks([...historyRef.current].reverse());
          }
        }
        save();

        // The next session, opened now so the next snapshot does not wait for a handshake.
        const nextAngle = pickAngle(angle, Math.random, angles);
        const nextSystem = systemPrompt({
          flavour: app.id,
          angle: nextAngle,
          persona: settings.remarks.persona,
          intensity: settings.remarks.intensity,
          lang: langRef.current,
          recent: recentTexts(historyRef.current),
        });
        liveNextRef.current = {
          session: prepareLive({ ...liveSettings, system: nextSystem }),
          angle: nextAngle,
          system: nextSystem,
          promptKey: promptKeyOf(settings, langRef.current),
        };
        schedule(untilNext());
        return;
      }

      let raw: string;
      if (demo) {
        const answer = await askDemo({
          app: app.id,
          persona: settings.remarks.persona,
          intensity: settings.remarks.intensity,
          lang: langRef.current,
          recent: recentTexts(historyRef.current),
          frame,
          signal: visionController.signal,
          onMark: mark,
        });
        raw = answer.text;
        // The function drew the angle, so the record names the one actually used.
        record.angle = answer.angle;
        setDemoRemaining(answer.remaining.ip);
      } else {
        raw = await askForRemark({
          provider: settings.vision.provider,
          apiKey: settings.apiKeys[settings.vision.provider === 'google' ? 'google' : 'openai'] ?? '',
          model: settings.vision.model,
          system,
          user: USER_PROMPT,
          frame,
          signal: visionController.signal,
          onMark: mark,
        });
      }
      record.raw = raw;
      timings.visionMs = since();
      setPending({ at: startedAt, stage: 'voicing' });

      if (!runningRef.current) return;
      failuresRef.current = 0;

      const text = sanitizeRemark(raw);
      record.text = text;
      if (!text || isRepeat(text, recentTexts(historyRef.current))) {
        record.outcome = text ? 'dropped_repeat' : 'dropped_empty';
        save();
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
      record.outcome = 'spoken';

      setSpeaking(true);
      try {
        await speak(settings, {
          text,
          lang: speechLocale(langRef.current),
          rate: settings.voice.rate,
          signal: speechController.signal,
          onMark: mark,
          onStart: () => {
            if (timings.firstSoundMs !== undefined) return;
            const latencyMs = heard();
            historyRef.current = historyRef.current.map((r) =>
              r.id === remark.id ? { ...r, latencyMs } : r,
            );
            setRemarks([...historyRef.current].reverse());
          },
        });
        timings.doneMs = since();
      } catch (e) {
        /*
         * The remark exists and is on the screen; only the voice failed. It is marked on the line
         * AND raised in the banner, which is a deliberate change of mind: the first version marked
         * only the line, on the grounds that the next remark may well speak fine — and the result
         * was an app that went quiet with the explanation in a chip at the bottom of a log nobody
         * reads while driving. A passenger that has stopped talking is exactly when somebody needs
         * to be told why.
         */
        const message = e instanceof Error ? e.message : 'Speech failed';
        record.outcome = 'unspoken';
        record.error = message;
        log.warn('backseat.speak.failed', describeError(e));
        setError(message);
        historyRef.current = historyRef.current.map((r) =>
          r.id === remark.id ? { ...r, error: message } : r,
        );
        setRemarks([...historyRef.current].reverse());
      } finally {
        setSpeaking(false);
        save();
      }

      if (!runningRef.current) return;
      schedule(untilNext());
    } catch (e) {
      if (!runningRef.current) return;
      // An abort is a Stop or a settings change, not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return;

      const message = e instanceof Error ? e.message : 'The model would not answer.';
      log.warn('backseat.vision.failed', describeError(e));
      record.error = message;
      save();

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
    setLastLatencyMs(null);
    setDemoRemaining(null);
    failuresRef.current = 0;
    rideRef.current = { id: rideIdFor(Date.now()), rounds: 0, angle: null };

    if (!secureContext()) {
      setCameraError('unsupported');
      return;
    }
    if (!cameraSupported()) {
      setCameraError('unsupported');
      return;
    }

    /*
     * Both engines woken here and nowhere else: this function is called straight from the Start
     * button's click handler, which is the only place iOS accepts either. Move it into the async
     * body below — or behind any `await` at all — and the ride goes silent on every iPhone with
     * nothing in any log. The clip half of it is why an ElevenLabs voice plays at all; see the
     * note at the top of `speech.ts`.
     */
    primeVoices();
    // Gemini Live plays through Web Audio, which has its own gesture unlock (`live.ts`).
    if (configRef.current.voice.engine === 'live') primeLiveAudio();

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
    pending,
    lastLatencyMs,
    demoRemaining,
    error,
    cameraError,
    start,
    stop,
    hush,
    dismissError,
  };
}
