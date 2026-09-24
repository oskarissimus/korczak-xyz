/*
 * A tap on a pin, through to a voice.
 *
 * One selection at a time, and that is the whole of the state here: an attraction is chosen, a
 * narration is fetched for it, and it plays. Choosing another one abandons the first - the
 * request, the audio, and the object URL behind it.
 *
 * TWO THINGS MUST HAPPEN INSIDE THE TAP and neither can be awaited first:
 *
 *  1. `unlock()`, which starts the shared `<audio>` element on a moment of silence. Without it
 *     iOS refuses to play the narration when it arrives twenty seconds later, silently.
 *  2. Nothing else. The fetch is started after, and it is deliberately not awaited by `select`'s
 *     caller - the marker handler returns immediately so the map stays responsive.
 *
 * NO KEYS, NO REQUEST. A tap with either key missing opens the keys sheet (`onNeedKeys`) and sends
 * nothing: the function would only answer 401, and a twenty-second progress bar ending in "check
 * your keys" is worse than being asked straight away. A 401 that comes back anyway - a key a
 * provider refused - opens the sheet the same way, beside the error.
 *
 * WHAT IS NOT KEPT: nothing. No narration is cached, in memory or anywhere else. Re-tapping the
 * pin you are already listening to does not re-fetch (that is the `key` check), but coming back
 * to it later does, and pays for it again. A cache is tempting and is the wrong shape here - the
 * audio is megabytes, the localStorage budget is shared with the typing trainer, and the thing
 * people do with an audio guide is walk away from it.
 *
 * EVERY TAP IS MEASURED. One `audioGuide.narration` measurement goes to Sentry per request, however
 * it ends - played, refused, or abandoned by a tap elsewhere - with the wait split into the
 * function's own stages (its Server-Timing header), what the function could not see (the
 * preflight, the network, an instance booting: `overheadMs`), the download and the start of play.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { recordMeasurement } from '../lib/sentry';
import { missingKeys, type ApiKeys } from '../utils/audioGuide/keys';
import { isPreset, loadLanguage, saveLanguage } from '../utils/audioGuide/language';
import {
  classifyNarrationFailure,
  NarrationError,
  requestNarration,
  type GuideFailure,
  type NarrationTiming,
} from '../utils/audioGuide/narration';
import { load as loadAudio, release, unlock } from '../utils/audioGuide/player';
import { networkType } from '../utils/audioGuide/telemetry';
import type { Attraction, AudioGuide, GuideStatus } from '../utils/audioGuide/types';

export type { GuideFailure };

export interface AudioGuideState {
  status: GuideStatus;
  selected: Attraction | null;
  guide: AudioGuide | null;
  error: GuideFailure | null;
  /** The backend's own words, in English, shown under the translated sentence. */
  errorDetail: string | null;
  playing: boolean;
  ended: boolean;
  /** When the request started, for the progress bar. Null when nothing is running. */
  startedAt: number | null;
  language: string;
  setLanguage: (value: string) => void;
  select: (attraction: Attraction) => void;
  cancel: () => void;
  retry: () => void;
  togglePlay: () => void;
  dismissError: () => void;
}

/** `facts` → `serverFactsMs`, so the function's stages sit beside the page's own fields. */
function serverFields(server: Record<string, number>): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = { cold: server.cold === 1 };
  for (const [name, value] of Object.entries(server)) {
    if (name === 'cold') continue;
    out[`server${name[0].toUpperCase()}${name.slice(1)}Ms`] = value;
  }
  return out;
}

/** One tap's measurement. `tapAt` and everything in `timing` are `performance.now()` readings. */
function measureNarration(
  outcome: string,
  tapAt: number,
  attraction: Attraction,
  language: string,
  retry: boolean,
  timing: NarrationTiming | null,
  extra: Record<string, number | string | boolean> = {},
): void {
  const now = performance.now();
  const responseMs = timing ? Math.round(timing.headersAt - tapAt) : undefined;
  const serverTotal = timing?.server.total;
  recordMeasurement('audioGuide.narration', {
    outcome,
    totalMs: Math.round(now - tapAt),
    responseMs,
    downloadMs: timing ? Math.round(timing.bodyAt - timing.headersAt) : undefined,
    bytes: timing?.bytes,
    // What the function never saw: the preflight, both network legs, and an instance booting.
    overheadMs:
      responseMs !== undefined && serverTotal !== undefined ? responseMs - serverTotal : undefined,
    ...(timing ? serverFields(timing.server) : {}),
    category: attraction.category,
    tags: Object.keys(attraction.tags ?? {}).length,
    // The two named options as themselves; anything typed is only "other" - it is free text.
    language: isPreset(language) ? language : 'other',
    retry,
    network: networkType(),
    ...extra,
  });
}

