/*
 * A value per day, with its mean and ±1 SD band — the drawing, and nothing else.
 *
 * The line here is that this file **does not know what it is plotting**. It is handed numbers already
 * in the axis's own units and a function that turns one into a string, so a clock time (minutes,
 * circular, unwrapped by its caller) and a sleep duration (milliseconds, linear) draw as one chart in
 * two places rather than two charts that drift apart. `ClockSpreadChart` and `DurationSpreadChart`
 * are the two thin wrappers that do know. The `average` series arrives the same way: already
 * smoothed, already in axis units, so the trailing mean of a duration and a trailing mean of
 * anything else would both draw here without this file learning a thing.
 *
 * The chart itself never depended on hue — dots, a dashed mean and a solid target are three
 * different marks — but its legend did: three solid squares at grayscale 229, 247 and 220, which is
 * one square printed three times. So the legend draws the real mark instead, `SeriesSwatch` giving
 * each entry the line style and dash it has in the plot.
 *
 * `y` and `value` are separate for the clock's sake: an unwrapped bedtime may be plotted at -20 or
 * 1470 minutes so the axis reads in order across midnight, and a tooltip printing that number would
 * name a time nobody experienced. The plotted number and the printed one are different facts.
 */

import ChartReadout from '../charts/ChartReadout';
import { SeriesSwatch } from '../charts/ChartMarks';
import { useChartPointer } from '../charts/useChartPointer';
import { nearestIndex } from '../../utils/charts/hitTest';

interface SpreadPoint {
  /** Local midnight of the day — the x value. */
  at: number;
  /** Where the dot goes, in axis units. */
  y: number;
  /** What the tooltip prints, in axis units. Usually the same number as `y`. */
  value: number;
}

interface SpreadChartProps {
  points: SpreadPoint[];
  /** The mean, in axis units, or null when there is not one. */
  mean: number | null;
  /** The ±1 SD band, in axis units. */
  band: { lo: number; hi: number } | null;
  formatValue: (v: number) => string;
  formatDay: (t: number) => string;
  /** Candidate gaps between gridlines, ascending, in axis units. */
  tickSteps: number[];
  /** Never zoom in tighter than this, or a tidy routine looks like chaos. */
  minSpan: number;
  /**
   * A value the axis may not go below, where one exists. A duration axis padded past zero prints two
   * gridlines both labelled "0m"; a clock axis has no such floor, since it is centred on a mean and
   * negative minutes are last night.
   */
  floor?: number;
  /**
   * A goal in axis units, set by the human rather than computed from the dots — see `targets.ts`.
   *
   * Solid where the mean is dashed, because the two lines answer different questions and a reader
   * glancing at the chart has to be able to tell what it *was* from what it is *meant to be*. It
   * widens the axis like any other value: a target the dots are nowhere near is exactly the case
   * worth seeing, and a line that quietly falls off the top reads as no target at all.
   */
  target?: { value: number; label: string } | null;
  /**
   * A smoothed series through the dots — a trailing mean, in axis units, one value for some of the
   * days rather than all of them.
   *
   * It answers the question the flat `mean` line cannot: not how much this varies, but which way it
   * is going. Its points widen the axis like every other value, and it is drawn over the mean it
   * refines and under the dots it is derived from.
   */
  average?: { points: { at: number; value: number }[]; label: string } | null;
  label: string;
  meanLabel: string;
  spreadLabel: string;
  ariaLabel: string;
  emptyLabel: string;
  /** What the readout says when nothing is being pointed at. */
  hintLabel: string;
}

const WIDTH = 600;
const HEIGHT = 200;
const MARGIN = { top: 12, right: 14, bottom: 26, left: 50 };
/** Above this the labels start to collide, so the next step up is taken. */
const MAX_TICKS = 8;

function stepFor(span: number, steps: number[]): number {
  return steps.find((s) => span / s <= MAX_TICKS) ?? steps[steps.length - 1];
}

