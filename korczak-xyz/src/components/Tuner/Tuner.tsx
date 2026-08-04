/*
 * The tuner screen.
 *
 * Holds the microphone lifecycle and the discrete parts of the display — which string, whether it
 * is in tune, what to tell the user when there is nothing to show. The continuously-changing
 * parts (needle, cents readout, meters, history) read the engine's ref inside their own animation
 * frames, so nothing here re-renders while a string rings.
 */

import { useEffect, useRef } from 'react';
import { IN_TUNE_CENTS, STANDARD_TUNING } from '../../utils/tuner/notes';
import CentsHistory from './CentsHistory';
import LevelMeter from './LevelMeter';
import TunerDial from './TunerDial';
import { translations, type Lang } from './translations';
import { useTunerEngine } from './useTunerEngine';

interface TunerProps {
  lang: Lang;
}

export default function Tuner({ lang }: TunerProps) {
  const t = translations[lang];
  const { status, errorMessage, stringIndex, inTune, readingRef, start, stop } = useTunerEngine();
  const centsRef = useRef<HTMLSpanElement>(null);
  const hertzRef = useRef<HTMLSpanElement>(null);
  const directionRef = useRef<HTMLSpanElement>(null);

  const listening = status === 'listening';

  // The numeric readouts change every frame, so they are written to the DOM directly for the same
  // reason the meters are.
  useEffect(() => {
    if (!listening) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const reading = readingRef.current;
      const has = reading.stringIndex !== null;

      if (centsRef.current) {
        centsRef.current.textContent = has
          ? `${reading.cents > 0 ? '+' : ''}${reading.cents.toFixed(1)}`
          : '––.–';
      }
      if (hertzRef.current) {
        hertzRef.current.textContent =
          has && reading.frequency !== null ? `${reading.frequency.toFixed(1)} Hz` : '–';
      }
      if (directionRef.current) {
        // Flat means the string is slack, so the fix is to tighten it. Naming the action beats
        // naming the condition: "Tighten" is something to do, "Flat" is something to interpret.
        directionRef.current.textContent = !has
          ? t.playAString
          : reading.inTune
            ? t.inTune
            : reading.cents < 0
              ? t.tuneUp
              : t.tuneDown;
        directionRef.current.dataset.state = !has
          ? 'idle'
          : reading.inTune
            ? 'good'
            : reading.cents < 0
              ? 'flat'
              : 'sharp';
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [listening, readingRef, t]);

  if (!listening && status !== 'starting') {
    return (
      <div className="tuner">
        <div className="tuner-start">
          <p className="tuner-start-message">{startMessage(status, t, errorMessage)}</p>
          {status === 'denied' && <p className="tuner-start-hint">{t.deniedHint}</p>}
          {status === 'unsupported' || status === 'insecure' ? null : (
            <button type="button" className="tuner-start-button" onClick={() => void start()}>
              {status === 'idle' ? t.start : t.retry}
            </button>
          )}
        </div>
      </div>
    );
  }

  const active = stringIndex === null ? null : STANDARD_TUNING[stringIndex];

  return (
    <div className="tuner">
      <div className="tuner-panel">
        <TunerDial readingRef={readingRef} active={listening} />
      </div>

      <div className="tuner-readout">
        <span className="tuner-direction" ref={directionRef} data-state="idle">
          {t.playAString}
        </span>
        <span className="tuner-numbers">
          <span className="tuner-cents" ref={centsRef}>
            ––.–
          </span>
          <span className="tuner-cents-unit">{t.cents}</span>
          <span className="tuner-hertz" ref={hertzRef}>
            –
          </span>
        </span>
      </div>

      {/*
        The canvas is aria-hidden, so this is the only thing a screen reader has. It is driven by
        state rather than by the frame loop, which means it only speaks when the string or the
        verdict actually changes — a live region updated every frame would be unusable.
      */}
      <p className="tuner-sr-only" role="status" aria-live="polite">
        {active ? `${active.name} — ${inTune ? t.inTune : t.listening}` : t.playAString}
      </p>

      <ol className="tuner-strings" aria-label={t.strings}>
        {STANDARD_TUNING.map((string, index) => (
          <li
            key={string.name}
            className="tuner-string"
            data-active={index === stringIndex}
            data-in-tune={index === stringIndex && inTune}
          >
            <span className="tuner-string-note">{string.letter}</span>
            <span className="tuner-string-octave">{string.octave}</span>
          </li>
        ))}
      </ol>

      <LevelMeter readingRef={readingRef} active={listening} t={t} />

      <div className="tuner-history">
        <span className="tuner-history-label">{t.history}</span>
        <div className="tuner-history-panel">
          <CentsHistory readingRef={readingRef} active={listening} />
        </div>
      </div>

      <div className="tuner-controls">
        <button type="button" onClick={stop}>
          {t.stop}
        </button>
        <span className="tuner-tolerance">±{IN_TUNE_CENTS} {t.cents}</span>
      </div>
    </div>
  );
}

function startMessage(
  status: ReturnType<typeof useTunerEngine>['status'],
  t: (typeof translations)[Lang],
  errorMessage: string | null,
): string {
  switch (status) {
    case 'denied':
      return t.denied;
    case 'unsupported':
      return t.unsupported;
    case 'insecure':
      return t.insecure;
    case 'error':
      return errorMessage ? `${t.error} (${errorMessage})` : t.error;
    default:
      return t.idleHint;
  }
}
