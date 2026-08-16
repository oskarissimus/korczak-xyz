import { describe, expect, it } from 'vitest';
import {
  NOTATIONS,
  PATTERN_IDS,
  chordLabel,
  chordLabels,
  chordsOf,
  intervalBetween,
  isDiatonic,
  keyLabel,
  keyOf,
  keySpelling,
  keysProducing,
  patternLabel,
  pitchClassLabel,
} from './theory';
import type { Notation } from './theory';

const polish: Notation = 'polish';
const german: Notation = 'german';
const intl: Notation = 'international';

describe('a key spells its own chords', () => {
  it('gives the guitar keys the chords the songbook writes', () => {
    expect(chordLabels(0, '145', intl)).toEqual(['C', 'F', 'G']);
    expect(chordLabels(7, '145', intl)).toEqual(['G', 'C', 'D']);
    expect(chordLabels(9, '145', intl)).toEqual(['A', 'D', 'E']);
    expect(chordLabels(2, '1456', intl)).toEqual(['D', 'G', 'A', 'Bm']);
  });

  it('flattens the flat keys rather than reaching for the enharmonic sharp', () => {
    // F major's fourth is B flat. A♯ would be the same fret and the wrong word.
    expect(chordLabels(5, '145', intl)).toEqual(['F', 'Bb', 'C']);
    expect(chordLabels(3, '145', intl)).toEqual(['Eb', 'Ab', 'Bb']);
    expect(chordLabels(1, '145', intl)).toEqual(['Db', 'Gb', 'Ab']);
    expect(chordLabels(8, '1456', intl)).toEqual(['Ab', 'Db', 'Eb', 'Fm']);
  });

  it('sharpens the sharp keys', () => {
    expect(chordLabels(4, '145', intl)).toEqual(['E', 'A', 'B']);
    expect(chordLabels(6, '1456', intl)).toEqual(['F#', 'B', 'C#', 'D#m']);
    expect(chordLabels(11, '145', intl)).toEqual(['B', 'E', 'F#']);
  });

  it('gives a minor key its relative major’s signature', () => {
    // A minor is C major's relative, so it spells with sharps-by-default (no accidentals at all
    // here); D minor is F major's, so its own chords come out flat.
    expect(keySpelling({ tonic: 9, mode: 'minor' })).toBe('sharp');
    expect(keySpelling({ tonic: 2, mode: 'minor' })).toBe('flat');
    expect(chordLabels(2, 'm14V', intl)).toEqual(['Dm', 'Gm', 'A']);
  });
});

describe('notation', () => {
  it('writes the songbook’s own chords under the Polish system', () => {
    expect(chordLabels(5, '145', polish)).toEqual(['F', 'B', 'C']); // F B C, as in the charts
    expect(chordLabels(2, '1456', polish)).toEqual(['D', 'G', 'A', 'h']);
    expect(chordLabels(4, '145', polish)).toEqual(['E', 'A', 'H']);
    expect(chordLabels(9, 'm14V', polish)).toEqual(['a', 'd', 'E']);
    expect(chordLabels(9, '1456', polish)).toEqual(['A', 'D', 'E', 'f#']);
  });

  it('spells black keys as syllables under the German one, keeping H and B', () => {
    expect(chordLabels(9, '1456', german)).toEqual(['A', 'D', 'E', 'fis']);
    expect(chordLabels(3, '145', german)).toEqual(['Es', 'As', 'B']);
    expect(chordLabels(1, '145', german)).toEqual(['Des', 'Ges', 'As']);
    expect(chordLabel(11, 'major', german, 'sharp')).toBe('H');
  });

  it('is the international system that differs about B', () => {
    // A bare `B` is B flat in a Polish chart and B natural in an English one. This is the trap
    // the two H-systems exist to drill, and it is the only place they disagree with the third.
    expect(chordLabel(11, 'major', polish, 'sharp')).toBe('H');
    expect(chordLabel(11, 'major', intl, 'sharp')).toBe('B');
    expect(chordLabel(10, 'major', polish, 'flat')).toBe('B');
    expect(chordLabel(10, 'major', intl, 'flat')).toBe('Bb');
  });

  it('suffixes minor only in the international system', () => {
    expect(chordLabel(9, 'minor', intl, 'sharp')).toBe('Am');
    expect(chordLabel(9, 'minor', polish, 'sharp')).toBe('a');
    expect(chordLabel(9, 'minor', german, 'sharp')).toBe('a');
  });

  it('offers both spellings on a pad button and one word where they agree', () => {
    expect(pitchClassLabel(6, intl)).toBe('F#/Gb');
    expect(pitchClassLabel(6, german)).toBe('Fis/Ges');
    expect(pitchClassLabel(10, polish)).toBe('B');
    expect(pitchClassLabel(10, intl)).toBe('A#/Bb');
    expect(pitchClassLabel(0, intl)).toBe('C');
  });

  it('names a key by its own spelling', () => {
    expect(keyLabel(keyOf(10, '145'), intl)).toBe('Bb');
    expect(keyLabel(keyOf(10, '145'), polish)).toBe('B');
    expect(keyLabel(keyOf(11, '145'), polish)).toBe('H');
    expect(keyLabel(keyOf(1, '145'), german)).toBe('Des');
  });

  it('has three systems, the songbook’s leading', () => {
    expect(NOTATIONS).toEqual(['polish', 'german', 'international']);
  });
});