export function useAudioGuide(
  lang: 'en' | 'pl',
  keys: ApiKeys,
  onNeedKeys: () => void,
): AudioGuideState {
  const [status, setStatus] = useState<GuideStatus>('idle');
  const [selected, setSelected] = useState<Attraction | null>(null);
  const [guide, setGuide] = useState<AudioGuide | null>(null);
  const [error, setError] = useState<GuideFailure | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [language, setLanguageState] = useState(() => loadLanguage(lang));

  const inFlight = useRef<AbortController | null>(null);
  // The object URL currently held, so it can be revoked without reading state that may already
  // have been replaced. A leaked one pins its blob in memory for the life of the page.
  const heldUrl = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const language_ = useRef(language);
  language_.current = language;
  // Read at request time rather than captured, so a key pasted while a pin is selected is the one
  // the retry uses.
  const keys_ = useRef(keys);
  keys_.current = keys;
  const needKeys = useRef(onNeedKeys);
  needKeys.current = onNeedKeys;

  const discard = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    release();
    audio.current = null;
    if (heldUrl.current) {
      URL.revokeObjectURL(heldUrl.current);
      heldUrl.current = null;
    }
    setGuide(null);
    setPlaying(false);
    setEnded(false);
    setStartedAt(null);
  }, []);

  const run = useCallback(
    async (attraction: Attraction, retry = false) => {
      const controller = new AbortController();
      inFlight.current = controller;
      const tapAt = performance.now();
      const language = language_.current;
      let timing: NarrationTiming | null = null;

      setStatus('generating');
      setStartedAt(Date.now());
      log.info('audioGuide.narration.requested', {
        category: attraction.category,
        language: language_.current,
      });

      try {
        const narration = await requestNarration(
          attraction,
          language_.current,
          keys_.current,
          controller.signal,
        );
        timing = narration.timing;
        if (controller.signal.aborted) {
          // Nobody is waiting for this any more, and the URL would otherwise never be revoked.
          URL.revokeObjectURL(narration.audioUrl);
          measureNarration('abandoned', tapAt, attraction, language, retry, timing);
          return;
        }

        heldUrl.current = narration.audioUrl;
        const element = loadAudio(narration.audioUrl);
        audio.current = element;

        setGuide({
          attractionKey: attraction.key,
          attractionName: attraction.name,
          audioUrl: narration.audioUrl,
          locationWarning: narration.locationWarning,
          sources: narration.sources,
        });
        setStatus('ready');
        setStartedAt(null);

        // Autoplay, which is allowed here and only here: the element was unlocked by the tap
        // that asked for this, and starting it is what the reader asked for by tapping.
        const sources = narration.sources.length;
        element.play().then(
          () => {
            setPlaying(true);
            measureNarration('played', tapAt, attraction, language, retry, timing, {
              playStartMs: Math.round(performance.now() - narration.timing.bodyAt),
              sources,
            });
          },
          (e) => {
            // Not an error worth a toast - the player is on screen with a play button. It is
            // worth a log, because it is the signature of the unlock having failed.
            setPlaying(false);
            log.warn('audioGuide.autoplay.refused', describeError(e));
            measureNarration('autoplay-refused', tapAt, attraction, language, retry, timing, {
              sources,
            });
          },
        );
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          // Somebody gave up waiting - tapped another pin or closed the panel. How long they
          // lasted is the most direct answer there is to "is it too slow".
          measureNarration('abandoned', tapAt, attraction, language, retry, timing);
          return;
        }
        const failure = classifyNarrationFailure(e);
        measureNarration(
          failure,
          tapAt,
          attraction,
          language,
          retry,
          e instanceof NarrationError ? e.timing : null,
          { status: e instanceof NarrationError ? e.status : 0 },
        );
        setError(failure);
        if (failure === 'keys') needKeys.current();
        setErrorDetail(e instanceof NarrationError ? e.message : null);
        setStatus('error');
        setStartedAt(null);
        log.warn('audioGuide.narration.failed', describeError(e));
      }
    },
    [],
  );

  const select = useCallback(
    (attraction: Attraction) => {
      // First, and synchronously: this is the only moment that counts as a user gesture.
      void unlock();

      if (missingKeys(keys_.current).length > 0) {
        needKeys.current();
        return;
      }

      // A second tap on what is already loaded is a request to hear it again, not to buy it
      // twice. Anything else starts over.
      if (guide?.attractionKey === attraction.key && status === 'ready') {
        const element = audio.current;
        if (element) {
          element.currentTime = 0;
          element.play().then(
            () => setPlaying(true),
            () => setPlaying(false),
          );
          setEnded(false);
        }
        return;
      }

      discard();
      setError(null);
      setErrorDetail(null);
      setSelected(attraction);
      void run(attraction);
    },
    [discard, guide, run, status],
  );

  const cancel = useCallback(() => {
    discard();
    setSelected(null);
    setStatus('idle');
    setError(null);
    setErrorDetail(null);
  }, [discard]);

  const retry = useCallback(() => {
    if (!selected) return;
    if (missingKeys(keys_.current).length > 0) {
      needKeys.current();
      return;
    }
    discard();
    setError(null);
    setErrorDetail(null);
    void run(selected, true);
  }, [discard, run, selected]);

  const togglePlay = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      if (element.ended) element.currentTime = 0;
      element.play().then(
        () => setPlaying(true),
        (e) => log.warn('audioGuide.play.refused', describeError(e)),
      );
    } else {
      element.pause();
      setPlaying(false);
    }
  }, []);

  // The element is shared and outlives any one narration, so the listeners are attached to
  // whichever one is current and removed with it.
  useEffect(() => {
    const element = audio.current;
    if (!element || !guide) return;

    const onEnded = () => {
      setPlaying(false);
      setEnded(true);
    };
    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
    };
    const onPause = () => setPlaying(false);

    element.addEventListener('ended', onEnded);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    return () => {
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
    };
  }, [guide]);

  const setLanguage = useCallback((value: string) => {
    setLanguageState(value);
    saveLanguage(value);
  }, []);

  useEffect(() => () => discard(), [discard]);

  return {
    status,
    selected,
    guide,
    error,
    errorDetail,
    playing,
    ended,
    startedAt,
    language,
    setLanguage,
    select,
    cancel,
    retry,
    togglePlay,
    dismissError: () => {
      setError(null);
      setErrorDetail(null);
      setStatus('idle');
    },
  };
}
