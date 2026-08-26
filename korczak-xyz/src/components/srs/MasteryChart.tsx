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
 *
 * Four stacked bands is the hardest shape on this site to keep readable without colour: there is no
 * marker to give a shape to and no line to dash, and the bands share edges that move rather than
 * sitting apart. Two things carry it. The bucket ramp in `srsCharts.css` is monotonic in luminance,
 * which is the right encoding anyway for a sequence a card walks one way along — so flattened to
 * gray the stack still reads bottom to top as a ladder. And the two middle bands, the pair with the
 * least room between them, take a texture on top of that.
 */

import ChartReadout from '../charts/ChartReadout';
import ChartTextures, { TEXTURE, texture, type TextureName } from '../charts/ChartTextures';
import { useChartPointer } from '../charts/useChartPointer';
import { nearestIndex } from '../../utils/charts/hitTest';
import type { Bucket } from '../../utils/srs/scheduler';
import type { MasterySnapshot } from '../../utils/srs/types';

interface MasteryChartProps {
  history: MasterySnapshot[];
  labels: Record<Bucket, string>;
  formatDate: (t: number) => string;
  emptyLabel: string;
  /** What the readout says when nothing is being pointed at. */
  hintLabel: string;
}

const WIDTH = 600;
const HEIGHT = 220;
const MARGIN = { top: 8, right: 10, bottom: 20, left: 32 };

// Bottom to top. Mastered is the baseline: it is the number the chart is about.
const BANDS: Bucket[] = ['mature', 'young', 'learning', 'new'];

/*
 * Only the middle two. `mature` sits on the axis and `new` against the panel, so each already has a
 * straight edge to be read against; the pair in the middle has neither, and is also the closest
 * pair on the ramp (88 and 132 in grayscale, 1.92 apart). Texturing all four would make the chart
 * an argument between four patterns rather than a stack of four quantities.
 */
const BAND_TEXTURE: Partial<Record<Bucket, TextureName>> = {
  young: TEXTURE.crosshatch,
  learning: TEXTURE.diagonal,
};

export default function MasteryChart({
  history,
  labels,
  formatDate,
  emptyLabel,
  hintLabel,
}: MasteryChartProps) {
  // Above the empty guard, because a hook cannot sit behind a return.
  const { svgRef, at, handlers } = useChartPointer();

  if (history.length === 0) {
    return <p className="srs-empty">{emptyLabel}</p>;
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

  /* This chart had no tooltip of any kind: the legend prints the *latest* day's four counts and
     nothing said what any earlier day held, on any device. The bands are the only thing here, and a
     band is not a mark you can point at, so the readout is the whole of the answer. */
  const hit = at == null ? null : nearestIndex(points.map((p) => x(p.at)), at.x);
  const readout =
    hit == null
      ? null
      : [
          formatDate(points[hit].at),
          ...[...BANDS]
            .reverse()
            .map((band) => `${labels[band]} ${points[hit].counts[band] ?? 0}`),
        ].join(' · ');

  return (
    <div className="srs-chart">
      <svg
        ref={svgRef}
        className="chart-interactive"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={labels.mature}
        {...handlers}
      >
        <ChartTextures />
        {/* Under everything, so the empty space above the stack is pointable too. */}
        <rect className="chart-surface" x={0} y={0} width={WIDTH} height={HEIGHT} />
        {gridValues.map((v) => (
          <line
            key={v}
            className="srs-chart-grid"
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
          const shape = [...top, ...bottom].join(' ');
          const tex = BAND_TEXTURE[band];
          return (
            <g key={band}>
              <polygon className={`srs-band srs-band--${band}`} points={shape} />
              {/* The same polygon again, carrying the texture — see `ChartTextures.tsx` for why the
                  texture is laid over the colour rather than replacing it. */}
              {tex && <polygon className="chart-tex" points={shape} fill={texture(tex)} />}
            </g>
          );
        })}

        <line
          className="srs-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={y(0)}
          y2={y(0)}
        />
        {[0, yMax].map((v) => (
          <text key={v} className="srs-chart-tick" x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end">
            {Math.round(v)}
          </text>
        ))}
        {hit != null && (
          <line
            className="chart-guide"
            x1={x(points[hit].at)}
            x2={x(points[hit].at)}
            y1={MARGIN.top}
            y2={y(0)}
          />
        )}

        <text className="srs-chart-tick" x={MARGIN.left} y={HEIGHT - 5} textAnchor="start">
          {formatDate(tMin)}
        </text>
        <text
          className="srs-chart-tick"
          x={WIDTH - MARGIN.right}
          y={HEIGHT - 5}
          textAnchor="end"
        >
          {formatDate(tMax)}
        </text>
      </svg>

      <ChartReadout text={readout} hint={hintLabel} />

      <ul className="srs-legend">
        {[...BANDS].reverse().map((band) => (
          <li key={band}>
            <span className={`srs-swatch srs-band--${band}`} aria-hidden="true" />
            {labels[band]}
            <span className="srs-legend-value">
              {points[points.length - 1].counts[band] ?? 0}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
