/*
 * A clock time per day, with its mean and ±1 SD.
 *
 * The y-axis is a clock, and a clock has a seam. Plotted naively, a run of bedtimes at 23:50, 00:05,
 * 23:40 lands as three points at the extreme top and bottom of the axis and reads as wild
 * inconsistency, when in fact it is fifteen minutes of variation. So every point goes through
 * `unwrapAround` against the *circular* mean: the axis is centred on that mean and values are moved
 * to whichever representation sits nearest it, which may be negative or past 1440. `formatClock`
 * wraps them back into readable times for the ticks, so the axis can be labelled 23:00, 00:00, 01:00
 * in ascending order.
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

interface ClockSpreadChartProps {
  points: ClockPoint[];
  stat: ClockStat;
  formatDay: (t: number) => string;
  label: string;
  meanLabel: string;
  spreadLabel: string;
  ariaLabel: string;
  emptyLabel: string;
}

const WIDTH = 600;
const HEIGHT = 200;
const MARGIN = { top: 12, right: 14, bottom: 26, left: 50 };
/** Never zoom in tighter than this, or a tidy routine looks like chaos. */
const MIN_SPAN_MINUTES = 180;

export default function ClockSpreadChart({
  points,
  stat,
  formatDay,
  label,
  meanLabel,
  spreadLabel,
  ariaLabel,
  emptyLabel,
}: ClockSpreadChartProps) {
  if (points.length === 0) {
    return (
      <div className="bs-chart bs-chart--empty">
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  // With no mean direction — times spread right around the clock — there is nothing to centre on but
  // one of the points, and no band worth drawing.
  const center = stat.mean ?? points[0].minutes;
  const values = points.map((p) => ({ ...p, y: unwrapAround(p.minutes, center) }));

  const sd = stat.sd;
  const bandLo = stat.mean != null && sd != null ? stat.mean - sd : null;
  const bandHi = stat.mean != null && sd != null ? stat.mean + sd : null;

  const spread = [...values.map((v) => v.y), ...(bandLo != null ? [bandLo, bandHi as number] : [])];
  const rawLo = Math.min(...spread);
  const rawHi = Math.max(...spread);
  const pad = Math.max(20, (rawHi - rawLo) * 0.15);
  let lo = rawLo - pad;
  let hi = rawHi + pad;
  if (hi - lo < MIN_SPAN_MINUTES) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_SPAN_MINUTES / 2;
    hi = mid + MIN_SPAN_MINUTES / 2;
  }

  const y = (v: number) => MARGIN.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const times = values.map((v) => v.at);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const single = tMin === tMax;
  const x = (t: number) =>
    single ? MARGIN.left + plotW / 2 : MARGIN.left + ((t - tMin) / (tMax - tMin)) * plotW;

  // Ticks on whole hours inside the range, thinned so they cannot collide.
  const step = hi - lo > 480 ? 120 : hi - lo > 240 ? 60 : 30;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  return (
    <div className="bs-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel}>
        {bandLo != null && bandHi != null && (
          <rect
            className="bs-spread-band"
            x={MARGIN.left}
            y={y(bandHi)}
            width={plotW}
            height={Math.max(1, y(bandLo) - y(bandHi))}
          >
            <title>{`${spreadLabel} ${formatClock(bandLo)} – ${formatClock(bandHi)}`}</title>
          </rect>
        )}

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
              {formatClock(v)}
            </text>
          </g>
        ))}

        {stat.mean != null && (
          <line
            className="bs-mean-line"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(stat.mean)}
            y2={y(stat.mean)}
          />
        )}

        {values.map((v) => (
          <circle key={`${v.at}-${v.minutes}`} className="bs-dot" cx={x(v.at)} cy={y(v.y)} r={4}>
            <title>{`${formatDay(v.at)} · ${label} ${formatClock(v.minutes)}`}</title>
          </circle>
        ))}

        <text className="bs-chart-tick" x={MARGIN.left} y={HEIGHT - 8} textAnchor="start">
          {formatDay(tMin)}
        </text>
        {!single && (
          <text className="bs-chart-tick" x={WIDTH - MARGIN.right} y={HEIGHT - 8} textAnchor="end">
            {formatDay(tMax)}
          </text>
        )}
      </svg>

      <ul className="bs-legend">
        <li>
          <span className="bs-swatch bs-swatch--dot" aria-hidden="true" />
          {label}
        </li>
        {stat.mean != null && (
          <li>
            <span className="bs-swatch bs-swatch--mean" aria-hidden="true" />
            {meanLabel}
            <span className="bs-legend-value">{formatClock(stat.mean)}</span>
          </li>
        )}
        {bandLo != null && (
          <li>
            <span className="bs-swatch bs-swatch--band" aria-hidden="true" />
            {spreadLabel}
          </li>
        )}
      </ul>
    </div>
  );
}
