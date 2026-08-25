/*
 * Accuracy and answer speed, per day.
 *
 * Two axes, because the two numbers only mean something together: accuracy climbing while the
 * answers get slower is a deck you are working out rather than recalling, and one line alone
 * would call that progress. Speed is on the right and inverted in spirit — lower is better —
 * so the tick labels carry their unit rather than leaving the reader to guess.
 *
 * The two lines were cyan and yellow and nothing else, which is one line drawn twice to anyone not
 * reading them in colour — 1.17 grayscale contrast. So accuracy is solid with discs and speed is
 * dashed with squares, and the legend under them draws the real line and the real marker rather
 * than a colour chip. The colours in `srsCharts.css` moved too; the shapes are what make it
 * readable at a glance.
 */

import { Mark, SeriesSwatch } from '../charts/ChartMarks';
import type { DayStats } from '../../utils/srs/history';

interface TrendChartProps {
  days: DayStats[];
  formatDate: (t: number) => string;
  labels: { accuracy: string; seconds: string };
  emptyLabel: string;
}

const WIDTH = 600;
const HEIGHT = 220;
const MARGIN = { top: 10, right: 40, bottom: 20, left: 32 };
const MAX_MARKERS = 40;

export default function TrendChart({ days, formatDate, labels, emptyLabel }: TrendChartProps) {
  if (days.length === 0) {
    return <p className="srs-empty">{emptyLabel}</p>;
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const tMin = days[0].at;
  const tMax = days[days.length - 1].at;
  const tSpan = Math.max(tMax - tMin, 1);
  const single = days.length === 1;
  const secondsMax = Math.max(1, ...days.map((d) => d.avgMs / 1000));

  const x = (t: number) => (single ? MARGIN.left + plotW / 2 : MARGIN.left + ((t - tMin) / tSpan) * plotW);
  const yPct = (v: number) => MARGIN.top + (1 - v / 100) * plotH;
  const ySec = (v: number) => MARGIN.top + (1 - v / secondsMax) * plotH;

  const accuracy = days.map((d) => ({ x: x(d.at), y: yPct(d.accuracy * 100), d }));
  const speed = days.map((d) => ({ x: x(d.at), y: ySec(d.avgMs / 1000), d }));
  const showMarkers = days.length <= MAX_MARKERS;

  return (
    <div className="srs-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={labels.accuracy}>
        {[25, 50, 75, 100].map((v) => (
          <line
            key={v}
            className="srs-chart-grid"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={yPct(v)}
            y2={yPct(v)}
          />
        ))}
        <line
          className="srs-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={yPct(0)}
          y2={yPct(0)}
        />

        {[0, 50, 100].map((v) => (
          <text key={v} className="srs-chart-tick" x={MARGIN.left - 6} y={yPct(v) + 4} textAnchor="end">
            {v}
          </text>
        ))}
        {[0, secondsMax].map((v) => (
          <text
            key={v}
            className="srs-chart-tick srs-chart-tick--right"
            x={WIDTH - MARGIN.right + 6}
            y={ySec(v) + 4}
            textAnchor="start"
          >
            {v === 0 ? '0' : `${v.toFixed(1)}s`}
          </text>
        ))}

        {!single && (
          <>
            <polyline
              className="srs-line srs-line--speed"
              strokeWidth={2}
              points={speed.map((p) => `${p.x},${p.y}`).join(' ')}
            />
            <polyline
              className="srs-line srs-line--accuracy"
              strokeWidth={2}
              points={accuracy.map((p) => `${p.x},${p.y}`).join(' ')}
            />
          </>
        )}

        {showMarkers &&
          speed.map((p) => (
            <Mark key={`s${p.d.day}`} shape="square" className="srs-point--speed" cx={p.x} cy={p.y} r={3}>
              <title>{`${formatDate(p.d.at)} — ${(p.d.avgMs / 1000).toFixed(1)}s`}</title>
            </Mark>
          ))}
        {showMarkers &&
          accuracy.map((p) => (
            <Mark key={`a${p.d.day}`} shape="disc" className="srs-point--accuracy" cx={p.x} cy={p.y} r={3}>
              <title>{`${formatDate(p.d.at)} — ${Math.round(p.d.accuracy * 100)}% (${p.d.answers})`}</title>
            </Mark>
          ))}

        <text className="srs-chart-tick" x={MARGIN.left} y={HEIGHT - 5} textAnchor="start">
          {formatDate(tMin)}
        </text>
        {!single && (
          <text className="srs-chart-tick" x={WIDTH - MARGIN.right} y={HEIGHT - 5} textAnchor="end">
            {formatDate(tMax)}
          </text>
        )}
      </svg>

      <ul className="srs-legend">
        <li>
          <SeriesSwatch
            className="srs-point--accuracy"
            lineClassName="srs-line srs-line--accuracy"
            shape="disc"
          />
          {labels.accuracy}
        </li>
        <li>
          <SeriesSwatch
            className="srs-point--speed"
            lineClassName="srs-line srs-line--speed"
            shape="square"
          />
          {labels.seconds}
        </li>
      </ul>
    </div>
  );
}
