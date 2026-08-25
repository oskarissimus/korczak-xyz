/*
 * Marker shapes, and the legend swatch that draws the same one.
 *
 * The second channel on a *line* chart is a dash pattern; the second channel on a set of points is
 * the shape of the point. Both are useless if the legend does not carry them — a legend of solid
 * colour squares under a chart of dashed lines and triangles tells a monochrome reader which
 * colours exist and nothing about which series is which. So the swatch here is a small `<svg>`
 * drawn by the same `Mark` the chart uses, rather than a `<span>` with a background: a `<span>` can
 * be given a texture with a gradient, but it cannot be given a triangle, and two swatch mechanisms
 * that have to agree about a shape are one that will not.
 *
 * `Mark` takes `r` as the radius of the *equivalent disc* and sizes every other shape to match it
 * by area rather than by bounding box. Without that a triangle inscribed in the disc's box reads
 * about a third lighter than the disc beside it, which on a chart where the shape *is* the category
 * looks like a difference in the data.
 */

import type { ReactNode } from 'react';

/*
 * Every shape is **filled**, and a hollow ring is deliberately not on the list. A ring has to be
 * stroked, so it cannot take its colour from the `fill` the series classes all declare — it would
 * need each of them to set `color` as well, and `.chart-mark--ring { fill: none }` would have to
 * beat a series class of equal specificity that is imported later in the sheet. Four filled shapes
 * separate perfectly well at four pixels, and none of them can be defeated by cascade order.
 */
export type MarkShape = 'disc' | 'square' | 'triangle' | 'diamond';

interface MarkProps {
  shape: MarkShape;
  cx: number;
  cy: number;
  /** Radius of the equivalent disc. Every shape is sized from this. */
  r: number;
  /** The series' colour class. */
  className?: string;
  /** A `<title>`, where the mark carries a tooltip. */
  children?: ReactNode;
}

/** Side of a square with the same area as a disc of radius r. */
const squareSide = (r: number) => r * Math.sqrt(Math.PI);
/** Circumradius of an equilateral triangle with the same area as a disc of radius r. */
const triangleR = (r: number) => r * Math.sqrt((4 * Math.PI) / (3 * Math.sqrt(3)));

export function Mark({ shape, cx, cy, r, className, children }: MarkProps) {
  const cls = `chart-mark chart-mark--${shape}${className ? ` ${className}` : ''}`;

  if (shape === 'disc') {
    return (
      <circle className={cls} cx={cx} cy={cy} r={r}>
        {children}
      </circle>
    );
  }

  if (shape === 'square') {
    const s = squareSide(r);
    return (
      <rect className={cls} x={cx - s / 2} y={cy - s / 2} width={s} height={s}>
        {children}
      </rect>
    );
  }

  if (shape === 'diamond') {
    const s = squareSide(r) * 0.71;
    return (
      <polygon className={cls} points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}>
        {children}
      </polygon>
    );
  }

  const R = triangleR(r);
  /* Nudged down by an eighth of the circumradius: an equilateral triangle's centroid sits below the
     centre of its circumcircle, so a triangle centred on the circumcentre reads as sitting high
     against the discs on the same row. */
  const midY = cy + R / 8;
  const points = [0, 1, 2]
    .map((i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      return `${cx + R * Math.cos(a)},${midY + R * Math.sin(a)}`;
    })
    .join(' ');
  return (
    <polygon className={cls} points={points}>
      {children}
    </polygon>
  );
}

interface SeriesSwatchProps {
  /** The series' colour class — the same one the chart draws its markers with. */
  className: string;
  /** The marker, where the series has one. */
  shape?: MarkShape;
  /** Draw the series' line through the swatch. Off for a series that is points only. */
  line?: boolean;
  /** The line's class, where a stroke and a fill cannot share one — which is the usual case. */
  lineClassName?: string;
}

const SW = 24;
const SH = 12;

/**
 * A legend swatch showing the series as the chart draws it: its line, its dash pattern and its
 * marker, at the size they are read at.
 */
export function SeriesSwatch({ className, shape, line = true, lineClassName }: SeriesSwatchProps) {
  return (
    <svg
      className="chart-swatch"
      viewBox={`0 0 ${SW} ${SH}`}
      width={SW}
      height={SH}
      aria-hidden="true"
      focusable="false"
    >
      {line && (
        <line
          className={lineClassName ?? className}
          x1={0}
          x2={SW}
          y1={SH / 2}
          y2={SH / 2}
          strokeWidth={2}
        />
      )}
      {shape && <Mark shape={shape} cx={SW / 2} cy={SH / 2} r={3.2} className={className} />}
    </svg>
  );
}
