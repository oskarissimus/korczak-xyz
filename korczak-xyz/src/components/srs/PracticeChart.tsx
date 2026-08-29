/*
 * How long practice took, per day or per week.
 *
 * Bars rather than a line, because this is a quantity per bucket and not a rate sampled at a point:
 * a line between Tuesday and Friday draws a slope over two days nobody practised, and the slope
 * means nothing. `practiceBuckets` supplies the empty buckets for the same reason — the gaps are
 * half of what this chart says, and a series that skips them turns a fortnight off into an unbroken
 * run of bars.
 *
 * **One series, so there is no second channel to carry.** The rule the rest of this site's charts
 * follow — never tell two series apart by hue alone — is about telling series apart, and there is
 * only one here; the bars are read against the axis, which survives the colour being taken away.
 * Magenta because that is what time already is on the typing trainer's over-time chart, and these
 * two charts answer the same question about two apps.
 *
 * It owns its own day/week toggle. That is presentation state and not data, and both progress pages
 * draw this panel identically — the alternative is the same six lines of toggle in each of them,
 * which is the sort of pair that drifts.
 */

import { useMemo, useState } from 'react';
import ChartReadout from '../charts/ChartReadout';
import { useChartPointer } from '../charts/useChartPointer';
import { bandIndex } from '../../utils/charts/hitTest';
import { formatDuration } from '../../utils/srs/history';
import { practiceBuckets, totalPracticeMs, type PracticeGrouping } from '../../utils/srs/practice';
import type { SessionRecord } from '../../utils/srs/types';

interface PracticeChartProps {
  sessions: SessionRecord[];
  formatDate: (t: number) => string;
  labels: {
    perDay: string;
    perWeek: string;
    groupBy: string;
    /** What one bar's value is — used in the readout and as the chart's accessible name. */
    practiceTime: string;
    /** Heads the sitting count in the readout: `Sessions: 2`. */
    sessions: string;
    total: string;
  };
  emptyLabel: string;
  /** What the readout says when nothing is being pointed at. */
  hintLabel: string;
}

const WIDTH = 600;
const HEIGHT = 220;
const MARGIN = { top: 10, right: 10, bottom: 20, left: 44 };

/** Minutes. Quarter-ticks of each are clean values; past the ladder, fall back to whole hours. */
const NICE_MAXES = [1, 2, 4, 8, 12, 16, 20, 32, 40, 60, 80, 120, 160, 240, 360, 480];

function niceMaxMinutes(maxMinutes: number): number {
  const target = Math.max(maxMinutes * 1.1, 1);
  return NICE_MAXES.find((m) => m >= target) ?? Math.ceil(target / 60) * 60;
}

export default function PracticeChart({
  sessions,
  formatDate,
  labels,
  emptyLabel,
  hintLabel,
}: PracticeChartProps) {
  // Both above the empty guard: neither a hook nor a state may sit behind a return.
  const [grouping, setGrouping] = useState<PracticeGrouping>('day');
  const { svgRef, at, handlers } = useChartPointer();
  const buckets = useMemo(() => practiceBuckets(sessions, grouping), [grouping, sessions]);

  const toggles = (
    <div className="srs-toggle-group" role="group" aria-label={labels.groupBy}>
      {(['day', 'week'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="srs-toggle"
          aria-pressed={grouping === option}
          onClick={() => setGrouping(option)}
        >
          {option === 'day' ? labels.perDay : labels.perWeek}
        </button>
      ))}
    </div>
  );

  // No panel and no toggle with nothing to plot — the same empty state the other two charts draw,
  // and a day/week switch over an empty box is a control with nothing behind it.
  if (buckets.length === 0) {
    return <p className="srs-empty">{emptyLabel}</p>;
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = plotW / buckets.length;
  // A bar keeps its gap until the slot is too narrow to spare one; past that it is a hairline and
  // the chart reads as a barcode of habit, which is still the right picture.
  const barW = Math.max(1, slot - Math.min(3, slot * 0.25));

  const maxMinutes = niceMaxMinutes(Math.max(...buckets.map((b) => b.ms), 0) / 60000);
  const maxMs = maxMinutes * 60000;
  const y = (ms: number) => MARGIN.top + (1 - ms / maxMs) * plotH;
  const xOf = (i: number) => MARGIN.left + i * slot;

  const hit = at == null ? null : bandIndex(at.x, MARGIN.left, slot, buckets.length);
  const hitBucket = hit == null ? null : buckets[hit];
  const describe = (bucket: (typeof buckets)[number]) =>
    `${formatDate(bucket.at)} — ${formatDuration(bucket.ms)}` +
    (bucket.sessions > 0 ? ` · ${labels.sessions}: ${bucket.sessions}` : '');

  const total = totalPracticeMs(sessions);

  return (
    <div className="srs-chart">
      {toggles}
      <svg
        ref={svgRef}
        className="chart-interactive"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={labels.practiceTime}
        {...handlers}
      >
        {/* Under everything, so an empty bucket and the space above a short bar are pointable. */}
        <rect className="chart-surface" x={0} y={0} width={WIDTH} height={HEIGHT} />
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            className="srs-chart-grid"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(maxMs * f)}
            y2={y(maxMs * f)}
          />
        ))}

        {hit != null && (
          <rect
            className="srs-bar-hit"
            x={xOf(hit)}
            y={MARGIN.top}
            width={slot}
            height={plotH}
          />
        )}

        {buckets.map((bucket, i) => {
          /* A bucket with practice in it is never invisible: a two-minute sitting against a
             two-hour axis is a fifth of a pixel, and rounding it away draws it as a day off. */
          const height = bucket.ms > 0 ? Math.max(1, y(0) - y(bucket.ms)) : 0;
          return (
            <rect
              key={bucket.at}
              className="srs-bar"
              x={xOf(i) + (slot - barW) / 2}
              y={y(0) - height}
              width={barW}
              height={height}
            >
              <title>{describe(bucket)}</title>
            </rect>
          );
        })}

        <line
          className="srs-chart-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={y(0)}
          y2={y(0)}
        />
        {[0, maxMs / 2, maxMs].map((v) => (
          <text
            key={v}
            className="srs-chart-tick"
            x={MARGIN.left - 6}
            y={y(v) + 4}
            textAnchor="end"
          >
            {v === 0 ? '0' : formatDuration(v)}
          </text>
        ))}

        <text className="srs-chart-tick" x={MARGIN.left} y={HEIGHT - 5} textAnchor="start">
          {formatDate(buckets[0].at)}
        </text>
        {buckets.length > 1 && (
          <text
            className="srs-chart-tick"
            x={WIDTH - MARGIN.right}
            y={HEIGHT - 5}
            textAnchor="end"
          >
            {formatDate(buckets[buckets.length - 1].at)}
          </text>
        )}
      </svg>

      <ChartReadout text={hitBucket == null ? null : describe(hitBucket)} hint={hintLabel} />

      <ul className="srs-legend">
        <li>
          <span className="srs-swatch srs-bar" aria-hidden="true" />
          {labels.practiceTime}
        </li>
        <li>
          {labels.total}
          <span className="srs-legend-value">{formatDuration(total)}</span>
        </li>
      </ul>
    </div>
  );
}
