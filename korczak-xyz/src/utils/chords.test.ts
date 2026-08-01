import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectAccidentalPreference,
  isChordLine,
  transposeChord,
  transposeLine,
} from './chords';

// The classifier as it stood before extended chord names were supported. Kept so the
// regression test below can prove no lyric line silently became a chord line.
const LEGACY_PATTERN = /^[A-Ha-h]([#b]|is|es)?(m|maj|min|dim|aug|sus|add|7|9|11|13|6|4|2)*$/;
function legacyIsChordLine(line: string): boolean {
  if (line.trim() === '') return false;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0) return false;
  return tokens.every(token => {
    if (token === '') return true;
    if (/^\d+\.$/.test(token) || /^Ref\.?:?$/.test(token)) return false;
    return LEGACY_PATTERN.test(token);
  });
}

describe('isChordLine', () => {
  it('recognises the extended vocabulary', () => {
    // `ges`/`des` work because the root comes first; bare German `es`/`as` never parsed here
    // and no song uses them, so they stay unsupported.
    for (const chord of ['g', 'g*', 'gMaj7', 'gmaj7', 'g7', 'g6', 'Hb', 'Eb', 'A#', 'D#', 'Asus2', 'c#', 'fis', 'ges']) {
      expect(isChordLine(chord), chord).toBe(true);
    }
  });

  it('reads a whole chord line of mixed widths', () => {
    expect(isChordLine('g7                g6')).toBe(true);
    expect(isChordLine(' Eb    d  c   Hb   F')).toBe(true);
  });

  it('leaves lyrics alone', () => {
    for (const line of [
      'Remember when you were young,',
      'of childhood and stardom,',
      'Blown on the steel breeze.',
      'You martyr, and shine!',
      'and exposed in the light.',
      'Ref.:',
      '1. Za oknem zimowo zaczyna się dzień,',
      '',
    ]) {
      expect(isChordLine(line), line).toBe(false);
    }
  });
});

describe('transposeChord', () => {
  it('leaves everything alone at zero', () => {
    for (const chord of ['g', 'g*', 'gMaj7', 'Hb', 'Eb']) {
      expect(transposeChord(chord, 0)).toBe(chord);
    }
  });

  it('moves pitch in German notation, where B is B-flat and H is B-natural', () => {
    expect(transposeChord('Hb', 2)).toBe('C');
    expect(transposeChord('A#', 2)).toBe('C');
    expect(transposeChord('Eb', 2)).toBe('F');
    expect(transposeChord('B', 1)).toBe('H');
    expect(transposeChord('H', 1)).toBe('C');
  });

  // `Bb` parses as "B-flat, flattened" = A. It is a real chord name, just not the one people
  // reaching for B-flat expect, which is why songs should spell that note `Hb` or `B`.
  it('treats Bb as A-flat-of-B rather than as B-flat', () => {
    expect(transposeChord('Bb', 1)).toBe('B');
    expect(transposeChord('Bb', 1)).not.toBe(transposeChord('Hb', 1));
  });

  it('keeps quality suffixes intact instead of transposing letters inside them', () => {
    expect(transposeChord('Amaj7', 1)).toBe('Bmaj7');
    expect(transposeChord('gMaj7', 1)).toBe('g#Maj7');
    expect(transposeChord('Cmin', 1)).toBe('C#min');
    expect(transposeChord('Asus2', 1)).toBe('Bsus2');
  });

  it('carries the variant marker through unchanged', () => {
    expect(transposeChord('g*', 1)).toBe('g#*');
    expect(transposeChord('g*', 3)).toBe('b*');
    expect(transposeChord('g**', 1)).toBe('g#**');
  });

  it('keeps minor lowercase and major uppercase', () => {
    expect(transposeChord('g', 1)).toBe('g#');
    expect(transposeChord('G', 1)).toBe('G#');
    expect(transposeChord('d', 1)).toBe('d#');
  });

  it('answers in flats when asked', () => {
    expect(transposeChord('D#', 3, 'flat')).toBe('Gb');
    expect(transposeChord('D#', 3, 'sharp')).toBe('F#');
    expect(transposeChord('c', 1, 'flat')).toBe('db');
  });

  it('round-trips over the site vocabulary', () => {
    const vocabulary = ['g', 'g*', 'gMaj7', 'g7', 'g6', 'F#', 'Hb', 'Eb', 'A#', 'D#', 'd', 'D', 'c', 'C', 'F', 'E', 'Asus2', 'c#', 'H'];
    for (const chord of vocabulary) {
      for (const step of [1, 2, 5, 7, 11]) {
        const there = transposeChord(chord, step);
        const back = transposeChord(there, -step);
        // Enharmonic spelling may settle differently (A# comes back as B); pitch must not.
        expect(transposeChord(back, 0), `${chord} +${step} -${step}`).toBe(back);
        expect(transposeChord(back, step)).toBe(there);
      }
    }
  });
});

describe('transposeLine', () => {
  it('holds each chord over the word it started above', () => {
    const line = 'D#    d  c   A#   F';
    const columnsOf = (text: string) =>
      [...text.matchAll(/\S+/g)].map(m => m.index);

    const original = columnsOf(line);
    for (const step of [1, 2, 5, 7]) {
      expect(columnsOf(transposeLine(line, step)), `+${step}`).toEqual(original);
    }
  });

  it('shoves right only as far as a widening chord forces', () => {
    // `g` -> `g#` needs one more column than the gap allows.
    expect(transposeLine('g g g', 1)).toBe('g# g# g#');
  });

  it('does not touch lyric lines', () => {
    expect(transposeLine('Blown on the steel breeze.', 3)).toBe('Blown on the steel breeze.');
  });

  it('transposes the descent as a unit', () => {
    expect(transposeLine('g7                g6', 2)).toBe('a7                a6');
  });
});

describe('detectAccidentalPreference', () => {
  it('follows how the song spells itself', () => {
    expect(detectAccidentalPreference('Eb    d  c   Hb   F\nShine on you crazy diamond.')).toBe('flat');
    expect(detectAccidentalPreference('D#    d  c   A#   F\nShine on you crazy diamond.')).toBe('sharp');
    expect(detectAccidentalPreference('g\nRemember when you were young,')).toBe('sharp');
  });
});

// --- the real content ------------------------------------------------------------------

const songsDir = join(fileURLToPath(new URL('.', import.meta.url)), '../content/songs');

function songFiles(): { name: string; source: string }[] {
  const files: { name: string; source: string }[] = [];
  for (const lang of readdirSync(songsDir)) {
    const dir = join(songsDir, lang);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
      files.push({ name: `${lang}/${file}`, source: readFileSync(join(dir, file), 'utf8') });
    }
  }
  return files;
}

