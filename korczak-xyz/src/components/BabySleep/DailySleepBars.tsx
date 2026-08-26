/*
 * Total sleep per day, night and nap stacked, with the window's mean drawn across it.
 *
 * A day still in progress is dimmed rather than dropped: today's bar is real data and worth seeing,
 * but it is short only because the day is not over, and an unmarked short bar reads as a bad night.
 * The mean line comes from `stats.totalPerDay`, which excludes those days for the same reason.
 * (This note said "hatched" for a long time and the stylesheet said `opacity: 0.45`; the stylesheet
 * was the truth. Hatching is now what tells the *nap* from the night, which is a different job.)
 *
 * The two stacked segments are the night and the nap, and they used to be told apart by hue alone —
 * grayscale 118 against 160, a contrast of 1.74 across an edge that moves from bar to bar. The nap
 * carries the diagonal texture now, and its teal was re-stepped to 195.
 */

import ChartReadout from '../charts/ChartReadout';
import ChartTextures, { TEXTURE, texture } from '../charts/ChartTextures';
import { useChartPointer } from '../charts/useChartPointer';
import { bandIndex } from '../../utils/charts/hitTest';
import { formatHm } from '../../utils/babySleep/format';
import type { DayBucket, MeanStat } from '../../utils/babySleep/types';

interface DailySleepBarsProps {
  days: DayBucket[];
  mean: MeanStat;
  formatDay: (t: number) => string;
  labels: { night: string; nap: string; incomplete: string; mean: string };
  ariaLabel: string;
  emptyLabel: string;
  /** What the readout says when nothing is being pointed at. */
  hintLabel: string;
}

const WIDTH = 600;
const HEIGHT = 240;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };
const HOUR = 3_600_000;
const MAX_DAY_LABELS = 10;

export default function DailySleepBars({
  days,
  mean,
  formatDay,
  labels,
  ariaLabel,
  emptyLabel,
  hintLabel,
}: DailySleepBarsProps) {
  // Above the empty guard, because a hook cannot sit behind a return.
  const { svgRef, at, handlers } = useChartPointer();

  const totals = days.map((d) => (d.nightMs ?? 0) + d.napMs);
  if (days.length === 0 || totals.every((v) => v === 0)) {
    return (
      <div className="bs-chart bs-chart--empty">
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  // Round the top up to a whole hour so the gridlines land on readable numbers.
  const peak = Math.max(...totals, mean.mean ?? 0);
  const yMax = Math.max(2 * HOUR, Math.ceil(peak / HOUR) * HOUR);
  const y = (v: number) => MARGIN.top + (1 - v / yMax) * plotH;

  const slot = plotW / days.length;
  const barW = Math.max(2, Math.min(38, slot * 0.7));
  const barX = (i: number) => MARGIN.left + i * slot + (slot - barW) / 2;

  const tickStep = yMax > 16 * HOUR ? 4 * HOUR : 2 * HOUR;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax; v += tickStep) ticks.push(v);

  const labelEvery = Math.ceil(days.length / MAX_DAY_LABELS);

  /* One sentence, read by the `<title>` and by the readout alike, so the two can never come to
     disagree about a day. */
  const describe = (day: DayBucket) =>
    `${formatDay(day.start)} · ${labels.night} ${formatHm(day.nightMs ?? 0)} · ${
      labels.nap
    } ${formatHm(day.napMs)}${day.partial ? ` · ${labels.incomplete}` : ''}`;

  /* A day owns its slot, gap included: the space between two bars is still one of the two days, and
     asking the reader to hit a 38px bar with a thumb is asking them not to bother. */
  const hit = at == null ? null : bandIndex(at.x, MARGIN.left, slot, days.length);
  const hitDay = hit == null ? null : days[hit];

  return (
    <div className="bs-chart">
      <svg
        ref={svgRef}
        className="chart-interactive"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        {...handlers}
      >
        <ChartTextures />
        {/* Under everything, so the gaps between the bars are pointable too. */}
        <rect className="chart-surface" x={0} y={0} width={WIDTH} height={HEIGHT} />
        {ticks.map((v) => (
          <g key={v}>
            <line
              className="bs-chart-grid"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(v)}
              y2={y(v)}
            />
            <text className="bs-chart-tick" x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end">
              {`${Math.round(v / HOUR)}h`}
            </text>
          </g>
        ))}

        {days.map((day, i) => {
          const night = day.nightMs ?? 0;
          const total = night + day.napMs;
          const x = barX(i);
          const title = describe(day);
          return (
            <g key={day.key}>
              {night > 0 && (
                <rect
                  className={`bs-bar bs-bar--night${day.partial ? ' bs-bar--partial' : ''}`}
                  x={x}
                  y={y(night)}
                  width={barW}
                  height={Math.max(0, y(0) - y(night))}
                >
                  <title>{title}</title>
                </rect>
              )}
              {day.napMs > 0 && (
                <>
                  <rect
                    className={`bs-bar bs-bar--nap${day.partial ? ' bs-bar--partial' : ''}`}
                    x={x}
                    y={y(total)}
                    width={barW}
                    height={Math.max(0, y(night) - y(total))}
                  >
                    <title>{title}</title>
                  </rect>
                  {/* The texture rides the dimming of a partial day, or today's nap would come back
                      to full strength while the night beneath it faded. */}
                  <rect
                    className={`chart-tex${day.partial ? ' bs-bar--partial' : ''}`}
                    x={x}
                    y={y(total)}
                    width={barW}
                    height={Math.max(0, y(night) - y(total))}
                    fill={texture(TEXTURE.diagonal)}
                  />
                </>
              )}
              {i % labelEvery === 0 && (
                <text
                  className="bs-chart-tick"
                  x={x + barW / 2}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                >
                  {formatDay(day.start)}
                </text>
              )}
            </g>
          );
        })}

        {mean.mean != null && (
          <>
            <line
              className="bs-mean-line"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(mean.mean)}
              y2={y(mean.mean)}
            />
            <text
              className="bs-chart-tick bs-mean-label"
              x={WIDTH - MARGIN.right}
              y={y(mean.mean) - 4}
              textAnchor="end"
            >
              {`${labels.mean} ${formatHm(mean.mean)}`}
            </text>
          </>
        )}

        <line
          className="bs-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={y(0)}
          y2={y(0)}
        />

        {/* An outline rather than a fill: the bar's own two colours are the answer, and covering
            them to say "this one" would hide what was asked for. */}
        {hitDay && hit != null && (
          <rect
            className="chart-hit"
            fill="none"
            x={barX(hit) - 1}
            y={y((hitDay.nightMs ?? 0) + hitDay.napMs) - 1}
            width={barW + 2}
            height={Math.max(2, y(0) - y((hitDay.nightMs ?? 0) + hitDay.napMs) + 2)}
          />
        )}
      </svg>

      <ChartReadout text={hitDay ? describe(hitDay) : null} hint={hintLabel} />

      <ul className="bs-legend">
        <li>
          <span className="bs-swatch bs-swatch--night" aria-hidden="true" />
          {labels.night}
        </li>
        <li>
          <span className="bs-swatch bs-swatch--nap chart-swatch-tex--diagonal" aria-hidden="true" />
          {labels.nap}
        </li>
        <li>
          <span className="bs-swatch bs-swatch--partial" aria-hidden="true" />
          {labels.incomplete}
        </li>
      </ul>
    </div>
  );
}
