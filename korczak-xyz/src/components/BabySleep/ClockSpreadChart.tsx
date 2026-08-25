/*
 * A clock time per day, with its mean and ±1 SD.
 *
 * The drawing is `SpreadChart`'s. What is here is the one thing that is true of a clock axis and of
 * no other: it has a seam. Plotted naively, a run of bedtimes at 23:50, 00:05, 23:40 lands as three
 * points at the extreme top and bottom of the axis and reads as wild inconsistency, when in fact it
 * is fifteen minutes of variation. So every point goes through `unwrapAround` against the *circular*
 * mean: the axis is centred on that mean and values are moved to whichever representation sits
 * nearest it, which may be negative or past 1440. `formatClock` wraps them back into readable times,
 * so the axis can be labelled 23:00, 00:00, 01:00 in ascending order and a tooltip still names the
 * time that was actually slept.
 *
 * The SD band goes through the same unwrapping, for the same reason — a band placed on raw minutes
 * while the dots are unwrapped would sit a day away from the points it describes.
 *
 * `Typing/StatsChart.tsx` cannot do this: it has no area primitive for the band, its y ticks are
 * hardcoded to `Math.round(v)`, and its `markers: false` suppresses the dots rather than the line —
 * whereas here the dots are the data and there is no line at all.
 */

import { unwrapAround } from '../../utils/babySleep/circular';
import { formatClock } from '../../utils/babySleep/format';
import type { ClockPoint } from '../../utils/babySleep/stats';
import type { ClockStat } from '../../utils/babySleep/types';
import SpreadChart from './SpreadChart';

interface ClockSpreadChartProps {
  points: ClockPoint[];
  stat: ClockStat;
  formatDay: (t: number) => string;
  /** A goal clock time, in minutes after midnight, or null where the chart has none. */
  target?: number | null;
  targetLabel?: string;
  label: string;
  meanLabel: string;
  spreadLabel: string;
  ariaLabel: string;
  emptyLabel: string;
}

/** Minutes. Never zoom in tighter than three hours, or a tidy routine looks like chaos. */
const MIN_SPAN = 180;
const TICK_STEPS = [30, 60, 120];

export default function ClockSpreadChart({
  points,
  stat,
  formatDay,
  target,
  targetLabel,
  ...labels
}: ClockSpreadChartProps) {
  // With no mean direction — times spread right around the clock — there is nothing to centre on but
  // one of the points, and no band worth drawing.
  const center = stat.mean ?? points[0]?.minutes ?? 0;
  const sd = stat.sd;
  const band =
    stat.mean != null && sd != null ? { lo: stat.mean - sd, hi: stat.mean + sd } : null;

  return (
    <SpreadChart
      points={points.map((p) => ({
        at: p.at,
        y: unwrapAround(p.minutes, center),
        value: p.minutes,
      }))}
      mean={stat.mean}
      band={band}
      /* Unwrapped against the same centre as the dots, for the reason they are: a target of 19:15
         drawn on raw minutes beneath a run of bedtimes near midnight would sit a whole axis away
         from the points it is the goal for. */
      target={
        target != null && targetLabel
          ? { value: unwrapAround(target, center), label: targetLabel }
          : null
      }
      formatValue={formatClock}
      formatDay={formatDay}
      tickSteps={TICK_STEPS}
      minSpan={MIN_SPAN}
      {...labels}
    />
  );
}
