import { describe, expect, it } from 'vitest';
import { fretWindow, renderNoteDiagram } from './diagram';
import { MAX_FRET, STRING_COUNT } from './notes';

describe('fretWindow', () => {
  it('puts the target third from the left where the neck allows', () => {
    expect(fretWindow(7)).toEqual({ lo: 5, hi: 9 });
    expect(fretWindow(4)).toEqual({ lo: 2, hi: 6 });
  });

  it('clamps at the nut', () => {
    expect(fretWindow(0)).toEqual({ lo: 1, hi: 5 });
    expect(fretWindow(1)).toEqual({ lo: 1, hi: 5 });
    expect(fretWindow(3)).toEqual({ lo: 1, hi: 5 });
  });

  it('clamps at the top of the neck', () => {
    expect(fretWindow(11)).toEqual({ lo: 8, hi: 12 });
    expect(fretWindow(12)).toEqual({ lo: 8, hi: 12 });
  });

  it('always contains the fret it was asked about', () => {
    for (let fret = 1; fret <= MAX_FRET; fret++) {
      const { lo, hi } = fretWindow(fret);
      expect(fret).toBeGreaterThanOrEqual(lo);
      expect(fret).toBeLessThanOrEqual(hi);
    }
  });
});

describe('renderNoteDiagram', () => {
  it('draws six strings under a row of fret numbers', () => {
    const lines = renderNoteDiagram(2, 7);
    expect(lines).toHaveLength(STRING_COUNT + 1);
    expect(lines[0].trim().split(/\s+/)).toEqual(['5', '6', '7', '8', '9']);
    // Strings are drawn high to low, the way every chord chart is read.
    expect(lines.slice(1).map((l) => l[0])).toEqual(['e', 'B', 'G', 'D', 'A', 'E']);
  });

  it('lines the fret numbers up with the cells they label', () => {
    // The whole notation depends on this: a number over the wrong column asks a different
    // question. Each `+` is the cell for the fret whose last digit sits in the same place.
    const lines = renderNoteDiagram(0, 9);
    const header = lines[0];
    const row = lines[1];
    const cells = [...row].flatMap((ch, i) => (ch === '+' || ch === '●' ? [i] : []));
    expect(cells).toHaveLength(5);
    for (const [i, column] of cells.entries()) {
      expect(header[column]).toBe(String(fretWindow(9).lo + i).slice(-1));
    }
  });

  it('marks exactly one position', () => {
    const dots = renderNoteDiagram(3, 5).join('\n').match(/●/gu) ?? [];
    expect(dots).toHaveLength(1);
  });

  it('puts the dot on the target string, in the target fret', () => {
    const lines = renderNoteDiagram(2, 7); // D string, 7th fret
    const marked = lines.slice(1).findIndex((l) => l.includes('●'));
    expect(marked).toBe(3); // e B G D — fourth row down
    const row = lines[1 + marked];
    const cells = [...row].flatMap((ch, i) => (ch === '+' || ch === '●' ? [i] : []));
    expect(row[cells[2]]).toBe('●'); // 7 is the third of frets 5..9
  });

  it('marks an open string on the nut, not in a fret', () => {
    const lines = renderNoteDiagram(1, 0);
    const row = lines.slice(1).find((l) => l.includes('●'))!;
    expect(row.indexOf('●')).toBe(2); // the indicator column, before the strings start
    expect(row).not.toMatch(/-●-/u);
  });

  it('keeps the columns aligned when the string letters are hidden', () => {
    const withLabels = renderNoteDiagram(2, 7);
    const without = renderNoteDiagram(2, 7, { stringLabels: false });
    expect(without[0]).toBe(withLabels[0]);
    expect(without.map((l) => l.length)).toEqual(withLabels.map((l) => l.length));
    expect(without.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(without.join('\n')).toContain('●');
  });

  it('renders every card in the deck at the same width', () => {
    const widths = new Set<number>();
    for (let s = 0; s < STRING_COUNT; s++) {
      for (let f = 0; f <= MAX_FRET; f++) {
        for (const line of renderNoteDiagram(s, f)) widths.add(line.length);
      }
    }
    // The header is shorter than the body rows (it stops at its last digit); everything else
    // is one width, so no card is wider than any other and the panel never resizes.
    expect([...widths].sort((a, b) => a - b)).toEqual([24, 27]);
  });
});
