/*
 * Every complete night as a dot, at its forecast low, in the lane for whether the window was open.
 *
 * The other charts here plot a value per *day* against time, and `SpreadChart` draws all of them.
 * This one is not that shape and deliberately does not reuse it: the question is not how tonight
 * compares with last night, it is where along the temperature axis the answers change from
 * "alright" to "too cold". So temperature runs along X, the two window states are two lanes, and
 * the verdict is the dot's colour. Read left to right, the boundary between the colours in the top
 * lane *is* the answer.
 *
 * The verdict is a **shape** as well as a colour, and on this chart that matters more than
 * anywhere else on the site. The claim above — that the boundary between the verdicts in the top
 * lane *is* the answer — was true only in colour: `ok` and `warm` were grayscale 182 and 180, a
 * contrast of 1.02, so on an e-ink screen or a print the lane was one undifferentiated row of dots.
 * They were also the classic green-against-orange pair, ΔE 5.8 under simulated deuteranopia, which
 * is below the floor at which two marks can be told apart at all. So cold is a square, ok a disc
 * and warm a triangle; the re-stepped colours in `babySleep.css` are the second half of the fix.
 *
 * Dots at the same temperature are stacked within their lane rather than drawn on top of one
 * another, and the stacking is by *position among the dots sharing that temperature* rather than by
 * a hash of the night key. A hash looked right and was not: consecutive dates hash to consecutive
 * numbers, so every dot came out at nearly the same height and two nights at 12° drew as one. This
 * separates them by construction, and is still deterministic — the same history draws the same
 * picture every time.
 */

import ChartReadout from '../charts/ChartReadout';
import { Mark, SeriesSwatch, type MarkShape } from '../charts/ChartMarks';
import { useChartPointer } from '../charts/useChartPointer';
import { nearestPoint } from '../../utils/charts/hitTest';
import type { NightObservation } from '../../utils/babySleep/climateStats';
import { isComplete } from '../../utils/babySleep/climateStats';
import type { NightVerdict, WindowState } from '../../utils/babySleep/climate';
import type { Translation } from './translations';
import { fill } from './translations';

const WIDTH = 600;
const HEIGHT = 200;
const MARGIN = { top: 16, right: 16, bottom: 30, left: 96 };
/** Above this the labels start to collide, so the next step up is taken. */
const MAX_TICKS = 8;
const TICK_STEPS = [1, 2, 5, 10];
/** Never zoom in tighter than this many degrees, or one mild fortnight looks like a mountain range. */
const MIN_SPAN = 6;

const LANES: WindowState[] = ['open', 'closed'];

interface ClimateChartProps {
  nights: NightObservation[];
  /** The open lane's floor, marked with a rule. Null when it is not settled enough to draw. */
  markAt: number | null;
  formatDay: (t: number) => string;
  formatTemp: (v: number) => string;
  t: Translation;
}

function stepFor(span: number, steps: number[]): number {
  return steps.find((s) => span / s <= MAX_TICKS) ?? steps[steps.length - 1];
}

/** How far apart two dots at the same temperature sit, before the lane runs out of room. */
const STACK_GAP = 13;
/** How far the pointer may be from a dot and still mean it, in viewBox units. */
const HIT_REACH = 26;

/**
 * Vertical offset from the lane's line for each night, in the order given.
 *
 * Nights sharing a lane and a temperature are stacked symmetrically about the line, tightening the
 * gap rather than overflowing when a lot of them pile up on one reading.
 */
function stackOffsets(
  nights: { night: string; tempC: number; window: WindowState }[],
  room: number
): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const night of nights) {
    const key = `${night.window}|${night.tempC}`;
    const group = groups.get(key) ?? [];
    group.push(night.night);
    groups.set(key, group);
  }

  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    const gap = group.length > 1 ? Math.min(STACK_GAP, (room * 2) / (group.length - 1)) : 0;
    group.forEach((night, index) => {
      offsets.set(night, (index - (group.length - 1) / 2) * gap);
    });
  }
  return offsets;
}

const VERDICT_CLASS: Record<NightVerdict, string> = {
  cold: 'bs-dot--cold',
  ok: 'bs-dot--ok',
  warm: 'bs-dot--warm',
};

/*
 * Square, disc, triangle — the three that stay apart at five pixels. A diamond was the obvious
 * fourth and is not used here: against a disc of the same area it is a disc with corners, and this
 * chart is read by scanning a lane for where the marks change.
 */
const VERDICT_SHAPE: Record<NightVerdict, MarkShape> = {
  cold: 'square',
  ok: 'disc',
  warm: 'triangle',
};

