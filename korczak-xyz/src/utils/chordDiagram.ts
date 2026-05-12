export type StringValue = 'x' | number;

export interface ChordShape {
  strings: StringValue[];
}

export interface FretWindow {
  lo: number;
  hi: number;
  label: string | null;
}

const STRING_LETTERS_HIGH_TO_LOW = ['e', 'B', 'G', 'D', 'A', 'E'];

export function parseChord(spec: string): ChordShape {
  const tokens = spec.trim().split(/\s+/);
  if (tokens.length !== 6) {
    throw new Error(`Chord spec must have 6 tokens, got ${tokens.length}: "${spec}"`);
  }
  const strings = tokens.map((t): StringValue => {
    if (t === 'x' || t === 'X') return 'x';
    const n = parseInt(t, 10);
    if (Number.isNaN(n) || n < 0) {
      throw new Error(`Invalid fret token "${t}" in spec "${spec}"`);
    }
    return n;
  });
  return { strings };
}

export function pickFretWindow(shape: ChordShape): FretWindow {
  const frets = shape.strings.filter((s): s is number => typeof s === 'number' && s > 0);
  if (frets.length === 0) return { lo: 1, hi: 4, label: null };
  const hasOpen = shape.strings.includes(0);
  const min = Math.min(...frets);
  const max = Math.max(...frets);
  if (hasOpen && max <= 4) return { lo: 1, hi: 4, label: null };
  const lo = min;
  const hi = Math.max(lo + 3, max);
  const label = lo === 1 ? null : `(${lo}fr)`;
  return { lo, hi, label };
}

export function renderHorizontalDiagram(name: string, spec: string): string {
  const shape = parseChord(spec);
  const window = pickFretWindow(shape);
  const numCols = window.hi - window.lo + 1;

  const lines: string[] = [];
  lines.push(window.label ? `${name} ${window.label}` : name);

  // Body rows look like `X y ---+---+---+---+---` — each `+` sits at columns 8, 12, 16, 20, ...
  // The header row has no "X y " prefix, so we place each fret number so its last digit lands on that column.
  let header = '';
  for (let i = 0; i < numCols; i++) {
    const fret = window.lo + i;
    const targetCol = 8 + i * 4;
    const fretStr = String(fret);
    header = header.padEnd(targetCol - fretStr.length) + fretStr;
  }
  lines.push(header);

  for (let dispIdx = 0; dispIdx < 6; dispIdx++) {
    const stringIdx = 5 - dispIdx;
    const val = shape.strings[stringIdx];
    const letter = STRING_LETTERS_HIGH_TO_LOW[dispIdx];
    const indicator = val === 'x' ? 'x' : val === 0 ? 'o' : ' ';

    let body = '';
    for (let i = 0; i < numCols; i++) {
      const fret = window.lo + i;
      const press = typeof val === 'number' && val > 0 && val === fret ? 'O' : '+';
      body += '---' + press;
    }
    body += '---';

    lines.push(`${letter} ${indicator} ${body}`);
  }

  return lines.join('\n');
}
