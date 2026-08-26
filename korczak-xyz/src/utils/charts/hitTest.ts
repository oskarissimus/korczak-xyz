/*
 * Pointer position in, datum out — the whole of what a chart's hover has to decide.
 *
 * It lives here, as pure functions over numbers, for `comboKeys.ts`'s reason: there is no jsdom in
 * this project, so a `pointermove` handler is not a state a test can reach. Anything that has to be
 * verified cannot live in one. What is left in the components is reading the pointer and drawing the
 * highlight, neither of which has an off-by-one to get wrong.
 *
 * Everything here works in **viewBox units**, which is what `useChartPointer` hands over. None of it
 * knows what is plotted, in the same way `SpreadChart` does not: a chart passes its own coordinates
 * in and gets back an index into its own data.
 */

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * The index of the nearest value in `xs`, or null when `xs` is empty or nothing is within
 * `maxDistance`.
 *
 * Ties go to the earlier index — arbitrary, but fixed, so a pointer sitting exactly between two
 * days does not flicker between them as the mouse jitters by a subpixel.
 */
export function nearestIndex(xs: number[], x: number, maxDistance = Infinity): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const gap = Math.abs(xs[i] - x);
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best != null && bestGap <= maxDistance ? best : null;
}

/**
 * The index of the nearest point in two dimensions, or null when nothing is within `maxDistance`.
 *
 * For a chart whose x does not identify a datum on its own — the climate chart stacks several
 * nights at one temperature and splits them across two lanes, so x alone names a column of dots
 * rather than one of them.
 */
export function nearestPoint(
  points: ChartPoint[],
  at: ChartPoint,
  maxDistance = Infinity
): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i].x - at.x;
    const dy = points[i].y - at.y;
    const gap = Math.sqrt(dx * dx + dy * dy);
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best != null && bestGap <= maxDistance ? best : null;
}

/**
 * The band `x` falls in, for a chart whose items own a slot rather than a coordinate — the daily
 * bars, where the gap between two bars still belongs to one of the days.
 *
 * Null outside the plot area, so the y-axis labels and the right margin are not a day.
 */
export function bandIndex(x: number, left: number, slot: number, count: number): number | null {
  if (count <= 0 || slot <= 0) return null;
  if (x < left || x >= left + slot * count) return null;
  return Math.min(count - 1, Math.floor((x - left) / slot));
}

/**
 * The row `y` falls in, for a chart of stacked bands — the timeline's one row per day.
 *
 * The gap between rows is **nobody's**: a row is 16px with a 3px gap, and claiming the gap for the
 * row above would put the readout a day out for a fifth of the chart's height.
 */
export function rowIndex(
  y: number,
  top: number,
  rowH: number,
  gap: number,
  rows: number
): number | null {
  if (rows <= 0 || rowH <= 0) return null;
  const pitch = rowH + gap;
  const offset = y - top;
  if (offset < 0 || offset >= pitch * rows) return null;
  const row = Math.floor(offset / pitch);
  return offset - row * pitch < rowH ? row : null;
}

/**
 * The item in `spans` covering `x`, latest-drawn first, or null where none does.
 *
 * The order matters and is the caller's: the timeline draws routines under sleeps, so where a
 * mis-logged routine overlaps the sleep it led into, the sleep is what is on the screen and must be
 * what the readout names.
 */
export function spanAt(
  spans: { from: number; to: number }[],
  x: number
): number | null {
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    if (x >= spans[i].from && x <= spans[i].to) return i;
  }
  return null;
}
