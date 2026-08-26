/*
 * Where the pointer is, in the chart's own coordinates — and nothing else.
 *
 * Every value tooltip on this site was an SVG `<title>`, which is a native hover tooltip on a
 * desktop and **nothing at all** on a phone: there is no hover on a touch screen, so a dot's actual
 * value was unreadable on the device the sleep log is used from. This is the half of the fix that
 * every chart shares; what a given coordinate *means* is each chart's own business, decided with
 * `src/utils/charts/hitTest.ts`.
 *
 * Two things here are load-bearing and look like details:
 *
 *   1. **The conversion goes through `getScreenCTM()`**, not arithmetic on `getBoundingClientRect()`.
 *      These charts are drawn at `width: 100%` into a fixed viewBox, inside a panel that can be
 *      scrolled and on a page that can be zoomed. The CTM already accounts for all of it; a scale
 *      factor computed by hand accounts for whichever of them was remembered.
 *   2. **`pointerleave` clears for a mouse only.** A finger fires `pointerleave` the instant it
 *      lifts, so clearing there would blank the reading the tap was for — which is the entire
 *      feature on touch. So a tapped value stays on screen until the next tap, and only a mouse
 *      leaving the chart puts the hint back.
 *
 * `pointermove` covers scrubbing and hovering with one handler and no mode flag, because a touch
 * pointer only reports movement while it is down.
 *
 * Note for callers: **this hook has to be called above the empty-data early return.** Every chart
 * here returns early on no data, two of them as the first statement in the body, so wiring this in
 * means hoisting the call rather than adding a line.
 */

import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** A position in viewBox units. */
export interface ChartPointer {
  x: number;
  y: number;
}

export interface ChartPointerHandlers {
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerCancel: () => void;
}

export interface ChartPointerState {
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Where the pointer is, in viewBox units, or null when the chart is not being pointed at. */
  at: ChartPointer | null;
  handlers: ChartPointerHandlers;
}

export function useChartPointer(): ChartPointerState {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [at, setAt] = useState<ChartPointer | null>(null);

  const track = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    setAt({ x: local.x, y: local.y });
  }, []);

  const leave = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    // A finger has not "left" anything by lifting off, and the value it asked for is still what the
    // reader is looking at.
    if (event.pointerType === 'mouse') setAt(null);
  }, []);

  const cancel = useCallback(() => setAt(null), []);

  return {
    svgRef,
    at,
    handlers: {
      onPointerMove: track,
      onPointerDown: track,
      onPointerLeave: leave,
      onPointerCancel: cancel,
    },
  };
}
