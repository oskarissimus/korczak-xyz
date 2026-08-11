import { describe, expect, it } from 'vitest';
import { PITCH_CLASSES } from './notes';
import type { NoteName } from './notes';
import {
  SCALES,
  SCALE_TYPES,
  isInScale,
  isScaleChoice,
  isScaleType,
  keyLabel,
  keySpelling,
  scaleNotes,
} from './scales';
import type { ScaleChoice } from './scales';

const ALL_NOTES = PITCH_CLASSES.map((p) => p.name);

describe('scaleNotes', () => {
  it('gives C major the seven naturals', () => {
    expect(scaleNotes({ root: 'C', type: 'major' })).toEqual([
      'C', 'D', 'E', 'F', 'G', 'A', 'B',
    ]);
  });

  it('gives A minor the same seven, from a different root', () => {
    expect([...scaleNotes({ root: 'A', type: 'minor' })].sort()).toEqual(
      [...scaleNotes({ root: 'C', type: 'major' })].sort()
    );
  });

  it('gives G major one black note, and it is F♯', () => {
    const notes = scaleNotes({ root: 'G', type: 'major' });
    expect(notes).toContain('F#');
    expect(notes).not.toContain('F');
  });

  it('gives E minor pentatonic its five', () => {
    expect(scaleNotes({ root: 'E', type: 'pentatonicMinor' })).toEqual([
      'E', 'G', 'A', 'B', 'D',
    ]);
  });

  it('adds the ♭5 to the minor pentatonic to make the blues scale', () => {
    const pent = scaleNotes({ root: 'A', type: 'pentatonicMinor' });
    const blues = scaleNotes({ root: 'A', type: 'blues' });
    expect(blues).toHaveLength(pent.length + 1);
    for (const note of pent) expect(blues).toContain(note);
    expect(blues).toContain('D#'); // the ♭5 of A
  });

  it('wraps rather than running off the top of the twelve', () => {
    for (const type of SCALE_TYPES) {
      for (const root of ALL_NOTES) {
        const notes = scaleNotes({ root, type });
        expect(notes).toHaveLength(SCALES[type].steps.length);
        expect(new Set(notes).size).toBe(notes.length);
        for (const note of notes) expect(ALL_NOTES).toContain(note);
      }
    }
  });
});

describe('isInScale', () => {
  it('lets everything through when there is no scale', () => {
    for (const note of ALL_NOTES) expect(isInScale(null, note)).toBe(true);
  });

  it('keeps the naturals and drops the black keys in C major', () => {
    const c: ScaleChoice = { root: 'C', type: 'major' };
    expect(isInScale(c, 'E')).toBe(true);
    expect(isInScale(c, 'F#')).toBe(false);
    expect(isInScale(c, 'A#')).toBe(false);
  });
});

/*
 * The spelling is a property of the key, not of the note: F♯ and G♭ are the same fret, and only
 * one of them is written in any given key. These three are the cases that pin the relative-major
 * offset — get it wrong and the minor keys all come out spelt as their parallel majors.
 */
describe('keySpelling', () => {
  it('spells A minor like C major — nothing, so sharp', () => {
    expect(keySpelling({ root: 'A', type: 'minor' })).toBe('sharp');
    expect(keySpelling({ root: 'C', type: 'major' })).toBe('sharp');
  });

  it('spells D minor like F major — flat, because F major has B♭', () => {
    expect(keySpelling({ root: 'D', type: 'minor' })).toBe('flat');
    expect(keySpelling({ root: 'F', type: 'major' })).toBe('flat');
  });

  it('spells E minor like G major — sharp, because G major has F♯', () => {
    expect(keySpelling({ root: 'E', type: 'minor' })).toBe('sharp');
    expect(keySpelling({ root: 'G', type: 'major' })).toBe('sharp');
  });

  it('spells the five flat majors flat and the rest sharp', () => {
    const flats: NoteName[] = ['C#', 'D#', 'F', 'G#', 'A#']; // D♭, E♭, F, A♭, B♭
    for (const root of ALL_NOTES) {
      expect(keySpelling({ root, type: 'major' })).toBe(
        flats.includes(root) ? 'flat' : 'sharp'
      );
    }
  });

  it('gives the two pentatonics the spelling of the scale they come from', () => {
    for (const root of ALL_NOTES) {
      expect(keySpelling({ root, type: 'pentatonicMajor' })).toBe(
        keySpelling({ root, type: 'major' })
      );
      expect(keySpelling({ root, type: 'pentatonicMinor' })).toBe(
        keySpelling({ root, type: 'minor' })
      );
      expect(keySpelling({ root, type: 'blues' })).toBe(keySpelling({ root, type: 'minor' }));
    }
  });
});

describe('keyLabel', () => {
  it('names a key under its own spelling', () => {
    expect(keyLabel({ root: 'A#', type: 'major' }, 'international')).toBe('B♭');
    expect(keyLabel({ root: 'F#', type: 'major' }, 'international')).toBe('F♯');
  });

  it('reads the same root differently under major and minor', () => {
    expect(keyLabel({ root: 'D#', type: 'major' }, 'international')).toBe('E♭');
    expect(keyLabel({ root: 'D#', type: 'minor' }, 'international')).toBe('D♯');
  });

  it('follows the notation setting', () => {
    expect(keyLabel({ root: 'A#', type: 'major' }, 'german')).toBe('B');
    expect(keyLabel({ root: 'B', type: 'major' }, 'german')).toBe('H');
  });

  it('leaves a natural alone', () => {
    for (const root of ['C', 'D', 'E', 'F', 'G', 'A'] as NoteName[]) {
      expect(keyLabel({ root, type: 'major' }, 'international')).toBe(root);
    }
  });
});

describe('isScaleChoice', () => {
  it('accepts every scale this build can practise', () => {
    for (const type of SCALE_TYPES) {
      for (const root of ALL_NOTES) expect(isScaleChoice({ root, type })).toBe(true);
    }
  });

  // Settings sync, so these arrive from a newer build rather than from a typo. Rejecting them is
  // what stops `scaleNotes` reaching for a table entry that is not there.
  it('rejects a scale type it has never heard of', () => {
    expect(isScaleChoice({ root: 'C', type: 'dorian' })).toBe(false);
    expect(isScaleType('dorian')).toBe(false);
  });

  it('rejects a root that is not one of the twelve', () => {
    expect(isScaleChoice({ root: 'H', type: 'major' })).toBe(false);
    expect(isScaleChoice({ root: 'C♯', type: 'major' })).toBe(false);
    expect(isScaleChoice({ root: 7, type: 'major' })).toBe(false);
  });

  it('rejects the shapes that are not a choice at all', () => {
    expect(isScaleChoice(null)).toBe(false);
    expect(isScaleChoice(undefined)).toBe(false);
    expect(isScaleChoice('major')).toBe(false);
    expect(isScaleChoice({})).toBe(false);
  });
});
