import { describe, expect, it } from 'vitest';

import { bandIndex, nearestIndex, nearestPoint, rowIndex, spanAt } from './hitTest';

describe('nearestIndex', () => {
  const xs = [50, 150, 250, 350];

  it('picks the closer of two', () => {
    expect(nearestIndex(xs, 149)).toBe(1);
    expect(nearestIndex(xs, 151)).toBe(1);
    expect(nearestIndex(xs, 201)).toBe(2);
  });

  it('resolves a tie to the earlier index', () => {
    expect(nearestIndex(xs, 200)).toBe(1);
  });

  it('reaches past both ends when nothing bounds it', () => {
    expect(nearestIndex(xs, -400)).toBe(0);
    expect(nearestIndex(xs, 9000)).toBe(3);
  });

  it('gives null past maxDistance', () => {
    expect(nearestIndex(xs, 300, 40)).toBe(null);
    expect(nearestIndex(xs, 300, 50)).toBe(2);
  });

  it('gives null for no points', () => {
    expect(nearestIndex([], 100)).toBe(null);
  });
});

describe('nearestPoint', () => {
  /* Two lanes at the same x — the case x alone cannot decide. */
  const dots = [
    { x: 100, y: 50 },
    { x: 100, y: 150 },
    { x: 300, y: 50 },
  ];

  it('separates two dots sharing an x', () => {
    expect(nearestPoint(dots, { x: 104, y: 60 })).toBe(0);
    expect(nearestPoint(dots, { x: 104, y: 140 })).toBe(1);
  });

  it('measures in both dimensions', () => {
    // Nearer in x to the third dot, nearer overall to the first.
    expect(nearestPoint(dots, { x: 220, y: 52 })).toBe(2);
    expect(nearestPoint(dots, { x: 180, y: 52 })).toBe(0);
  });

  it('gives null past maxDistance', () => {
    expect(nearestPoint(dots, { x: 100, y: 300 }, 40)).toBe(null);
    expect(nearestPoint([], { x: 0, y: 0 })).toBe(null);
  });
});

describe('bandIndex', () => {
  it('reads a slot from its left edge', () => {
    expect(bandIndex(44, 44, 10, 5)).toBe(0);
    expect(bandIndex(53.9, 44, 10, 5)).toBe(0);
    expect(bandIndex(54, 44, 10, 5)).toBe(1);
  });

  it('keeps the last slot at its right edge', () => {
    expect(bandIndex(93.9, 44, 10, 5)).toBe(4);
    expect(bandIndex(94, 44, 10, 5)).toBe(null);
  });

  it('gives null left of the plot', () => {
    expect(bandIndex(43.9, 44, 10, 5)).toBe(null);
  });

  it('gives null for an empty chart', () => {
    expect(bandIndex(50, 44, 10, 0)).toBe(null);
    expect(bandIndex(50, 44, 0, 5)).toBe(null);
  });
});

describe('rowIndex', () => {
  const args = [18, 16, 3, 4] as const;

  it('reads a row from its top edge', () => {
    expect(rowIndex(18, ...args)).toBe(0);
    expect(rowIndex(33.9, ...args)).toBe(0);
    expect(rowIndex(37, ...args)).toBe(1);
  });

  /* The gap between rows belongs to neither: a fifth of this chart's height is gap, and giving it
     to the row above would put the readout a day out for all of it. */
  it('gives null in the gap between rows', () => {
    expect(rowIndex(34, ...args)).toBe(null);
    expect(rowIndex(36.9, ...args)).toBe(null);
  });

  it('gives null above and below the rows', () => {
    expect(rowIndex(17, ...args)).toBe(null);
    expect(rowIndex(18 + 4 * 19, ...args)).toBe(null);
    // The last row ends at its own height, not at the pitch: the gap below it is gap like any other.
    expect(rowIndex(18 + 3 * 19 + 15, ...args)).toBe(3);
    expect(rowIndex(18 + 3 * 19 + 16, ...args)).toBe(null);
  });

  it('gives null for no rows', () => {
    expect(rowIndex(20, 18, 16, 3, 0)).toBe(null);
  });
});

describe('spanAt', () => {
  const spans = [
    { from: 10, to: 30 },
    { from: 25, to: 60 },
  ];

  it('finds the span covering x', () => {
    expect(spanAt(spans, 12)).toBe(0);
    expect(spanAt(spans, 50)).toBe(1);
  });

  /* Drawing order is the tie-breaker: the last one drawn is the one on the screen. */
  it('prefers the later span where two overlap', () => {
    expect(spanAt(spans, 27)).toBe(1);
  });

  it('includes both edges', () => {
    expect(spanAt([{ from: 10, to: 30 }], 10)).toBe(0);
    expect(spanAt([{ from: 10, to: 30 }], 30)).toBe(0);
  });

  it('gives null outside every span', () => {
    expect(spanAt(spans, 9)).toBe(null);
    expect(spanAt(spans, 61)).toBe(null);
    expect(spanAt([], 20)).toBe(null);
  });
});
