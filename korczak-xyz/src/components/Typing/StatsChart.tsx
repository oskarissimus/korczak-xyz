// Minimal multi-series SVG line chart for the typing stats page. WPM and
// accuracy share the left 0-100 y-axis (both happen to live in that range).
// An optional right axis (time spent, in minutes) appears only while a series
// is bound to it; its ticks are tinted the series color so the axis-to-series
// binding stays unambiguous.
//
// No series is identified by colour alone. Each carries a dash pattern (declared with its stroke in
// typing.css) and a marker shape, because the phosphor palette these lines are drawn in is nearly
// flat in luminance — see the note above .typing-chart-line--wpm for the measurements. The shape is
// a prop rather than a class because it is geometry rather than paint, and a stylesheet cannot turn
// a circle into a triangle.

import ChartReadout from '../charts/ChartReadout';
import { Mark, type MarkShape } from '../charts/ChartMarks';
import { useChartPointer } from '../charts/useChartPointer';
import { nearestIndex } from '../../utils/charts/hitTest';

export interface StatsPoint {
  t: number; // epoch ms
  value: number;
}

export interface StatsSeries {
  key: string;
  points: StatsPoint[]; // sorted ascending by t
  lineClass: string;
  // The marker drawn at each point, and the series' second channel after its dash. Omitted for a
  // series with markers off, where there is nothing to shape.
  shape?: MarkShape;
  axis?: 'left' | 'right'; // which y-axis the values are scaled against
  // Point markers, labels and tooltips. Off for annotation lines (a trend fit,
  // say), whose endpoints aren't measurements anyone would want to read off.
  markers?: boolean; // default true
  formatValue: (v: number) => string; // for the point tooltip
  formatLabel: (v: number) => string; // compact direct label above the point
  // What to call this series in the readout. A series with markers off never appears there, so it
  // needs none.
  name?: string;
}

interface StatsChartProps {
  series: StatsSeries[]; // only the visible series
  yDomain: [number, number];
  yDomainRight?: [number, number];
  formatRightTick?: (v: number) => string;
  formatDate: (t: number) => string;
  showLabels?: boolean; // direct value labels above each point (day mode)
  loading?: boolean; // render an empty grid skeleton while data is being fetched
  animate?: boolean; // play the one-shot line-draw animation on this render
  hintLabel: string; // what the readout says when nothing is being pointed at
}

const WIDTH = 600;
const HEIGHT = 240;
const MARGIN = { top: 10, right: 12, bottom: 22, left: 40 };
// Above this many points per series the markers become clutter; draw line only.
const MAX_MARKERS = 40;

