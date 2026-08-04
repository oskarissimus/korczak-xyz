/*
 * The impure half of the tuner: microphone capture, the filter graph, and the frame loop.
 *
 * Everything decided here is decided in utils/tuner; this file only moves samples and manages the
 * lifetime of things the browser will not clean up on its own.
 *
 * Readings are published through a ref rather than through state. The needle wants redrawing at
 * 60 Hz and re-rendering React that often to move a line on a canvas would cost far more than the
 * detection does. State carries only what changes the DOM: which string, whether it is in tune,
 * and how the microphone is doing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { butterworthQs } from '../../utils/tuner/biquad';
import { FRAME_SIZE, TunerDetector, type RejectionReason } from '../../utils/tuner/detect';
import { isInTune, nearestString, STANDARD_TUNING } from '../../utils/tuner/notes';
import { MedianWindow, OneEuroFilter } from '../../utils/tuner/smoothing';

/** Corner frequencies of the capture graph. See detect.ts for why these and not others. */
const HIGHPASS_HZ = 70;
const GUARD_LOWPASS_HZ = 2500;

/** Detection runs at about this rate; the canvas still redraws every animation frame. */
const DETECTIONS_PER_SECOND = 30;

/**
 * How long a note stays on screen after it stops being detected. A plucked string fades below the
 * level floor well before the player has finished turning the peg, and a readout that blanks the
 * instant the sound dies is unusable — you would be tuning from memory.
 */
const HOLD_MS = 1500;

const MEDIAN_WINDOW = 5;

/** Seconds of pitch history the strip shows. */
export const HISTORY_SECONDS = 6;

export type TunerStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'denied'
  | 'unsupported'
  | 'insecure'
  | 'error';

export interface HistoryPoint {
  /** performance.now() milliseconds. */
  readonly time: number;
  readonly cents: number;
}

/**
 * The live reading, mutated in place. Consumers read it inside their own animation frame; nothing
 * here is safe to hold onto across frames.
 */
export interface TunerReading {
  /** Index into STANDARD_TUNING, or null when nothing is being heard. */
  stringIndex: number | null;
  /** Smoothed distance from that string's target pitch, in cents. */
  cents: number;
  /** Unsmoothed detected pitch, for the numeric hertz readout. */
  frequency: number | null;
  clarity: number;
  level: number;
  inTune: boolean;
  /** Why the last frame produced nothing, when it produced nothing. */
  rejectedBecause: RejectionReason | null;
  /** Ring buffer of recent smoothed cents, oldest first. */
  history: HistoryPoint[];
}

function emptyReading(): TunerReading {
  return {
    stringIndex: null,
    cents: 0,
    frequency: null,
    clarity: 0,
    level: 0,
    inTune: false,
    rejectedBecause: null,
    history: [],
  };
}

interface AudioChain {
  context: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
}

export interface TunerEngine {
  status: TunerStatus;
  /** Set when status is 'error', for the message on screen. */
  errorMessage: string | null;
  /** Which string is showing, mirrored into state because it changes the DOM. */
  stringIndex: number | null;
  inTune: boolean;
  readingRef: React.RefObject<TunerReading>;
  start: () => Promise<void>;
  stop: () => void;
}

