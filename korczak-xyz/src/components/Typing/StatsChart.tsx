// Minimal multi-series SVG line chart for the typing stats page. WPM and
// accuracy share a single 0-100 y-axis (both happen to live in that range),
// so this is never a misleading dual-axis chart.

export interface StatsPoint {
  t: number; // epoch ms
  value: number;
}

export interface StatsSeries {
  key: string;
  points: StatsPoint[]; // sorted ascending by t
  lineClass: string;
  formatValue: (v: number) => string; // for the point tooltip
}

interface StatsChartProps {
  series: StatsSeries[]; // only the visible series
  yDomain: [number, number];
  formatDate: (t: number) => string;
}

const WIDTH = 600;
const HEIGHT = 240;
const MARGIN = { top: 10, right: 12, bottom: 22, left: 40 };
// Above this many points per series the markers become clutter; draw line only.
const MAX_MARKERS = 40;

export default function StatsChart({ series, yDomain, formatDate }: StatsChartProps) {
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const [yMin, yMax] = yDomain;

  const allT = series.flatMap((s) => s.points.map((p) => p.t));
  const tMin = allT.length ? Math.min(...allT) : 0;
  const tMax = allT.length ? Math.max(...allT) : 1;
  const tSpan = Math.max(tMax - tMin, 1);
  const singlePoint = new Set(allT).size === 1;

  const x = (t: number) =>
    singlePoint ? MARGIN.left + plotW / 2 : MARGIN.left + ((t - tMin) / tSpan) * plotW;
  const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const gridValues = [0.25, 0.5, 0.75].map((f) => yMin + f * (yMax - yMin));
  const yTicks = [yMin, ...gridValues, yMax];

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
    if (midX - MARGIN.left > clearance && WIDTH - MARGIN.right - midX > clearance) {
      xTickPoints.splice(1, 0, mid);
    }
  }

  return (
    <div className="typing-chart-panel">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label="Typing stats">
        {gridValues.map((v) => (
          <line
            key={v}
            className="typing-chart-grid"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(v)}
            y2={y(v)}
          />
        ))}
        <line
          className="typing-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
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
        {xTickPoints.map((p, i) => (
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
        {series.map((s) => (
          <g key={s.key}>
            {s.points.length > 1 && (
              <polyline
                className={s.lineClass}
                points={s.points.map((p) => `${x(p.t)},${y(p.value)}`).join(' ')}
                fill="none"
                strokeWidth={2}
              />
            )}
            {s.points.length <= MAX_MARKERS &&
              s.points.map((p, i) => (
                <g key={`${p.t}-${i}`}>
                  <circle className={s.lineClass} cx={x(p.t)} cy={y(p.value)} r={3} />
                  {/* Oversized invisible hit target carrying the native tooltip. */}
                  <circle cx={x(p.t)} cy={y(p.value)} r={10} fill="transparent">
                    <title>{`${formatDate(p.t)} — ${s.formatValue(p.value)}`}</title>
                  </circle>
                </g>
              ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
