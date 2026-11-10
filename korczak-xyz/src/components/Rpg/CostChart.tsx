/*
 * What the paid requests cost, day by day — the admin panel's dashboard chart (`AdminCosts.tsx`).
 *
 * One series of bars, so nothing here is told apart by colour (`.claude/rules/charts.md`). When a
 * group is picked in the table below it, the bars are that group's and the whole day stays drawn as
 * an outline behind them: filled against hollow, which survives grayscale. Read by pointing: a day
 * owns its whole slot, and the readout says the day, the dollars, the litres, the złoty and the calls.
 */

import { bandIndex } from '../../utils/charts/hitTest';
import ChartReadout from '../charts/ChartReadout';
import { useChartPointer } from '../charts/useChartPointer';
import type { CostDay } from '../../utils/rpg/requestLog';

const WIDTH = 600;
const HEIGHT = 200;
const MARGIN = { top: 10, right: 8, bottom: 22, left: 52 };
const MAX_DAY_LABELS = 8;

export interface CostChartProps {
  /** Every day of the range: the whole of it. */
  total: CostDay[];
  /** The same days for the group picked below, or null for none. */
  part: CostDay[] | null;
  /** USD → PLN for the readout, or null when no rate is known. */
  rate: number | null;
  ariaLabel: string;
  hint: string;
  describe: (day: CostDay, whole: CostDay, rate: number | null) => string;
  lang: 'en' | 'pl';
}

function niceMax(v: number): number {
  if (!(v > 0)) return 0.01;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export default function CostChart({ total, part, rate, ariaLabel, hint, describe, lang }: CostChartProps) {
  const { svgRef, at, handlers } = useChartPointer();
  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const yMax = niceMax(Math.max(...total.map((d) => d.usd), 0));
  const y = (v: number) => MARGIN.top + (1 - v / yMax) * plotH;
  const slot = plotW / Math.max(1, total.length);
  const barW = Math.max(2, Math.min(30, slot * 0.7));
  const barX = (i: number) => MARGIN.left + i * slot + (slot - barW) / 2;
  const ticks = [0, yMax / 2, yMax];
  const labelEvery = Math.ceil(total.length / MAX_DAY_LABELS);
  const shown = part ?? total;
  const hit = at == null ? null : bandIndex(at.x, MARGIN.left, slot, total.length);
  const money = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(v >= 0.1 ? 2 : 3)}`);
  const dayLabel = (day: string) => {
    const [, m, d] = day.split('-');
    return lang === 'pl' ? `${Number(d)}.${m}` : `${m}/${d}`;
  };

  return (
    <div className="rpg-cost-chart">
      <svg ref={svgRef} className="chart-interactive" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" role="img" aria-label={ariaLabel} {...handlers}>
        <rect className="chart-surface" x={0} y={0} width={WIDTH} height={HEIGHT} />
        {ticks.map((v) => (
          <g key={v}>
            <line className="rpg-cost-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(v)} y2={y(v)} />
            <text className="rpg-cost-tick" x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end">
              {money(v)}
            </text>
          </g>
        ))}
        {total.map((day, i) => {
          const mine = shown[i];
          const title = describe(mine, day, rate);
          return (
            <g key={day.day}>
              {part && day.usd > 0 && (
                <rect className="rpg-cost-bar rpg-cost-bar--whole" x={barX(i)} y={y(day.usd)} width={barW} height={plotH + MARGIN.top - y(day.usd)}>
                  <title>{title}</title>
                </rect>
              )}
              {mine.usd > 0 && (
                <rect className={`rpg-cost-bar${hit === i ? ' rpg-cost-bar--hit' : ''}`} x={barX(i)} y={y(mine.usd)} width={barW} height={plotH + MARGIN.top - y(mine.usd)}>
                  <title>{title}</title>
                </rect>
              )}
              {i % labelEvery === 0 && (
                <text className="rpg-cost-tick" x={barX(i) + barW / 2} y={HEIGHT - 6} textAnchor="middle">
                  {dayLabel(day.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ChartReadout text={hit == null ? null : describe(shown[hit], total[hit], rate)} hint={hint} />
    </div>
  );
}