export function useTunerEngine(): TunerEngine {
  const [status, setStatus] = useState<TunerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stringIndex, setStringIndex] = useState<number | null>(null);
  const [inTune, setInTune] = useState(false);

  const readingRef = useRef<TunerReading>(emptyReading());
  const chainRef = useRef<AudioChain | null>(null);
  const frameRef = useRef<number | null>(null);
  const detectorRef = useRef<TunerDetector | null>(null);
  const medianRef = useRef(new MedianWindow(MEDIAN_WINDOW));
  const centsFilterRef = useRef(new OneEuroFilter());
  const samplesRef = useRef(new Float32Array(FRAME_SIZE));
  const lastDetectionRef = useRef(0);
  const lastGoodRef = useRef(0);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const chain = chainRef.current;
    chainRef.current = null;
    if (chain) {
      // Stopping the tracks is what clears the recording indicator; closing the context alone
      // leaves the microphone held open.
      chain.stream.getTracks().forEach((track) => track.stop());
      void chain.context.close().catch(() => {});
    }
    detectorRef.current = null;
    medianRef.current.reset();
    centsFilterRef.current.reset();
    readingRef.current = emptyReading();
    setStringIndex(null);
    setInTune(false);
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (chainRef.current) return;

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // On a plain http:// origin the whole mediaDevices object is missing rather than the call
      // failing, so an insecure context looks identical to an old browser unless checked first.
      setStatus(window?.isSecureContext === false ? 'insecure' : 'unsupported');
      return;
    }

    setStatus('starting');
    setErrorMessage(null);

    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    try {
      const AudioContextClass =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        setStatus('unsupported');
        return;
      }

      // Created synchronously inside the click that called start(), because Safari only unlocks
      // audio from within a user gesture.
      context = new AudioContextClass();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          /*
           * The single most important thing in this file for the phone case. Leaving echo
           * cancellation on puts iOS into its voice-processing path, which high-passes around
           * 100 Hz — straight through the low E's 82 Hz fundamental — and applies gain control
           * that moves while a note decays. All three have to be off for a tuner.
           */
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });

      // Safari does not count dismissing the permission prompt as a gesture, so a context created
      // before it can come back suspended.
      if (context.state === 'suspended') await context.resume();

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = FRAME_SIZE;

      // 4th-order Butterworth as two biquads each: high-pass to drop handling rumble, low-pass to
      // bound what the detector's own adaptive filter has to work with.
      let node: AudioNode = source;
      for (const q of butterworthQs(4)) {
        const filter = context.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = HIGHPASS_HZ;
        filter.Q.value = q;
        node.connect(filter);
        node = filter;
      }
      for (const q of butterworthQs(4)) {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = GUARD_LOWPASS_HZ;
        filter.Q.value = q;
        node.connect(filter);
        node = filter;
      }
      node.connect(analyser);
      // Deliberately not connected to context.destination: routing the microphone to the speaker
      // would feed back, and on iOS it also forces output away from any connected headphones.

      chainRef.current = { context, stream, analyser };
      detectorRef.current = new TunerDetector();
      medianRef.current.reset();
      centsFilterRef.current.reset();
      readingRef.current = emptyReading();
      lastDetectionRef.current = 0;
      lastGoodRef.current = 0;
      setStatus('listening');
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => {});
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied');
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    }
  }, []);

  // The frame loop. Runs while a chain exists; detection is throttled inside it, the ref is not.
  useEffect(() => {
    if (status !== 'listening') return;

    const tick = () => {
      frameRef.current = requestAnimationFrame(tick);
      const chain = chainRef.current;
      const detector = detectorRef.current;
      if (!chain || !detector) return;

      const now = performance.now();
      if (now - lastDetectionRef.current < 1000 / DETECTIONS_PER_SECOND) return;
      lastDetectionRef.current = now;

      const frame = samplesRef.current;
      chain.analyser.getFloatTimeDomainData(frame);
      const detection = detector.detect(frame, chain.context.sampleRate);

      const reading = readingRef.current;
      reading.clarity = detection.clarity;
      reading.level = detection.rms;
      reading.rejectedBecause = detection.rejectedBecause;

      if (detection.frequency !== null) {
        // The median runs on frequency, before the cents conversion, so an outlier is judged
        // against the other candidates rather than against whichever string it got assigned to.
        const smoothedHz = medianRef.current.push(detection.frequency);
        if (smoothedHz !== null) {
          const match = nearestString(smoothedHz);
          const cents = centsFilterRef.current.filter(match.cents, now / 1000);
          const index = STANDARD_TUNING.indexOf(match.string);

          reading.frequency = smoothedHz;
          reading.cents = cents;
          reading.stringIndex = index;
          reading.inTune = isInTune(cents);
          reading.history.push({ time: now, cents });
          lastGoodRef.current = now;

          setStringIndex((previous) => (previous === index ? previous : index));
          setInTune((previous) => (previous === reading.inTune ? previous : reading.inTune));
        }
      } else if (lastGoodRef.current !== 0 && now - lastGoodRef.current > HOLD_MS) {
        // The note has been gone long enough to stop claiming we can hear it.
        reading.stringIndex = null;
        reading.frequency = null;
        reading.inTune = false;
        medianRef.current.reset();
        centsFilterRef.current.reset();
        lastGoodRef.current = 0;
        setStringIndex(null);
        setInTune(false);
      }

      const cutoff = now - HISTORY_SECONDS * 1000;
      while (reading.history.length > 0 && reading.history[0].time < cutoff) {
        reading.history.shift();
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [status]);

  /*
   * Teardown. The microphone outlives the component unless every one of these is handled: iOS
   * suspends audio contexts when the page is hidden and does not always bring them back, and
   * Astro's ClientRouter swaps pages without a reload, so navigating away runs no unload event.
   */
  useEffect(() => {
    const release = () => stop();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };

    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('astro:before-swap', release);
    return () => {
      window.removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('astro:before-swap', release);
      stop();
    };
  }, [stop]);

  return { status, errorMessage, stringIndex, inTune, readingRef, start, stop };
}
