/*
 * The needle.
 *
 * Drawn on a canvas from an animation frame rather than rendered from React state: the value it
 * shows changes continuously, and re-rendering a component tree sixty times a second to move a
 * line is work the phone would rather spend on the detector. The component re-renders only when
 * the string being tuned changes.
 */

import { useEffect, useRef } from 'react';
import { IN_TUNE_CENTS, STANDARD_TUNING } from '../../utils/tuner/notes';
import type { TunerReading } from './useTunerEngine';

/** The needle's full sweep. Beyond this a guitarist is not tuning, they are changing the note. */
const DISPLAY_RANGE_CENTS = 50;
const SWEEP_RADIANS = Math.PI / 2; // 90 degrees end to end

/** Inner edge of the visible arc band, as a fraction of the radius. */
const BAND_INNER = 0.86;

const COLOR_IN_TUNE = '#00ff00';
const COLOR_OFF = '#ff2020';
const COLOR_FACE = '#000000';
const COLOR_TICK = '#00a0a0';
const COLOR_TICK_MAJOR = '#00ffff';
const COLOR_DIM = '#404040';

interface TunerDialProps {
  readingRef: React.RefObject<TunerReading>;
  /** False before the microphone starts, so the dial can sit dark instead of pretending. */
  active: boolean;
}

export default function TunerDial({ readingRef, active }: TunerDialProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    // The needle is animated towards the reading rather than snapped to it, so that a note
    // appearing or vanishing is a sweep rather than a jump.
    let shownCents = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return false;
      const wanted = [Math.round(width * ratio), Math.round(height * ratio)];
      if (canvas.width !== wanted[0] || canvas.height !== wanted[1]) {
        canvas.width = wanted[0];
        canvas.height = wanted[1];
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      return true;
    };

    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (!resize()) return;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const reading = readingRef.current;
      const live = activeRef.current && reading.stringIndex !== null;

      const target = live ? clamp(reading.cents, -DISPLAY_RANGE_CENTS, DISPLAY_RANGE_CENTS) : 0;
      shownCents += (target - shownCents) * 0.25;

      ctx.fillStyle = COLOR_FACE;
      ctx.fillRect(0, 0, width, height);

      /*
       * The pivot sits *below* the canvas, so only the outer band of the sweep is visible. A
       * needle hinged inside the face would swing straight through the middle of it, which is
       * where the note name has to go — the note is the thing being read at a glance, and it
       * cannot share space with a line that moves.
       */
      const pivotX = width / 2;
      const radius = width * 0.664;
      const pivotY = height * 0.06 + radius;

      drawScale(ctx, pivotX, pivotY, radius, live);
      drawNeedle(ctx, pivotX, pivotY, radius, shownCents, live, reading.inTune);
      drawNoteName(ctx, width, height, reading, live);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [readingRef]);

  return <canvas ref={canvasRef} className="tuner-dial-canvas" aria-hidden="true" />;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Cents to an angle measured from straight up, positive clockwise. */
function centsToAngle(cents: number): number {
  return (cents / DISPLAY_RANGE_CENTS) * (SWEEP_RADIANS / 2);
}

function drawScale(
  ctx: CanvasRenderingContext2D,
  pivotX: number,
  pivotY: number,
  radius: number,
  live: boolean,
): void {
  // The in-tune band, drawn as a wedge so that "close enough" is a place on the dial rather than
  // a number the player has to interpret.
  const half = centsToAngle(IN_TUNE_CENTS);
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, radius, -Math.PI / 2 - half, -Math.PI / 2 + half);
  ctx.arc(pivotX, pivotY, radius * BAND_INNER, -Math.PI / 2 + half, -Math.PI / 2 - half, true);
  ctx.closePath();
  ctx.fillStyle = live ? 'rgba(0, 255, 0, 0.22)' : 'rgba(0, 255, 0, 0.07)';
  ctx.fill();

  for (let cents = -DISPLAY_RANGE_CENTS; cents <= DISPLAY_RANGE_CENTS; cents += 5) {
    const major = cents % 25 === 0;
    const angle = -Math.PI / 2 + centsToAngle(cents);
    const inner = radius * (major ? BAND_INNER : BAND_INNER + 0.03);
    ctx.beginPath();
    ctx.moveTo(pivotX + Math.cos(angle) * inner, pivotY + Math.sin(angle) * inner);
    ctx.lineTo(pivotX + Math.cos(angle) * radius, pivotY + Math.sin(angle) * radius);
    ctx.lineWidth = major ? 3 : 1;
    ctx.strokeStyle = live ? (major ? COLOR_TICK_MAJOR : COLOR_TICK) : COLOR_DIM;
    ctx.stroke();
  }

  // Only the two extremes are labelled. The exact figure is spelled out under the dial anyway,
  // and a full set of numbers inside the band crowds the note name for no added meaning.
  ctx.font = `${Math.round(radius * 0.062)}px 'VT323', monospace`;
  ctx.fillStyle = live ? COLOR_TICK : COLOR_DIM;
  ctx.textBaseline = 'middle';
  for (const cents of [-DISPLAY_RANGE_CENTS, DISPLAY_RANGE_CENTS]) {
    const angle = -Math.PI / 2 + centsToAngle(cents);
    const labelRadius = radius * (BAND_INNER - 0.05);
    ctx.textAlign = cents < 0 ? 'left' : 'right';
    ctx.fillText(
      cents > 0 ? `+${cents}` : String(cents),
      pivotX + Math.cos(angle) * labelRadius,
      pivotY + Math.sin(angle) * labelRadius,
    );
  }
}

function drawNeedle(
  ctx: CanvasRenderingContext2D,
  pivotX: number,
  pivotY: number,
  radius: number,
  cents: number,
  live: boolean,
  inTune: boolean,
): void {
  const angle = -Math.PI / 2 + centsToAngle(cents);
  const colour = !live ? COLOR_DIM : inTune ? COLOR_IN_TUNE : COLOR_OFF;

  // Only the part of the needle that falls inside the visible band is drawn; the pivot itself is
  // off the bottom of the canvas.
  ctx.save();
  if (live) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = radius * 0.03;
  }
  ctx.beginPath();
  ctx.moveTo(
    pivotX + Math.cos(angle) * radius * (BAND_INNER - 0.02),
    pivotY + Math.sin(angle) * radius * (BAND_INNER - 0.02),
  );
  ctx.lineTo(pivotX + Math.cos(angle) * radius, pivotY + Math.sin(angle) * radius);
  ctx.lineWidth = Math.max(3, radius * 0.016);
  ctx.strokeStyle = colour;
  ctx.lineCap = 'butt';
  ctx.stroke();
  ctx.restore();
}

function drawNoteName(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  reading: TunerReading,
  live: boolean,
): void {
  const string = reading.stringIndex === null ? null : STANDARD_TUNING[reading.stringIndex];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Sits in the clear space under the arc band, which is why the needle is hinged off-canvas.
  const centreY = height * 0.66;
  const size = Math.round(Math.min(width, height) * 0.4);
  ctx.font = `${size}px 'VT323', monospace`;
  ctx.fillStyle = !live ? COLOR_DIM : reading.inTune ? COLOR_IN_TUNE : '#ffff00';
  ctx.fillText(string ? string.letter : '–', width / 2, centreY);

  if (string) {
    // The octave rides small and low beside the letter: it distinguishes the two E strings, which
    // is the only time anyone needs it.
    ctx.font = `${Math.round(size * 0.36)}px 'VT323', monospace`;
    ctx.fillText(String(string.octave), width / 2 + size * 0.4, centreY + size * 0.22);
  }
}
