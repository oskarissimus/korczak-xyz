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
 * Dots at the same temperature are stacked within their lane rather than drawn on top of one
 * another, and the stacking is by *position among the dots sharing that temperature* rather than by
 * a hash of the night key. A hash looked right and was not: consecutive dates hash to consecutive
 * numbers, so every dot came out at nearly the same height and two nights at 12° drew as one. This
 * separates them by construction, and is still deterministic — the same history draws the same
 * picture every time.
 */

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

export default function ClimateChart({
  nights,
  markAt,
  formatDay,
  formatTemp,
  t,
}: ClimateChartProps) {
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

  return (
    <div className="bs-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={t.climateChartAria}>
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

        {complete.map((night) => (
          <circle
            key={night.night}
            className={`bs-dot ${VERDICT_CLASS[night.verdict]}`}
            cx={x(night.tempC)}
            cy={laneMid(LANES.indexOf(night.window)) + (offsets.get(night.night) ?? 0)}
            r={5}
          >
            <title>
              {fill(t.climateDot, {
                date: formatDay(night.at),
                temp: formatTemp(night.tempC),
                window: laneLabel(night.window).toLowerCase(),
                verdict: verdictLabel(night.verdict).toLowerCase(),
              })}
            </title>
          </circle>
        ))}
      </svg>

      <ul className="bs-legend">
        <li>
          <span className="bs-swatch bs-swatch--cold" aria-hidden="true" />
          {t.verdictCold}
        </li>
        <li>
          <span className="bs-swatch bs-swatch--ok" aria-hidden="true" />
          {t.verdictOk}
        </li>
        <li>
          <span className="bs-swatch bs-swatch--warm" aria-hidden="true" />
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
