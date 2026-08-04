/*
 * Input level and pitch clarity.
 *
 * These two answer the question the tuner otherwise leaves the user guessing at when the readout
 * is blank: is it not hearing me, or is it hearing me and unable to make sense of it? Signal
 * shows the first, clarity the second — a loud bar with a dead clarity bar means the room is
 * noisy or the note was muffled, not that the microphone failed.
 *
 * Both bars are written straight to the DOM from an animation frame. They change every frame and
 * neither one affects layout, so putting them through React state would re-render the panel
 * thirty times a second to move a background.
 */

import { useEffect, useRef } from 'react';
import { MIN_CLARITY, MIN_RMS } from '../../utils/tuner/detect';
import type { TunerTranslations } from './translations';
import type { TunerReading } from './useTunerEngine';

/** Full scale for the signal bar. Roughly a strummed chord a hand's width from a phone. */
const FULL_SCALE_RMS = 0.25;

interface LevelMeterProps {
  readingRef: React.RefObject<TunerReading>;
  active: boolean;
  t: TunerTranslations;
}

export default function LevelMeter({ readingRef, active, t }: LevelMeterProps) {
  const signalRef = useRef<HTMLDivElement>(null);
  const clarityRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let frame = 0;
    // Bars fall slowly and rise instantly, the way a hardware meter does, so a decaying note
    // leaves something readable behind instead of flickering at the floor.
    let signalShown = 0;
    let clarityShown = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const reading = readingRef.current;
      const live = activeRef.current;

      const signal = live ? Math.min(1, reading.level / FULL_SCALE_RMS) : 0;
      const clarity = live && reading.level >= MIN_RMS ? reading.clarity : 0;

      signalShown = signal > signalShown ? signal : signalShown + (signal - signalShown) * 0.12;
      clarityShown = clarity > clarityShown ? clarity : clarityShown + (clarity - clarityShown) * 0.12;

      if (signalRef.current) {
        signalRef.current.style.width = `${(signalShown * 100).toFixed(1)}%`;
        signalRef.current.dataset.low = String(signalShown * FULL_SCALE_RMS < MIN_RMS);
      }
      if (clarityRef.current) {
        clarityRef.current.style.width = `${(clarityShown * 100).toFixed(1)}%`;
        clarityRef.current.dataset.low = String(clarityShown < MIN_CLARITY);
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [readingRef]);

  return (
    <div className="tuner-meters">
      <div className="tuner-meter">
        <span className="tuner-meter-label">{t.signal}</span>
        <div className="tuner-meter-track">
          <div className="tuner-meter-fill" ref={signalRef} />
        </div>
      </div>
      <div className="tuner-meter">
        <span className="tuner-meter-label">{t.clarity}</span>
        <div className="tuner-meter-track">
          {/* The clarity gate sits at 0.9, so the bar is nearly full before a reading is trusted.
              Marking the threshold stops that looking like a broken meter. */}
          <div className="tuner-meter-threshold" style={{ left: `${MIN_CLARITY * 100}%` }} />
          <div className="tuner-meter-fill" ref={clarityRef} />
        </div>
      </div>
    </div>
  );
}
