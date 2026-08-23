/*
 * One row per day, sleep drawn where it actually happened against a midnight-to-midnight clock.
 *
 * A night crosses midnight, so it is drawn as two blocks: the tail of one row and the head of the
 * next, which abut across the row gap and read as one bar. The alternative — a noon-to-noon axis,
 * which keeps every night unbroken — was rejected because it files a 9am nap under the previous
 * date, and the morning nap is the commonest kind. Bedtime drift is `ClockSpreadChart`'s job, and it
 * handles the wraparound properly; this chart's job is to show the shape of a day.
 *
 * Both halves of a clipped night carry the *same* `<title>`, naming the whole block. The split is an
 * artefact of drawing on a 24-hour axis and must not read as two separate sleeps.
 *
 * The bedtime routine is drawn on the same rows as two slim bars half the row's height, meeting at
 * the crib: bath to crib solid, crib to asleep dimmed, and a tick where they meet. The second is the
 * settling time the tiles report, drawn rather than left as a gap because a gap is also what an
 * unlogged evening looks like — an empty stretch says nothing about whether anyone was sitting in
 * the dark for it. Half height because a routine is not a sleep, and a bar of the same weight beside
 * the night would read as one. Drawn first, so where a mis-log overlaps a sleep the sleep is what
 * you see.
 *
 * Two deliberate departures from the house chart style:
 *   - `HEIGHT` is computed from the row count rather than fixed, so thirty days grows the viewBox
 *     instead of squashing each row to three pixels.
 *   - The hour ticks thin out as the window grows, because twenty-four labels collide well before a
 *     phone's width runs out.
 */

import { effectiveEnd, segmentsForDay } from '../../utils/babySleep/days';
import { formatHm } from '../../utils/babySleep/format';
import type { RoutineRecord } from '../../utils/babySleep/routine';
import type { RoutineSegment } from '../../utils/babySleep/routineStats';
import { routineSegmentsForDay } from '../../utils/babySleep/routineStats';
import type { DayBucket, SleepEntry } from '../../utils/babySleep/types';

interface SleepTimelineProps {
  days: DayBucket[];
  /**
   * Every entry, not just the ones attributed to these days: a night is drawn on the row it began on
   * *and* on the row its morning falls in, and only the first of those two rows has it attributed.
   */
  entries: SleepEntry[];
  /** Every routine record, live or not — `routineSegmentsForDay` decides which are drawable. */
  routines: RoutineRecord[];
  /** When each night began, by night key: what ends the settling. See `asleepByNight`. */
  asleep: Map<string, number>;
  now: number;
  formatDay: (t: number) => string;
  formatTime: (t: number) => string;
  /** The two tooltips, built by the caller so this chart needs no translation table. */
  routineLabel: (from: string, to: string | null) => string;
  settleLabel: (from: string, duration: string | null) => string;
  ariaLabel: string;
  emptyLabel: string;
}

const WIDTH = 600;
const MARGIN = { top: 18, right: 10, bottom: 20, left: 62 };
const ROW_H = 16;
const ROW_GAP = 3;
const ROUTINE_H = 6;
const MAX_ROW_LABELS = 16;