export default function SpreadChart({
  points,
  mean,
  band,
  formatValue,
  formatDay,
  tickSteps,
  minSpan,
  floor,
  target,
  average,
  label,
  meanLabel,
  spreadLabel,
  ariaLabel,
  emptyLabel,
  hintLabel,
}: SpreadChartProps) {
  // Above the empty guard, because a hook cannot sit behind a return.
  const { svgRef, at, handlers } = useChartPointer();

  if (points.length === 0) {
    return (
      <div className="bs-chart bs-chart--empty">
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const averagePoints = average?.points ?? [];
  const spread = [
    ...points.map((p) => p.y),
    ...(band ? [band.lo, band.hi] : []),
    ...(target ? [target.value] : []),
    ...averagePoints.map((p) => p.value),
  ];
  const rawLo = Math.min(...spread);
  const rawHi = Math.max(...spread);
  const pad = Math.max(minSpan / 9, (rawHi - rawLo) * 0.15);
  let lo = rawLo - pad;
  let hi = rawHi + pad;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (floor != null && lo < floor) {
    lo = floor;
    hi = Math.max(hi, floor + minSpan);
  }

  const y = (v: number) => MARGIN.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const times = points.map((p) => p.at);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const single = tMin === tMax;
  const x = (t: number) =>
    single ? MARGIN.left + plotW / 2 : MARGIN.left + ((t - tMin) / (tMax - tMin)) * plotW;

  const step = stepFor(hi - lo, tickSteps);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  const hit = at == null ? null : nearestIndex(points.map((p) => x(p.at)), at.x);
  const hitPoint = hit == null ? null : points[hit];
  /* The average is one value per *night*, not per pixel, so it is looked up by the day the dot is
     filed under rather than by the pointer's own x — the two lines are read together or the
     smoothed number belongs to a different night than the raw one beside it. */
  const hitAverage =
    hitPoint == null ? null : (averagePoints.find((p) => p.at === hitPoint.at)?.value ?? null);

  const readout =
    hitPoint == null
      ? null
      : [
          `${formatDay(hitPoint.at)} · ${label} ${formatValue(hitPoint.value)}`,
          hitAverage == null || average == null
            ? null
            : `${average.label} ${formatValue(hitAverage)}`,
        ]
          .filter(Boolean)
          .join(' · ');

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
        {/* First, so it is under everything: the empty parts of the panel are most of it, and a
            pointer that only exists over a 4px dot is a pointer nobody can aim. */}
        <rect className="chart-surface" x={0} y={0} width={WIDTH} height={HEIGHT} />

        {band && (
          <rect
            className="bs-spread-band"
            x={MARGIN.left}
            y={y(band.hi)}
            width={plotW}
            height={Math.max(1, y(band.lo) - y(band.hi))}
          >
            <title>{`${spreadLabel} ${formatValue(band.lo)} – ${formatValue(band.hi)}`}</title>
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
              {formatValue(v)}
            </text>
          </g>
        ))}

        {hitPoint && (
          <line
            className="chart-guide"
            x1={x(hitPoint.at)}
            x2={x(hitPoint.at)}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
          />
        )}

        {/* Under the mean line and over the gridlines: where the two coincide, the mean is the fact
            and the target is the intention, and it is the fact that must stay readable. */}
        {target && (
          <line
            className="bs-target-line"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(target.value)}
            y2={y(target.value)}
          >
            <title>{`${target.label} ${formatValue(target.value)}`}</title>
          </line>
        )}

        {mean != null && (
          <line
            className="bs-mean-line"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(mean)}
            y2={y(mean)}
          />
        )}

        {/* Over the flat mean it refines, under the dots it is made of. */}
        {averagePoints.length > 0 && (
          <polyline
            className="bs-avg-line"
            fill="none"
            points={averagePoints.map((p) => `${x(p.at)},${y(p.value)}`).join(' ')}
          />
        )}

        {points.map((p) => (
          <circle key={`${p.at}-${p.value}`} className="bs-dot" cx={x(p.at)} cy={y(p.y)} r={4}>
            <title>{`${formatDay(p.at)} · ${label} ${formatValue(p.value)}`}</title>
          </circle>
        ))}

        {hitPoint && (
          <circle
            className="bs-dot chart-hit"
            cx={x(hitPoint.at)}
            cy={y(hitPoint.y)}
            r={5}
          />
        )}

        <text className="bs-chart-tick" x={MARGIN.left} y={HEIGHT - 8} textAnchor="start">
          {formatDay(tMin)}
        </text>
        {!single && (
          <text className="bs-chart-tick" x={WIDTH - MARGIN.right} y={HEIGHT - 8} textAnchor="end">
            {formatDay(tMax)}
          </text>
        )}
      </svg>

      <ChartReadout text={readout} hint={hintLabel} />

      <ul className="bs-legend">
        <li>
          <SeriesSwatch className="bs-dot" shape="disc" line={false} />
          {label}
        </li>
        {mean != null && (
          <li>
            <SeriesSwatch className="bs-mean-line" />
            {meanLabel}
            <span className="bs-legend-value">{formatValue(mean)}</span>
          </li>
        )}
        {averagePoints.length > 0 && average && (
          <li>
            <SeriesSwatch className="bs-avg-line" />
            {average.label}
          </li>
        )}
        {/* The band is an area and keeps its filled square — there is no line or mark to draw, and
            its job in the legend is to name a colour the reader has already seen behind the dots. */}
        {band && (
          <li>
            <span className="bs-swatch bs-swatch--band" aria-hidden="true" />
            {spreadLabel}
          </li>
        )}
        {target && (
          <li>
            <SeriesSwatch className="bs-target-line" />
            {target.label}
            <span className="bs-legend-value">{formatValue(target.value)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
