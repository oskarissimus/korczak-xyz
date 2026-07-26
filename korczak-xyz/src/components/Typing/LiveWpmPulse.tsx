import React, { useEffect, useRef, useState } from 'react';
import { PULSE_LOOKBACK_MS, pulseDomainTop, samplePulse, type PulseSample } from '../../utils/typing/pulse';
import type { RecentChar } from '../../utils/typing/types';

// The chart's own coordinate space; stretched to the tile by the viewBox, so
// these numbers only set the resolution of the curve, not its rendered size.
const VIEW_W = 160;
const VIEW_H = 30;
// Half a stroke of headroom top and bottom, so a peak or a flatline isn't
// clipped by the tile's border.
const PAD = 1.5;

// How often the curve is redrawn. Fast enough to feel live, slow enough that the
// cost stays invisible — and it only re-renders this tile, never the passage.
const REFRESH_MS = 100;

interface LiveWpmPulseProps {
  getRecentChars: (windowMs: number) => RecentChar[];
  isTiming: boolean;
  isPaused: boolean;
  averageWpm: number;
  label: string;
}

// A five-second sparkline of momentary typing speed. The stats bar's WPM is
// cumulative and barely moves; this shows the bursts and hesitations it averages
// away, read against a dashed line at that cumulative average.
export function LiveWpmPulse({ getRecentChars, isTiming, isPaused, averageWpm, label }: LiveWpmPulseProps) {
  const [samples, setSamples] = useState<PulseSample[]>(() => samplePulse([], Date.now()));
  // Set once the curve has run flat, so the ticker can tell an idle redraw from
  // a real one without re-subscribing every time the curve changes.
  const idleRef = useRef(true);

  const running = isTiming && !isPaused;

  useEffect(() => {
    const tick = () => {
      const chars = getRecentChars(PULSE_LOOKBACK_MS);
      // Nothing left in the window: the curve has already decayed to the floor
      // and would only be redrawn identically. Keeps a long idle stretch (up to
      // the 20s auto-pause) free of renders.
      if (chars.length === 0 && idleRef.current) return;
      idleRef.current = chars.length === 0;
      setSamples(samplePulse(chars, Date.now()));
    };
    // Also runs once when `running` goes false, so the tile settles on the
    // decayed curve instead of freezing mid-stroke.
    tick();
    if (!running) return;
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [running, getRecentChars]);

  let peak = 0;
  for (const s of samples) if (s.wpm > peak) peak = s.wpm;
  const top = pulseDomainTop(averageWpm, peak);

  const y = (wpm: number) => VIEW_H - PAD - (Math.min(wpm, top) / top) * (VIEW_H - 2 * PAD);
  const points = samples
    .map((s, i) => `${((i / (samples.length - 1)) * VIEW_W).toFixed(2)},${y(s.wpm).toFixed(2)}`)
    .join(' ');

  const current = samples.length > 0 ? samples[samples.length - 1].wpm : 0;

  return (
    <div className="typing-stat typing-stat--pulse">
      <svg
        className="typing-pulse-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${Math.round(current)} WPM`}
      >
        {averageWpm > 0 && (
          <line
            className="typing-pulse-baseline"
            x1="0"
            x2={VIEW_W}
            y1={y(averageWpm)}
            y2={y(averageWpm)}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {samples.length > 1 && (
          <polyline className="typing-pulse-line" fill="none" points={points} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <span className="typing-stat-label">{label}</span>
    </div>
  );
}
