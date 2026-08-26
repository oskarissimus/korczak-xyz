import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLabelled, labelStride, labelWidth } from './labels';

describe('labelWidth', () => {
  it('measures in VT323 cells', () => {
    expect(labelWidth(2, 13)).toBeCloseTo(10.4);
    expect(labelWidth(6, 13)).toBeCloseTo(31.2);
  });

  it('is zero for nothing to draw', () => {
    expect(labelWidth(0, 13)).toBe(0);
  });
});

describe('labelStride', () => {
  it('labels every point while they fit', () => {
    // 10 points across 500px is 55.6px apart; a 15px label is nowhere near touching.
    expect(labelStride(10, 500, 15)).toBe(1);
  });

  it('thins as the points crowd', () => {
    // 41 points across 500px is 12.5px apart, so a 15px label needs every other point.
    expect(labelStride(41, 500, 15)).toBe(2);
    // 121 points is 4.2px apart: every fourth.
    expect(labelStride(121, 500, 15)).toBe(4);
  });

  it('gives a stride of at least one', () => {
    expect(labelStride(0, 500, 15)).toBe(1);
    expect(labelStride(1, 500, 15)).toBe(1);
    expect(labelStride(200, 500, 0)).toBe(1);
  });

  it('falls back to a single label with no plot to draw in', () => {
    expect(labelStride(30, 0, 15)).toBe(30);
  });
});

describe('isLabelled', () => {
  it('counts back from the newest point', () => {
    // 10 points, every third: 9, 6, 3, 0 — anchored at the newest and not at the oldest.
    expect(isLabelled(9, 10, 3)).toBe(true);
    expect(isLabelled(6, 10, 3)).toBe(true);
    expect(isLabelled(8, 10, 3)).toBe(false);
    expect(isLabelled(7, 10, 3)).toBe(false);
  });

  it('drops the oldest points rather than the newest', () => {
    // 11 points, every third: 10, 7, 4, 1 — the extra one falls off the left-hand end.
    expect(isLabelled(10, 11, 3)).toBe(true);
    expect(isLabelled(0, 11, 3)).toBe(false);
  });

  it('labels everything at a stride of one', () => {
    for (let i = 0; i < 5; i += 1) expect(isLabelled(i, 5, 1)).toBe(true);
  });
});

/*
 * The label's font size is stated twice — as `LABEL_FONT_SIZE` in `StatsChart.tsx`, which is what
 * the stride is computed from, and as `font-size` on `.typing-chart-label`, which is what actually
 * gets drawn. Nothing can make them agree by construction (one is TypeScript and one is CSS), and
 * the failure is silent in both directions — labels that overlap, or a chart that thins out numbers
 * it had room for. So they are read as text and compared, the way `chordAlignment.test.ts` and
 * `pwa/tiers.test.ts` guard the facts their own subjects cannot reach.
 */
describe('the font size the stride assumes', () => {
  it('is the one the stylesheet draws with', () => {
    const css = readFileSync(new URL('../../styles/typing.css', import.meta.url), 'utf8');
    const rule = css.match(/\.typing-chart-label\s*\{[^}]*\}/)?.[0];
    expect(rule).toBeDefined();
    const size = rule?.match(/font-size:\s*(\d+)px/)?.[1];

    const chart = readFileSync(
      new URL('../../components/Typing/StatsChart.tsx', import.meta.url),
      'utf8'
    );
    const constant = chart.match(/const LABEL_FONT_SIZE = (\d+);/)?.[1];

    expect(size).toBeDefined();
    expect(constant).toBe(size);
  });
});
