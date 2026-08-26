/*
 * How many of a series' direct value labels a chart has room to print.
 *
 * A label above a point is not a fixed number of *points*, it is a number of *pixels* — and which
 * of those a chart measures is the whole of what this file is for. `StatsChart` drew its labels
 * inside the marker loop, so the density cap that switches markers off past 40 points took the
 * numbers down with them. That is a decision about markers being applied to labels: a daily chart
 * gained a point a day, and on the fortieth lost every number it printed, all at once, with nothing
 * on the screen to say why. A label with no room should be thinned out, not abolished.
 *
 * Pure, and here rather than inside a render, for `hitTest.ts`'s reason: there is no jsdom in this
 * project, so anything decided during a render is not a state a test can reach.
 */

/*
 * VT323's advance is 0.40em — the same cell the songbook aligns its chords on, and the reason
 * `chordAlignment.test.ts` guards the font's weight. Every label on these charts is drawn in it, so
 * a label's width is its character count and nothing else.
 */
const CELL_EM = 0.4;

/** The width in viewBox units of `chars` characters of VT323 at `fontSize`. */
export function labelWidth(chars: number, fontSize: number): number {
  return Math.max(chars, 0) * CELL_EM * fontSize;
}

/**
 * Label every nth point, n being the smallest stride whose labels do not touch.
 *
 * Always ≥ 1, so a caller can multiply by it without checking; 1 means every point is labelled,
 * which is the answer whenever they fit. `slot` is the label's own width plus whatever gap should
 * be left between two of them.
 */
export function labelStride(
  count: number,
  plotWidth: number,
  slot: number,
): number {
  if (count <= 1 || slot <= 0) return 1;
  // No plot to speak of: one label, which the caller's stride puts on the newest point.
  if (plotWidth <= 0) return count;
  const spacing = plotWidth / (count - 1);
  return Math.max(1, Math.ceil(slot / spacing));
}

/**
 * Whether point `i` of `count` carries a label at this stride.
 *
 * Counted back from the **last** point, so the newest day is always labelled: the right-hand end of
 * these charts is the end being read, and a stride anchored at the left drops it whenever the count
 * is not a multiple of the stride.
 */
export function isLabelled(i: number, count: number, stride: number): boolean {
  return stride > 0 && (count - 1 - i) % stride === 0;
}