export default function ClimateChart({
  nights,
  markAt,
  formatDay,
  formatTemp,
  t,
}: ClimateChartProps) {
  // Above the empty guard, because a hook cannot sit behind a return.
  const { svgRef, at, handlers } = useChartPointer();

  const complete = nights.filter(isComplete);

  if (complete.length === 0) {
    return (
      <div className="bs-chart bs-chart--empty">
        <p>{t.climateChartEmpty}</p>
      </div>
    );
  }

  const temps = complete.map((n) => n.tempC);
  const rawLo = Math.min(...temps);
  const rawHi = Math.max(...temps);
  const pad = Math.max(MIN_SPAN / 9, (rawHi - rawLo) * 0.12);
  let lo = rawLo - pad;
  let hi = rawHi + pad;
  if (hi - lo < MIN_SPAN) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_SPAN / 2;
    hi = mid + MIN_SPAN / 2;
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const laneH = plotH / LANES.length;

  const x = (temp: number) => MARGIN.left + ((temp - lo) / (hi - lo)) * plotW;
  const laneMid = (index: number) => MARGIN.top + laneH * (index + 0.5);

  const step = stepFor(hi - lo, TICK_STEPS);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  const offsets = stackOffsets(complete, laneH / 2 - 8);

  const laneLabel = (window: WindowState) =>
    window === 'open' ? t.climateLaneOpen : t.climateLaneClosed;
  const verdictLabel = (verdict: NightVerdict) =>
    verdict === 'cold' ? t.verdictCold : verdict === 'ok' ? t.verdictOk : t.verdictWarm;

  /* Where each dot ended up, jitter included, computed once: it is what the marks are drawn at and
     what the pointer is measured against, and two copies of that sum would eventually disagree. */
  const dots = complete.map((night) => ({
    x: x(night.tempC),
    y: laneMid(LANES.indexOf(night.window)) + (offsets.get(night.night) ?? 0),
  }));

  /* The narrowed shape `isComplete` produces: a chart of nights that have all three facts. */
  type CompleteNight = (typeof complete)[number];

  const describe = (night: CompleteNight) =>
    fill(t.climateDot, {
      date: formatDay(night.at),
      temp: formatTemp(night.tempC),
      window: laneLabel(night.window).toLowerCase(),
      verdict: verdictLabel(night.verdict).toLowerCase(),
    });

  /* Two dimensions, unlike every other chart here: a temperature names a *column* of dots — two
     lanes, and several nights stacked within one — so x alone cannot say which night was meant.
     The reach is generous because the dots are 5px and a thumb is not. */
  const hit = at == null ? null : nearestPoint(dots, at, HIT_REACH);

  return (
    <div className="bs-chart">
      <svg
        ref={svgRef}
        className="chart-interactive"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={t.climateChartAria}
        {...handlers}
      >
        {/* Under everything, so the empty parts of a lane are pointable too. */}
        <rect className="chart-surface" x={0} y={0} width={WIDTH} height={HEIGHT} />
        {ticks.map((v) => (
          <g key={v}>
            <line
              className="bs-chart-grid"
              x1={x(v)}
              x2={x(v)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
            />
            <text className="bs-chart-tick" x={x(v)} y={HEIGHT - 10} textAnchor="middle">
              {`${formatTemp(v)}°`}
            </text>
          </g>
        ))}

        {LANES.map((window, index) => (
          <g key={window}>
            <line
              className="bs-chart-axis"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={laneMid(index)}
              y2={laneMid(index)}
            />
            <text
              className="bs-lane-label"
              x={MARGIN.left - 8}
              y={laneMid(index) + 4}
              textAnchor="end"
            >
              {laneLabel(window)}
            </text>
          </g>
        ))}

        {/*
          The rule sits in the open lane only: it is that lane's coldest alright night, and drawing
          it across the closed lane would claim something about nights it was never measured on.
        */}
        {markAt != null && (
          <g>
            <line
              className="bs-threshold"
              x1={x(markAt)}
              x2={x(markAt)}
              y1={MARGIN.top}
              y2={MARGIN.top + laneH}
            />
            <text className="bs-chart-tick" x={x(markAt)} y={MARGIN.top - 4} textAnchor="middle">
              {`${formatTemp(markAt)}°`}
            </text>
          </g>
        )}

        {complete.map((night, i) => (
          <Mark
            key={night.night}
            shape={VERDICT_SHAPE[night.verdict]}
            className={`bs-dot ${VERDICT_CLASS[night.verdict]}`}
            cx={dots[i].x}
            cy={dots[i].y}
            r={5}
          >
            <title>{describe(night)}</title>
          </Mark>
        ))}

        {hit != null && (
          <Mark
            shape={VERDICT_SHAPE[complete[hit].verdict]}
            className={`bs-dot ${VERDICT_CLASS[complete[hit].verdict]} chart-hit`}
            cx={dots[hit].x}
            cy={dots[hit].y}
            r={6}
          />
        )}
      </svg>

      <ChartReadout text={hit == null ? null : describe(complete[hit])} hint={t.chartHint} />

      <ul className="bs-legend">
        {/* Points, not lines, so the swatch draws the mark alone — the same one the lane carries. */}
        <li>
          <SeriesSwatch className="bs-dot--cold" shape={VERDICT_SHAPE.cold} line={false} />
          {t.verdictCold}
        </li>
        <li>
          <SeriesSwatch className="bs-dot--ok" shape={VERDICT_SHAPE.ok} line={false} />
          {t.verdictOk}
        </li>
        <li>
          <SeriesSwatch className="bs-dot--warm" shape={VERDICT_SHAPE.warm} line={false} />
          {t.verdictWarm}
        </li>
        {markAt != null && (
          <li>
            <span className="bs-swatch bs-swatch--threshold" aria-hidden="true" />
            {t.climateThresholdMark}
            <span className="bs-legend-value">{`${formatTemp(markAt)}°`}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
