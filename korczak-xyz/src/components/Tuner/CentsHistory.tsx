/*
 * A scrolling trace of the last few seconds of pitch.
 *
 * The needle says where the string is now; this says what it has been doing. That is the part
 * that tells you whether a string has actually settled or is still creeping flat after a peg
 * turn — a new string can read in tune for a second and drift out again while you listen, and a
 * single instantaneous reading cannot show that.
 */

import { useEffect, useRef } from 'react';
import { IN_TUNE_CENTS } from '../../utils/tuner/notes';
import { HISTORY_SECONDS, type TunerReading } from './useTunerEngine';

/** Vertical extent of the strip. Matches the dial's sweep so the two agree on what "far" means. */
const RANGE_CENTS = 50;

const COLOR_FACE = '#000000';
const COLOR_GRID = '#004040';
const COLOR_CENTRE = '#00a0a0';
const COLOR_BAND = 'rgba(0, 255, 0, 0.14)';
const COLOR_TRACE = '#ffff00';

interface CentsHistoryProps {
  readingRef: React.RefObject<TunerReading>;
  active: boolean;
}

export default function CentsHistory({ readingRef, active }: CentsHistoryProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      ctx.fillStyle = COLOR_FACE;
      ctx.fillRect(0, 0, width, height);

      const centsToY = (cents: number) =>
        height / 2 - (clamp(cents, -RANGE_CENTS, RANGE_CENTS) / RANGE_CENTS) * (height / 2 - 2);

      ctx.fillStyle = COLOR_BAND;
      ctx.fillRect(0, centsToY(IN_TUNE_CENTS), width, centsToY(-IN_TUNE_CENTS) - centsToY(IN_TUNE_CENTS));

      ctx.strokeStyle = COLOR_GRID;
      ctx.lineWidth = 1;
      for (const cents of [-25, 25]) {
        ctx.beginPath();
        ctx.moveTo(0, centsToY(cents));
        ctx.lineTo(width, centsToY(cents));
        ctx.stroke();
      }

      ctx.strokeStyle = COLOR_CENTRE;
      ctx.beginPath();
      ctx.moveTo(0, centsToY(0));
      ctx.lineTo(width, centsToY(0));
      ctx.stroke();

      const history = readingRef.current.history;
      if (!activeRef.current || history.length < 2) return;

      // Time is measured back from now, not from the oldest sample, so the trace keeps scrolling
      // while a note rings on unchanged instead of stretching to fill the strip.
      const now = performance.now();
      const spanMs = HISTORY_SECONDS * 1000;
      ctx.strokeStyle = COLOR_TRACE;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const point of history) {
        const age = now - point.time;
        if (age > spanMs) continue;
        const x = width * (1 - age / spanMs);
        const y = centsToY(point.cents);
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      ctx.stroke();
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [readingRef]);

  return <canvas ref={canvasRef} className="tuner-history-canvas" aria-hidden="true" />;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
