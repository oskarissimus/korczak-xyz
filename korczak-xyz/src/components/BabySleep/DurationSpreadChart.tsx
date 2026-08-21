/*
 * A duration per day, with its mean and ±1 SD — `ClockSpreadChart`'s linear twin.
 *
 * Nothing is unwrapped: eleven hours is eleven hours, there is no seam, and `y` and the tooltip's
 * value are the same number. What is left is the axis units (milliseconds, so `formatHm` can be
 * handed over as it is) and the two constants below.
 *
 * The axis does **not** start at zero, and that is deliberate. `DailySleepBars` above it already
 * answers "how much sleep" against a zero baseline; the question here is the other one — how much
 * last night differed from the night before — and an hour of variation inside a twelve-hour axis is
 * a flat line. The three-hour floor is what stops the zoom going the other way and turning twenty
 * minutes of ordinary drift into a mountain range.
 *
 * That floor is right for a night and wrong for everything shorter, so `minSpan` and `tickSteps` are
 * overridable. A settling time is minutes where a night is hours: the same three-hour floor that
 * stops one chart exaggerating flattens the other into a straight line along the bottom. The
 * defaults are the night's, because that is the chart this was written for.
 */

import { formatHm } from '../../utils/babySleep/format';
import type { DurationPoint } from '../../utils/babySleep/stats';
import type { MeanStat } from '../../utils/babySleep/types';
import SpreadChart from './SpreadChart';

interface DurationSpreadChartProps {
  points: DurationPoint[];
  stat: MeanStat;
  formatDay: (t: number) => string;
  /** Never zoom in tighter than this. Defaults to three hours — a whole night's scale. */
  minSpan?: number;
  /** Candidate gridline gaps, ascending. Defaults to the night's. */
  tickSteps?: number[];
  label: string;
  meanLabel: string;
  spreadLabel: string;
  ariaLabel: string;
  emptyLabel: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MIN_SPAN = 3 * HOUR;
const TICK_STEPS = [30 * MINUTE, HOUR, 2 * HOUR];

/** For a chart of minutes rather than hours — the crib-to-sleep gap. */
export const SHORT_MIN_SPAN = 30 * MINUTE;
export const SHORT_TICK_STEPS = [5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE];

export default function DurationSpreadChart({
  points,
  stat,
  formatDay,
  minSpan = MIN_SPAN,
  tickSteps = TICK_STEPS,
  ...labels
}: DurationSpreadChartProps) {
  const band =
    stat.mean != null && stat.sd != null
      ? // A night is never negative, however wide the spread, and an axis labelled "-0h 20m" reads as
        // a bug rather than as a wide band.
        { lo: Math.max(0, stat.mean - stat.sd), hi: stat.mean + stat.sd }
      : null;

  return (
    <SpreadChart
      points={points.map((p) => ({ at: p.at, y: p.ms, value: p.ms }))}
      mean={stat.mean}
      band={band}
      formatValue={formatHm}
      formatDay={formatDay}
      tickSteps={tickSteps}
      minSpan={minSpan}
      floor={0}
      {...labels}
    />
  );
}
