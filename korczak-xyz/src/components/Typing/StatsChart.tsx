// Minimal single-series SVG line chart for the typing stats page.

export interface StatsPoint {
  t: number; // epoch ms
  value: number;
}

interface StatsChartProps {
  title: string;
  points: StatsPoint[]; // sorted ascending by t
  yDomain: [number, number];
  formatValue: (v: number) => string;
  formatDate: (t: number) => string;
  lineClass: string;
}

const WIDTH = 600;
const HEIGHT = 200;
const MARGIN = { top: 10, right: 12, bottom: 22, left: 44 };
// Above this many sessions the per-point markers become clutter; draw line only.
const MAX_MARKERS = 40;

export default function StatsChart({
  title,
  points,
  yDomain,
  formatValue,
  formatDate,
  lineClass,
}: StatsChartProps) {
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const [yMin, yMax] = yDomain;

  const tMin = points[0]?.t ?? 0;
  const tMax = points[points.length - 1]?.t ?? 1;
  const tSpan = Math.max(tMax - tMin, 1);

  const x = (t: number) =>
    points.length === 1 ? MARGIN.left + plotW / 2 : MARGIN.left + ((t - tMin) / tSpan) * plotW;
  const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Horizontal gridlines at the domain quartiles, plus min/max tick labels.
  const gridValues = [0.25, 0.5, 0.75].map((f) => yMin + f * (yMax - yMin));
  const yTicks = [yMin, ...gridValues, yMax];

  const xTickPoints = [...points.slice(0, 1), ...points.slice(-1)];
  if (points.length >= 3) {
    // Include a middle date only when it lands far enough from both edge
    // labels to avoid overlapping them.
    const mid = points[Math.floor(points.length / 2)];
    const midX = x(mid.t);
    const clearance = 0.18 * plotW;
    if (midX - MARGIN.left > clearance && WIDTH - MARGIN.right - midX > clearance) {
      xTickPoints.splice(1, 0, mid);
    }
  }

  const polyline = points.map((p) => `${x(p.t)},${y(p.value)}`).join(' ');

  return (
    <div className="typing-chart-panel">
      <h2 className="typing-chart-title">{title}</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={title}>
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
            {formatValue(v)}
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
        {points.length > 1 && (
          <polyline className={lineClass} points={polyline} fill="none" strokeWidth={2} />
        )}
        {points.length <= MAX_MARKERS &&
          points.map((p, i) => (
            <g key={`${p.t}-${i}`}>
              <circle className={lineClass} cx={x(p.t)} cy={y(p.value)} r={3} />
              {/* Oversized invisible hit target carrying the native tooltip. */}
              <circle cx={x(p.t)} cy={y(p.value)} r={10} fill="transparent">
                <title>{`${formatDate(p.t)} — ${formatValue(p.value)}`}</title>
              </circle>
            </g>
          ))}
      </svg>
    </div>
  );
}