export default function StatsChart({
  series,
  yDomain,
  yDomainRight,
  formatRightTick,
  formatDate,
  showLabels = false,
  loading = false,
  animate = false,
  hintLabel,
}: StatsChartProps) {
  const { svgRef, at, handlers } = useChartPointer();

  const hasRightAxis = yDomainRight != null && series.some((s) => s.axis === 'right');
  const marginRight = hasRightAxis ? 46 : MARGIN.right; // room for "1h 05m" ticks
  const plotW = WIDTH - MARGIN.left - marginRight;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const [yMin, yMax] = yDomain;
  const [yrMin, yrMax] = yDomainRight ?? [0, 1];

  const allT = series.flatMap((s) => s.points.map((p) => p.t));
  const tMin = allT.length ? Math.min(...allT) : 0;
  const tMax = allT.length ? Math.max(...allT) : 1;
  const tSpan = Math.max(tMax - tMin, 1);
  const singlePoint = new Set(allT).size === 1;

  const x = (t: number) =>
    singlePoint ? MARGIN.left + plotW / 2 : MARGIN.left + ((t - tMin) / tSpan) * plotW;
  const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const yRight = (v: number) => MARGIN.top + (1 - (v - yrMin) / (yrMax - yrMin)) * plotH;
  const yOf = (s: StatsSeries, v: number) => (s.axis === 'right' ? yRight(v) : y(v));

  // Both axes tick at the same fractions so right ticks land on the gridlines.
  const TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
  const gridValues = [0.25, 0.5, 0.75].map((f) => yMin + f * (yMax - yMin));
  const yTicks = TICK_FRACTIONS.map((f) => yMin + f * (yMax - yMin));

  // X ticks come from whichever series has the most points (they share dates).
  const tickSource = series.reduce<StatsPoint[]>(
    (best, s) => (s.points.length > best.length ? s.points : best),
    []
  );
  const xTickPoints = [...tickSource.slice(0, 1), ...tickSource.slice(-1)];
  if (tickSource.length >= 3) {
    const mid = tickSource[Math.floor(tickSource.length / 2)];
    const midX = x(mid.t);
    const clearance = 0.18 * plotW;
    if (midX - MARGIN.left > clearance && WIDTH - marginRight - midX > clearance) {
      xTickPoints.splice(1, 0, mid);
    }
  }

  // The series share their dates, so one x picks one day and every series reports what it had that
  // day — which is the comparison this chart exists for. A series with markers off is a fit rather
  // than a measurement and stays out of it, exactly as it stays out of the tooltips.
  const readable = series.filter((s) => s.markers !== false);
  const stamps = [...new Set(readable.flatMap((s) => s.points.map((p) => p.t)))].sort(
    (a, b) => a - b
  );
  const hit = at == null || loading ? null : nearestIndex(stamps.map(x), at.x);
  const hitT = hit == null ? null : stamps[hit];
  const hitValues =
    hitT == null
      ? []
      : readable.flatMap((s) => {
          const point = s.points.find((p) => p.t === hitT);
          return point ? [{ series: s, point }] : [];
        });
  const readout =
    hitT == null || hitValues.length === 0
      ? null
      : [
          formatDate(hitT),
          ...hitValues.map(
            ({ series: s, point }) =>
              `${s.name ? `${s.name} ` : ''}${s.formatValue(point.value)}`
          ),
        ].join(' · ');

  return (
    <div className={`typing-chart-panel${loading ? ' typing-chart-panel--loading' : ''}`}>
      <svg
        ref={svgRef}
        className="chart-interactive"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label="Typing stats"
        {...handlers}
      >
        {/* Under everything, so the whole panel is pointable and not just the markers. */}
        <rect className="chart-surface" x={0} y={0} width={WIDTH} height={HEIGHT} />
        {hitT != null && (
          <line
            className="chart-guide"
            x1={x(hitT)}
            x2={x(hitT)}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
          />
        )}
        {gridValues.map((v) => (
          <line
            key={v}
            className="typing-chart-grid"
            x1={MARGIN.left}
            x2={WIDTH - marginRight}
            y1={y(v)}
            y2={y(v)}
          />
        ))}
        <line
          className="typing-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - marginRight}
          y1={y(yMin)}
          y2={y(yMin)}
        />
        {yTicks.map((v) => (
          <text
            key={v}
            className="typing-chart-tick"
            x={MARGIN.left - 6}
            y={y(v) + 3}
            textAnchor="end"
          >
            {Math.round(v)}
          </text>
        ))}
        {!loading &&
          hasRightAxis &&
          TICK_FRACTIONS.map((f) => {
            const v = yrMin + f * (yrMax - yrMin);
            return (
              <text
                key={f}
                className="typing-chart-tick typing-chart-tick--right"
                x={WIDTH - marginRight + 6}
                y={yRight(v) + 3}
                textAnchor="start"
              >
                {formatRightTick ? formatRightTick(v) : Math.round(v)}
              </text>
            );
          })}
        {!loading &&
          xTickPoints.map((p, i) => (
            <text
              key={`${p.t}-${i}`}
              className="typing-chart-tick"
              x={x(p.t)}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? 'start' : i === xTickPoints.length - 1 ? 'end' : 'middle'}
            >
              {formatDate(p.t)}
            </text>
          ))}
        {!loading &&
          series.map((s) => (
          <g key={s.key} className={animate ? 'typing-chart-markers--in' : undefined}>
            {s.points.length > 1 && (
              <polyline
                className={`${s.lineClass}${animate ? ' typing-chart-line--draw' : ''}`}
                pathLength={1}
                points={s.points.map((p) => `${x(p.t)},${yOf(s, p.value)}`).join(' ')}
                fill="none"
                strokeWidth={2}
              />
            )}
            {s.markers !== false &&
              s.points.length <= MAX_MARKERS &&
              s.points.map((p, i) => (
                <g key={`${p.t}-${i}`}>
                  <Mark
                    shape={s.shape ?? 'disc'}
                    className={`typing-chart-point ${s.lineClass}`}
                    cx={x(p.t)}
                    cy={yOf(s, p.value)}
                    r={3}
                  />
                  {showLabels && (
                    <text
                      className="typing-chart-label"
                      x={x(p.t)}
                      y={yOf(s, p.value) - 8}
                      // Edge points anchor inward so labels stay inside the
                      // plot and clear of the right-axis tick gutter.
                      textAnchor={
                        x(p.t) - MARGIN.left < 16
                          ? 'start'
                          : WIDTH - marginRight - x(p.t) < 16
                            ? 'end'
                            : 'middle'
                      }
                    >
                      {s.formatLabel(p.value)}
                    </text>
                  )}
                  {/* Oversized invisible hit target carrying the native tooltip. */}
                  <circle cx={x(p.t)} cy={yOf(s, p.value)} r={10} fill="transparent">
                    <title>{`${formatDate(p.t)} — ${s.formatValue(p.value)}`}</title>
                  </circle>
                </g>
              ))}
          </g>
        ))}

        {hitValues.map(({ series: s, point }) => (
          <Mark
            key={`hit-${s.key}`}
            shape={s.shape ?? 'disc'}
            className={`typing-chart-point ${s.lineClass} chart-hit`}
            cx={x(point.t)}
            cy={yOf(s, point.value)}
            r={4}
          />
        ))}
      </svg>

      <ChartReadout text={readout} hint={hintLabel} />
    </div>
  );
}