export default function SleepTimeline({
  days,
  entries,
  routines,
  asleep,
  now,
  formatDay,
  formatTime,
  routineLabel,
  settleLabel,
  ariaLabel,
  emptyLabel,
}: SleepTimelineProps) {
  const rowSegments = days.map((day) => segmentsForDay(entries, day, now));
  const rowRoutines = days.map((day) => routineSegmentsForDay(routines, asleep, day, now));

  /* Each bar names the stretch it is, so the settling one is not read as more routine. A settle
     still running has no duration to print — nobody has fallen asleep yet. */
  const titleOf = (seg: RoutineSegment) =>
    seg.phase === 'routine'
      ? routineLabel(
          formatTime(seg.routine.start),
          seg.routine.end == null ? null : formatTime(seg.routine.end)
        )
      : settleLabel(
          formatTime(seg.routine.end as number),
          seg.running ? null : formatHm(seg.end - (seg.routine.end as number))
        );

  /* A window holding routines and no sleep at all is still a chart worth drawing. */
  if (
    days.length === 0 ||
    (rowSegments.every((segs) => segs.length === 0) &&
      rowRoutines.every((segs) => segs.length === 0))
  ) {
    return (
      <div className="bs-chart bs-chart--empty">
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const rows = days.length;
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const height = MARGIN.top + rows * (ROW_H + ROW_GAP) + MARGIN.bottom;
  const rowY = (i: number) => MARGIN.top + i * (ROW_H + ROW_GAP);

  /* A DST day is 23 or 25 hours long, so each row is scaled by its own span rather than by a
     constant — otherwise every row after a changeover sits an hour out of column with the ticks. */
  const xIn = (day: DayBucket, t: number) =>
    MARGIN.left + ((t - day.start) / (day.end - day.start)) * plotW;

  const hourStep = rows > 20 ? 6 : rows > 10 ? 4 : 3;
  const hours: number[] = [];
  for (let h = 0; h <= 24; h += hourStep) hours.push(h);

  const labelEvery = Math.ceil(rows / MAX_ROW_LABELS);

  return (
    <div className="bs-chart">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label={ariaLabel}>
        {hours.map((h) => {
          const x = MARGIN.left + (h / 24) * plotW;
          return (
            <g key={h}>
              <line className="bs-chart-grid" x1={x} x2={x} y1={MARGIN.top - 4} y2={height - MARGIN.bottom} />
              <text className="bs-chart-tick" x={x} y={MARGIN.top - 8} textAnchor="middle">
                {h === 24 ? '24' : String(h)}
              </text>
            </g>
          );
        })}

        {days.map((day, i) => {
          const y = rowY(i);
          return (
            <g key={day.key}>
              {i % labelEvery === 0 && (
                <text
                  className="bs-chart-tick"
                  x={MARGIN.left - 8}
                  y={y + ROW_H - 4}
                  textAnchor="end"
                >
                  {formatDay(day.start)}
                </text>
              )}
              <rect
                className={`bs-row${day.partial ? ' bs-row--partial' : ''}`}
                x={MARGIN.left}
                y={y}
                width={plotW}
                height={ROW_H}
              />
              {rowRoutines[i].map((seg) => {
                const x1 = xIn(day, seg.start);
                const x2 = xIn(day, seg.end);
                const title = titleOf(seg);
                return (
                  <g key={`${seg.phase}-${seg.routine.id}-${day.key}`}>
                    <rect
                      className={`bs-block--${seg.phase}`}
                      x={x1}
                      y={y + (ROW_H - ROUTINE_H) / 2}
                      width={Math.max(1, x2 - x1)}
                      height={ROUTINE_H}
                    >
                      <title>{title}</title>
                    </rect>
                    {/* The crib, full height, so that the two bars either side of it read as the two
                        halves of the evening they are. A routine still running has no such moment
                        yet, and the missing tick is what says so. */}
                    {seg.endsHere && (
                      <rect className="bs-crib-tick" x={x2 - 1} y={y} width={2} height={ROW_H}>
                        <title>{title}</title>
                      </rect>
                    )}
                  </g>
                );
              })}
              {rowSegments[i].map((seg) => {
                const { entry } = seg;
                const x1 = xIn(day, seg.start);
                const x2 = xIn(day, seg.end);
                const running = entry.end == null;
                const end = effectiveEnd(entry, now);
                /* Both halves of a night name the *whole* block. The split is an artefact of drawing
                   a 24-hour axis and must not read as two separate sleeps. */
                const whole = `${formatTime(entry.start)} – ${
                  running ? '…' : formatTime(entry.end as number)
                } · ${formatHm(end - entry.start)}`;
                return (
                  <rect
                    key={`${entry.id}-${day.key}`}
                    className={`bs-block bs-block--${entry.kind}${running ? ' bs-block--running' : ''}`}
                    x={x1}
                    y={y}
                    width={Math.max(1, x2 - x1)}
                    height={ROW_H}
                  >
                    <title>{whole}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        <line
          className="bs-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={height - MARGIN.bottom + 2}
          y2={height - MARGIN.bottom + 2}
        />
      </svg>
    </div>
  );
}