function frontmatterChords(source: string): Set<string> {
  const block = source.match(/\nchords:\n([\s\S]*?)\n(?:[a-zA-Z]|---)/);
  if (!block) return new Set();
  const names = new Set<string>();
  for (const line of block[1].split('\n')) {
    const entry = line.match(/^\s+"?([^":]+)"?\s*:/);
    if (entry) names.add(entry[1]);
  }
  return names;
}

function bodyLines(source: string): string[] {
  const body = source.split('```plaintext\n')[1];
  return body ? body.split('```')[0].split('\n') : [];
}

describe('song content', () => {
  const songs = songFiles();

  it('finds songs to check', () => {
    expect(songs.length).toBeGreaterThan(0);
  });

  for (const { name, source } of songs) {
    const lines = bodyLines(source);
    const declared = frontmatterChords(source);

    // The guard against the case-insensitive quality match swallowing lyrics: a line may only
    // be newly promoted to "chords" if every token on it is a chord the song actually declares.
    it(`${name}: promotes no lyric line to a chord line by accident`, () => {
      for (const line of lines) {
        if (!isChordLine(line) || legacyIsChordLine(line)) continue;
        for (const token of line.trim().split(/\s+/)) {
          expect(declared.has(token), `${name}: "${line.trim()}" -> unknown token ${token}`).toBe(true);
        }
      }
    });

    it(`${name}: still reads every chord line it used to`, () => {
      for (const line of lines) {
        if (legacyIsChordLine(line)) expect(isChordLine(line), line).toBe(true);
      }
    });

    it(`${name}: draws a diagram for every chord it uses`, () => {
      if (declared.size === 0) return;
      for (const line of lines) {
        if (!isChordLine(line)) continue;
        for (const token of line.trim().split(/\s+/)) {
          expect(declared.has(token), `${name}: ${token} has no shape in frontmatter`).toBe(true);
        }
      }
    });
  }
});
