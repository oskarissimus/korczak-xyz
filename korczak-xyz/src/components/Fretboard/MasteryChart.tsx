/*
 * Cards mastered over time, as a stacked area.
 *
 * Stacked rather than a single line, because "mastered" only means something against the size
 * of the deck: 20 mature cards is most of the first five frets and a fraction of the whole
 * neck. The bands stack from mastered upward, so the thing you are trying to grow is the one
 * sitting on the axis with a straight edge to read.
 *
 * Drawn from the daily snapshots rather than replayed from the log: this is where the deck
 * stood at the end of each day, and a change to the scheduler should not rewrite last month.
 */

import type { Bucket } from '../../utils/fretboard/srs';
import type { MasterySnapshot } from '../../utils/fretboard/types';

interface MasteryChartProps {
  history: MasterySnapshot[];
  labels: Record<Bucket, string>;
  formatDate: (t: number) => string;
  emptyLabel: string;
}

const WIDTH = 600;
const HEIGHT = 220;
const MARGIN = { top: 8, right: 10, bottom: 20, left: 32 };

// Bottom to top. Mastered is the baseline: it is the number the chart is about.
const BANDS: Bucket[] = ['mature', 'young', 'learning', 'new'];

export default function MasteryChart({
  history,
  labels,
  formatDate,
  emptyLabel,
}: MasteryChartProps) {
  if (history.length === 0) {
    return <p className="fb-empty">{emptyLabel}</p>;
  }

  // One day of history has no width. Repeating it gives the bands something to span, which
  // reads as "this is where it stands" rather than as an empty panel.
  const points = history.length === 1 ? [history[0], { ...history[0], at: history[0].at + 86_400_000 }] : history;

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const tMin = points[0].at;
  const tMax = points[points.length - 1].at;
  const tSpan = Math.max(tMax - tMin, 1);
  const totals = points.map((p) => BANDS.reduce((sum, b) => sum + (p.counts[b] ?? 0), 0));
  const yMax = Math.max(1, ...totals);

  const x = (t: number) => MARGIN.left + ((t - tMin) / tSpan) * plotW;
  const y = (v: number) => MARGIN.top + (1 - v / yMax) * plotH;

  // Cumulative upper edge of each band, so band i is drawn between edge i-1 and edge i.
  const edges = points.map((point) => {
    let running = 0;
    return BANDS.map((band) => {
      running += point.counts[band] ?? 0;
      return running;
    });
  });

  const gridValues = [0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  return (
    <div className="fb-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={labels.mature}>
        {gridValues.map((v) => (
          <line
            key={v}
            className="fb-chart-grid"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(v)}
            y2={y(v)}
          />
        ))}

        {BANDS.map((band, i) => {
          const top = points.map((p, j) => `${x(p.at)},${y(edges[j][i])}`);
          const bottom = points
            .map((p, j) => `${x(p.at)},${y(i === 0 ? 0 : edges[j][i - 1])}`)
            .reverse();
          return (
            <polygon key={band} className={`fb-band fb-band--${band}`} points={[...top, ...bottom].join(' ')} />
          );
        })}

        <line
          className="fb-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={y(0)}
          y2={y(0)}
        />
        {[0, yMax].map((v) => (
          <text key={v} className="fb-chart-tick" x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end">
            {Math.round(v)}
          </text>
        ))}
        <text className="fb-chart-tick" x={MARGIN.left} y={HEIGHT - 5} textAnchor="start">
          {formatDate(tMin)}
        </text>
        <text
          className="fb-chart-tick"
          x={WIDTH - MARGIN.right}
          y={HEIGHT - 5}
          textAnchor="end"
        >
          {formatDate(tMax)}
        </text>
      </svg>

      <ul className="fb-legend">
        {[...BANDS].reverse().map((band) => (
          <li key={band}>
            <span className={`fb-swatch fb-band--${band}`} aria-hidden="true" />
            {labels[band]}
            <span className="fb-legend-value">
              {points[points.length - 1].counts[band] ?? 0}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
