/*
 * A value per day, with its mean and ±1 SD band — the drawing, and nothing else.
 *
 * The line here is that this file **does not know what it is plotting**. It is handed numbers already
 * in the axis's own units and a function that turns one into a string, so a clock time (minutes,
 * circular, unwrapped by its caller) and a sleep duration (milliseconds, linear) draw as one chart in
 * two places rather than two charts that drift apart. `ClockSpreadChart` and `DurationSpreadChart`
 * are the two thin wrappers that do know.
 *
 * `y` and `value` are separate for the clock's sake: an unwrapped bedtime may be plotted at -20 or
 * 1470 minutes so the axis reads in order across midnight, and a tooltip printing that number would
 * name a time nobody experienced. The plotted number and the printed one are different facts.
 */

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
  label: string;
  meanLabel: string;
  spreadLabel: string;
  ariaLabel: string;
  emptyLabel: string;
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
  label,
  meanLabel,
  spreadLabel,
  ariaLabel,
  emptyLabel,
}: SpreadChartProps) {
  if (points.length === 0) {
    return (
      <div className="bs-chart bs-chart--empty">
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const spread = [
    ...points.map((p) => p.y),
    ...(band ? [band.lo, band.hi] : []),
    ...(target ? [target.value] : []),
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

  return (
    <div className="bs-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel}>
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

        {points.map((p) => (
          <circle key={`${p.at}-${p.value}`} className="bs-dot" cx={x(p.at)} cy={y(p.y)} r={4}>
            <title>{`${formatDay(p.at)} · ${label} ${formatValue(p.value)}`}</title>
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
        {mean != null && (
          <li>
            <span className="bs-swatch bs-swatch--mean" aria-hidden="true" />
            {meanLabel}
            <span className="bs-legend-value">{formatValue(mean)}</span>
          </li>
        )}
        {band && (
          <li>
            <span className="bs-swatch bs-swatch--band" aria-hidden="true" />
            {spreadLabel}
          </li>
        )}
        {target && (
          <li>
            <span className="bs-swatch bs-swatch--target" aria-hidden="true" />
            {target.label}
            <span className="bs-legend-value">{formatValue(target.value)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
