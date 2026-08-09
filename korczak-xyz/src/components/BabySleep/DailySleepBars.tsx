/*
 * Total sleep per day, night and nap stacked, with the window's mean drawn across it.
 *
 * A day still in progress is hatched rather than dropped: today's bar is real data and worth seeing,
 * but it is short only because the day is not over, and an unmarked short bar reads as a bad night.
 * The mean line comes from `stats.totalPerDay`, which excludes those days for the same reason.
 */

import { formatHm } from '../../utils/babySleep/format';
import type { DayBucket, MeanStat } from '../../utils/babySleep/types';

interface DailySleepBarsProps {
  days: DayBucket[];
  mean: MeanStat;
  formatDay: (t: number) => string;
  labels: { night: string; nap: string; incomplete: string; mean: string };
  ariaLabel: string;
  emptyLabel: string;
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
}: DailySleepBarsProps) {
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

  return (
    <div className="bs-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel}>
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
          const title = `${formatDay(day.start)} · ${labels.night} ${formatHm(night)} · ${
            labels.nap
          } ${formatHm(day.napMs)}${day.partial ? ` · ${labels.incomplete}` : ''}`;
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
                <rect
                  className={`bs-bar bs-bar--nap${day.partial ? ' bs-bar--partial' : ''}`}
                  x={x}
                  y={y(total)}
                  width={barW}
                  height={Math.max(0, y(night) - y(total))}
                >
                  <title>{title}</title>
                </rect>
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
      </svg>

      <ul className="bs-legend">
        <li>
          <span className="bs-swatch bs-swatch--night" aria-hidden="true" />
          {labels.night}
        </li>
        <li>
          <span className="bs-swatch bs-swatch--nap" aria-hidden="true" />
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