describe('patterns', () => {
  it('names itself the way the settings panel prints it', () => {
    expect(patternLabel('145')).toBe('I IV V');
    expect(patternLabel('1456')).toBe('I IV V vi');
    expect(patternLabel('m145')).toBe('i iv v');
    expect(patternLabel('m14V')).toBe('i iv V');
  });

  it('raises the seventh on the harmonic-minor pattern and not the natural one', () => {
    expect(chordsOf(9, 'm145').map((c) => c.quality)).toEqual(['minor', 'minor', 'minor']);
    expect(chordsOf(9, 'm14V').map((c) => c.quality)).toEqual(['minor', 'minor', 'major']);
  });

  it('keeps the chords in degree order', () => {
    expect(chordsOf(0, '1456').map((c) => c.numeral)).toEqual(['I', 'IV', 'V', 'vi']);
  });
});

describe('the `key` direction is answerable', () => {
  /*
   * The whole direction rests on a set of chords naming one key. Argued rather than obvious —
   * {C, F, G} is C major because F major wants a B♭ and G major wants an F♯ — so it is checked
   * over every card the deck can hold rather than trusted.
   */
  it('never produces the same chord set from two different keys', () => {
    const seen = new Map<string, string>();
    for (const pattern of PATTERN_IDS) {
      for (let tonic = 0; tonic < 12; tonic++) {
        const set = chordsOf(tonic, pattern)
          .map((c) => `${c.pc}:${c.quality}`)
          .sort()
          .join(' ');
        expect(seen.has(set), `${set} is both ${seen.get(set)} and ${tonic}:${pattern}`).toBe(false);
        seen.set(set, `${tonic}:${pattern}`);
      }
    }
  });

  it('resolves a set back to the one key that produced it', () => {
    expect(keysProducing(chordsOf(0, '145'))).toEqual([{ tonic: 0, pattern: '145' }]);
    expect(keysProducing(chordsOf(9, 'm14V'))).toEqual([{ tonic: 9, pattern: 'm14V' }]);
  });

  it('answers "none" rather than guessing for a set no pattern produces', () => {
    expect(
      keysProducing([
        { pc: 0, quality: 'major', numeral: 'I' },
        { pc: 1, quality: 'major', numeral: 'I' },
      ])
    ).toEqual([]);
  });
});

describe('intervalBetween', () => {
  it('takes the shortest way round the circle', () => {
    expect(intervalBetween(9, 0)).toBe(3); // A up to C
    expect(intervalBetween(0, 9)).toBe(-3); // C down to A
    expect(intervalBetween(0, 6)).toBe(6); // the tritone resolves upward
    expect(intervalBetween(5, 5)).toBe(0);
  });
});

describe('isDiatonic', () => {
  it('accepts a major key’s own triads and refuses a borrowed one', () => {
    expect(isDiatonic({ tonic: 0, mode: 'major' }, 5, false)).toBe(true); // F in C
    expect(isDiatonic({ tonic: 0, mode: 'major' }, 9, true)).toBe(true); // Am in C
    expect(isDiatonic({ tonic: 0, mode: 'major' }, 9, false)).toBe(false); // A major is not
  });

  it('counts the raised-seventh dominant as belonging to a minor key', () => {
    // A song in A minor playing an E major chord has not left the key — that is the harmonic
    // minor, and half the songbook does it.
    expect(isDiatonic({ tonic: 9, mode: 'minor' }, 4, false)).toBe(true);
    expect(isDiatonic({ tonic: 9, mode: 'minor' }, 4, true)).toBe(true);
  });
});
