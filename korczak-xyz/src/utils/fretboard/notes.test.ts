import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  MAX_FRET,
  PITCH_CLASSES,
  STRING_COUNT,
  asksEveryPlace,
  cardId,
  cardNote,
  cardNoteLabel,
  cardNotation,
  displayNotation,
  fretsSounding,
  hasTwoNotations,
  hasTwoSpellings,
  isPositionDirection,
  isPositionKey,
  midiLabel,
  midisInScope,
  noteCardId,
  noteLabelAt,
  noteNameAt,
  notesInScope,
  octaveAt,
  parseCardId,
  pitchCardId,
  pitchLabel,
  positionsAnswering,
  positionsOfNote,
  positionsSounding,
  spellingLabel,
  stringLabel,
} from './notes';
import type { PositionDirection } from './notes';

const POSITION_DIRECTIONS = DIRECTIONS.filter((d): d is PositionDirection =>
  isPositionDirection(d)
);
const ALL_STRINGS = Array.from({ length: STRING_COUNT }, (_, i) => i);

describe('noteNameAt', () => {
  it('names the open strings', () => {
    const open = Array.from({ length: STRING_COUNT }, (_, s) => noteNameAt(s, 0));
    expect(open).toEqual(['E', 'A', 'D', 'G', 'B', 'E']);
  });

  it('names positions up the neck', () => {
    expect(noteNameAt(0, 5)).toBe('A'); // low E string, 5th fret
    expect(noteNameAt(1, 2)).toBe('B');
    expect(noteNameAt(2, 7)).toBe('A');
    expect(noteNameAt(4, 1)).toBe('C');
    expect(noteNameAt(5, 3)).toBe('G');
  });

  it('closes the octave at the twelfth fret', () => {
    for (let s = 0; s < STRING_COUNT; s++) {
      expect(noteNameAt(s, 12)).toBe(noteNameAt(s, 0));
      expect(octaveAt(s, 12)).toBe(octaveAt(s, 0) + 1);
    }
  });

  it('labels accidentals both ways round', () => {
    expect(noteLabelAt(0, 1, 'international')).toBe('F');
    expect(noteLabelAt(0, 2, 'international')).toBe('F♯/G♭');
  });

  it('rejects a position that is not on the instrument', () => {
    expect(() => noteNameAt(6, 0)).toThrow();
    expect(() => noteNameAt(0, -1)).toThrow();
  });
});

describe('notation', () => {
  it('renames six of the twelve and leaves the naturals alone', () => {
    const differ = PITCH_CLASSES.filter(
      ({ name }) => pitchLabel(name, 'german') !== pitchLabel(name, 'international')
    ).map(({ name }) => name);
    // The five black keys, whose accidentals are spelt out as syllables, and B natural, which
    // needs a letter of its own once the black key below it has taken B.
    expect(differ).toEqual(['C#', 'D#', 'F#', 'G#', 'A#', 'B']);
  });

  it('gives B to the black key and H to B natural', () => {
    expect(pitchLabel('A#', 'international')).toBe('A♯/B♭');
    expect(pitchLabel('A#', 'german')).toBe('Ais/B');
    expect(pitchLabel('B', 'international')).toBe('B');
    expect(pitchLabel('B', 'german')).toBe('H');
  });

  it('spells the accidentals out as syllables', () => {
    expect(pitchLabel('C#', 'german')).toBe('Cis/Des');
    expect(pitchLabel('D#', 'german')).toBe('Dis/Es');
    expect(pitchLabel('F#', 'german')).toBe('Fis/Ges');
    expect(pitchLabel('G#', 'german')).toBe('Gis/As');
  });

  it('makes the 2nd string the H string, and leaves the case alone', () => {
    const german = Array.from({ length: STRING_COUNT }, (_, s) => stringLabel(s, 'german'));
    expect(german).toEqual(['E', 'A', 'D', 'G', 'H', 'e']);
    const intl = Array.from({ length: STRING_COUNT }, (_, s) => stringLabel(s, 'international'));
    expect(intl).toEqual(['E', 'A', 'D', 'G', 'B', 'e']);
  });

  it('follows through to a position on the neck', () => {
    // 2nd string open, and the fret below it.
    expect(noteLabelAt(4, 0, 'german')).toBe('H');
    expect(noteLabelAt(4, 11, 'german')).toBe('Ais/B');
  });

  it('leaves the stored name alone, whichever notation is shown', () => {
    // The deck is keyed and graded on `noteNameAt`, and `ReviewEvent.answered` records it. A
    // notation that reached this far would split one card's history in two.
    expect(noteNameAt(4, 0)).toBe('B');
    expect(noteNameAt(4, 11)).toBe('A#');
    expect(PITCH_CLASSES.map((p) => p.name)).toContain('B');
    expect(PITCH_CLASSES.map((p) => p.name)).not.toContain('H');
  });
});

describe('spellings', () => {
  it('gives the five black keys two names and the seven naturals one', () => {
    const two = PITCH_CLASSES.filter(({ name }) => hasTwoSpellings(name)).map(({ name }) => name);
    expect(two).toEqual(['C#', 'D#', 'F#', 'G#', 'A#']);
  });

  it('spells each side of a black key on its own', () => {
    expect(spellingLabel('C#', 'sharp', 'international')).toBe('C♯');
    expect(spellingLabel('C#', 'flat', 'international')).toBe('D♭');
    expect(spellingLabel('D', 'flat', 'international')).toBe('D');
  });

  it('renames rather than merges under German notation', () => {
    // A♯ is still two names there — the flat one is just B rather than B♭ — so which positions
    // are two cards cannot move with the setting.
    expect(spellingLabel('A#', 'sharp', 'german')).toBe('Ais');
    expect(spellingLabel('A#', 'flat', 'german')).toBe('B');
    expect(spellingLabel('B', 'sharp', 'german')).toBe('H');
    expect(spellingLabel('B', 'flat', 'german')).toBe('H');
    expect(hasTwoSpellings('A#')).toBe(true);
    expect(hasTwoSpellings('B')).toBe(false);
  });
});

describe('card ids', () => {
  it('round-trips every card in the full deck', () => {
    for (const direction of POSITION_DIRECTIONS) {
      for (let s = 0; s < STRING_COUNT; s++) {
        for (let f = 0; f <= MAX_FRET; f++) {
          expect(parseCardId(cardId(direction, s, f))).toEqual({
            direction,
            stringIndex: s,
            fret: f,
            spelling: 'sharp',
            notation: 'international',
          });
        }
      }
    }
  });

  it('round-trips the flat card of a black key', () => {
    expect(parseCardId(cardId('find', 1, 4, 'flat'))).toEqual({
      direction: 'find',
      stringIndex: 1,
      fret: 4,
      spelling: 'flat',
      notation: 'international',
    });
  });

  it('reads a plain id as the sharp, international card, so a stored deck keeps its schedule', () => {
    // `find:1-4` is what the deck held back when one card asked "C♯/D♭" under both spellings and
    // the notation never reached an id at all. It has to go on naming a card that exists, or
    // every schedule earnt on a black key is orphaned.
    expect(cardId('find', 1, 4)).toBe('find:1-4');
    expect(cardId('find', 1, 4, 'flat')).toBe('find:1-4:b');
    expect(parseCardId('find:1-4')?.spelling).toBe('sharp');
    expect(parseCardId('find:1-4')?.notation).toBe('international');
  });

  it('carries the notation as its own suffix, after the spelling', () => {
    expect(cardId('find', 1, 4, 'sharp', 'german')).toBe('find:1-4:de');
    expect(cardId('find', 1, 4, 'flat', 'german')).toBe('find:1-4:b:de');
    expect(parseCardId('find:1-4:b:de')).toEqual({
      direction: 'find',
      stringIndex: 1,
      fret: 4,
      spelling: 'flat',
      notation: 'german',
    });
  });

  it('mints no German card where the two notations agree on the word', () => {
    // A string, fret 3 is C — called C either way, so a second id would be a second schedule for
    // one thing learnt once.
    expect(cardId('find', 1, 3, 'sharp', 'german')).toBe('find:1-3');
    expect(cardId('name', 1, 3, 'sharp', 'german')).toBe('name:1-3');
    expect(parseCardId('find:1-3:de')).toBeNull();
    expect(parseCardId('name:1-3:de')).toBeNull();
    // …and does mint one where they disagree, in either direction.
    expect(cardId('name', 1, 4, 'sharp', 'german')).toBe('name:1-4:de'); // C♯/D♭ vs Cis/Des
    expect(cardId('name', 1, 2, 'sharp', 'german')).toBe('name:1-2:de'); // B vs H
  });

  it('keeps the two directions apart', () => {
    expect(cardId('name', 3, 7)).not.toBe(cardId('find', 3, 7));
  });

  it('returns null for anything else', () => {
    expect(parseCardId('3-7')).toBeNull();
    expect(parseCardId('sing:3-7')).toBeNull();
    expect(parseCardId('name:9-7')).toBeNull();
    expect(parseCardId('')).toBeNull();
  });

  it('returns null for a flat card that could never be minted', () => {
    // A `name` card takes either spelling as its answer, and a natural has only the one.
    expect(parseCardId('name:1-4:b')).toBeNull();
    expect(parseCardId('find:1-3:b')).toBeNull(); // string A, fret 3 — C, a natural
  });

  it('round-trips a pitch card, which is keyed on the pitch and not on a place', () => {
    expect(pitchCardId('pitch', 61)).toBe('pitch:61');
    expect(pitchCardId('pitch', 61, 'flat')).toBe('pitch:61:b');
    expect(parseCardId('pitch:61')).toEqual({
      direction: 'pitch',
      midi: 61,
      spelling: 'sharp',
      notation: 'international',
    });
    expect(parseCardId('pitch:61:b')).toEqual({
      direction: 'pitch',
      midi: 61,
      spelling: 'flat',
      notation: 'international',
    });
  });

  it('splits a pitch card by notation only where the two disagree', () => {
    expect(pitchCardId('pitch', 61, 'sharp', 'german')).toBe('pitch:61:de'); // C♯4 / Cis4
    expect(pitchCardId('pitch', 60, 'sharp', 'german')).toBe('pitch:60'); // C4 either way
    expect(parseCardId('pitch:60:de')).toBeNull();
    expect(parseCardId('pitch:61:de')?.notation).toBe('german');
  });

  it('splits a pitch card by spelling only where there are two names', () => {
    expect(parseCardId('pitch:60:b')).toBeNull(); // C4 is a natural
    expect(parseCardId('pitch:71:b')).toBeNull(); // B4
  });

  it('returns null for a pitch id that could never be minted', () => {
    expect(parseCardId('pitch:200')).toBeNull(); // outside MIDI
    expect(parseCardId('pitch:2-5')).toBeNull(); // a position where a pitch belongs
    expect(parseCardId('pitch:')).toBeNull();
  });

  it('tells a card about a place from a card about a pitch', () => {
    expect(isPositionKey(parseCardId('find:1-4')!)).toBe(true);
    expect(isPositionKey(parseCardId('pitch:61')!)).toBe(false);
    expect(isPositionKey(parseCardId('allNote:4')!)).toBe(false);
    expect(isPositionKey(parseCardId('allPitch:61')!)).toBe(false);
  });

  it('round-trips an `allPitch` card, keyed on the pitch its `pitch` twin is keyed on', () => {
    expect(pitchCardId('allPitch', 61)).toBe('allPitch:61');
    expect(pitchCardId('allPitch', 61, 'flat')).toBe('allPitch:61:b');
    expect(pitchCardId('allPitch', 61, 'sharp', 'german')).toBe('allPitch:61:de');
    expect(parseCardId('allPitch:61:b')).toEqual({
      direction: 'allPitch',
      midi: 61,
      spelling: 'flat',
      notation: 'international',
    });
    // The same pitch, a different question — and therefore a different schedule.
    expect(pitchCardId('allPitch', 61)).not.toBe(pitchCardId('pitch', 61));
  });

  it('round-trips an `allNote` card, which is keyed on the pitch class', () => {
    expect(noteCardId('E')).toBe('allNote:4');
    expect(noteCardId('C#')).toBe('allNote:1');
    expect(noteCardId('C#', 'flat')).toBe('allNote:1:b');
    expect(noteCardId('C#', 'sharp', 'german')).toBe('allNote:1:de');
    expect(parseCardId('allNote:1:b:de')).toEqual({
      direction: 'allNote',
      note: 'C#',
      spelling: 'flat',
      notation: 'german',
    });
  });

  it('returns null for an `allNote` id that could never be minted', () => {
    expect(parseCardId('allNote:12')).toBeNull(); // there are twelve, indexed from zero
    expect(parseCardId('allNote:4:b')).toBeNull(); // E has one name
    expect(parseCardId('allNote:0:de')).toBeNull(); // C is C in both notations
    expect(parseCardId('allNote:')).toBeNull();
    expect(parseCardId('allNote:2-5')).toBeNull();
  });

  it('tells the cards that want every place from the ones that want one', () => {
    expect(asksEveryPlace(parseCardId('allNote:4')!)).toBe(true);
    expect(asksEveryPlace(parseCardId('allPitch:52')!)).toBe(true);
    expect(asksEveryPlace(parseCardId('pitch:52')!)).toBe(false);
    expect(asksEveryPlace(parseCardId('find:1-4')!)).toBe(false);
    expect(asksEveryPlace(parseCardId('name:1-4')!)).toBe(false);
  });

  it('names the pitch class a card is about, however the card is keyed', () => {
    expect(cardNote(parseCardId('name:1-0')!)).toBe('A');
    expect(cardNote(parseCardId('find:1-4')!)).toBe('C#');
    expect(cardNote(parseCardId('pitch:52')!)).toBe('E');
    expect(cardNote(parseCardId('allPitch:52')!)).toBe('E');
    expect(cardNote(parseCardId('allNote:4')!)).toBe('E');
  });

  it('labels a select-all card as the pitch or the class it asks for', () => {
    // `allPitch` carries the octave, exactly as `pitch` does; `allNote` has none to carry.
    expect(cardNoteLabel(parseCardId('allPitch:52')!)).toBe('E3');
    expect(cardNoteLabel(parseCardId('allNote:1')!)).toBe('C♯');
    expect(cardNoteLabel(parseCardId('allNote:1:b')!)).toBe('D♭');
    expect(cardNoteLabel(parseCardId('allNote:1:de')!)).toBe('Cis');
    expect(cardNoteLabel(parseCardId('allNote:1:b:de')!)).toBe('Des');
  });
});

describe('positionsOfNote', () => {
  it('finds the class on every string, every twelve frets', () => {
    // E over the whole neck: both open E strings and their twelfth frets, plus the seventh fret
    // of the A string, the second of the D and the fifth of the B.
    expect(positionsOfNote('E', ALL_STRINGS, MAX_FRET)).toEqual([
      { stringIndex: 0, fret: 0 },
      { stringIndex: 0, fret: 12 },
      { stringIndex: 1, fret: 7 },
      { stringIndex: 2, fret: 2 },
      { stringIndex: 3, fret: 9 },
      { stringIndex: 4, fret: 5 },
      { stringIndex: 5, fret: 0 },
      { stringIndex: 5, fret: 12 },
    ]);
  });

  it('is bounded by the scope, like every other answer here', () => {
    expect(positionsOfNote('E', [0, 1], 5)).toEqual([{ stringIndex: 0, fret: 0 }]);
    expect(positionsOfNote('E', [1], 12)).toEqual([{ stringIndex: 1, fret: 7 }]);
  });
});

describe('notesInScope', () => {
  it('is all twelve as soon as the scope can sound them', () => {
    expect(notesInScope(ALL_STRINGS, MAX_FRET)).toHaveLength(12);
    // Four frets on one string is four pitch classes and no more.
    expect(notesInScope([0], 3)).toEqual(['E', 'F', 'F#', 'G']);
  });
});

describe('positionsAnswering', () => {
  it('gives a `find` card its own string and nothing else', () => {
    // C on the A string: the third fret, and the fifteenth is off a twelve-fret neck.
    expect(positionsAnswering(parseCardId('find:1-3')!, ALL_STRINGS, MAX_FRET)).toEqual([
      { stringIndex: 1, fret: 3 },
    ]);
  });

  it('gives a `pitch` card every string that reaches the pitch', () => {
    // E3 lies under three fingers: the twelfth fret of the low E, the seventh of the A and the
    // second of the D.
    expect(positionsAnswering(parseCardId('pitch:52')!, ALL_STRINGS, MAX_FRET)).toEqual([
      { stringIndex: 0, fret: 12 },
      { stringIndex: 1, fret: 7 },
      { stringIndex: 2, fret: 2 },
    ]);
  });

  it('gives an `allPitch` card the same set — the difference is what is asked of it', () => {
    expect(positionsAnswering(parseCardId('allPitch:52')!, ALL_STRINGS, MAX_FRET)).toEqual(
      positionsAnswering(parseCardId('pitch:52')!, ALL_STRINGS, MAX_FRET)
    );
  });

  it('gives an `allNote` card the whole class, octaves and all', () => {
    expect(positionsAnswering(parseCardId('allNote:4')!, ALL_STRINGS, MAX_FRET)).toHaveLength(8);
  });

  it('gives a `name` card nothing: it is not answered on the neck', () => {
    expect(positionsAnswering(parseCardId('name:1-3')!, ALL_STRINGS, MAX_FRET)).toEqual([]);
  });
});

describe('midiLabel', () => {
  it('carries the octave, in sounding pitch', () => {
    // The open low E sounds E2 and the twelfth fret of the high e sounds E5 — what a tuner shows,
    // an octave below where a guitar is written.
    expect(midiLabel(40, 'sharp', 'international')).toBe('E2');
    expect(midiLabel(64, 'sharp', 'international')).toBe('E4');
    expect(midiLabel(76, 'sharp', 'international')).toBe('E5');
    expect(midiLabel(60, 'sharp', 'international')).toBe('C4');
  });

  it('names both spellings of a black key in the same octave', () => {
    expect(midiLabel(61, 'sharp', 'international')).toBe('C♯4');
    expect(midiLabel(61, 'flat', 'international')).toBe('D♭4');
    expect(midiLabel(70, 'sharp', 'international')).toBe('A♯4');
    expect(midiLabel(70, 'flat', 'international')).toBe('B♭4');
  });

  it('follows the notation', () => {
    expect(midiLabel(70, 'flat', 'german')).toBe('B4');
    expect(midiLabel(70, 'sharp', 'german')).toBe('Ais4');
    expect(midiLabel(71, 'sharp', 'german')).toBe('H4');
    expect(midiLabel(61, 'sharp', 'german')).toBe('Cis4');
  });
});

describe('positionsSounding', () => {
  it('finds every place one pitch lies under', () => {
    // E4 — the open high e, and the same note further down two other strings.
    expect(positionsSounding(64, ALL_STRINGS, 12)).toEqual([
      { stringIndex: 3, fret: 9 },
      { stringIndex: 4, fret: 5 },
      { stringIndex: 5, fret: 0 },
    ]);
  });

  it('does not confuse a pitch with its octave, the way a pitch class would', () => {
    // `fretsSounding` counts the open low E and its twelfth fret as one answer; these are two
    // different pitches and only one of them is E2.
    expect(fretsSounding(0, 'E', 12)).toEqual([0, 12]);
    expect(positionsSounding(40, [0], 12)).toEqual([{ stringIndex: 0, fret: 0 }]);
    expect(positionsSounding(52, [0], 12)).toEqual([{ stringIndex: 0, fret: 12 }]);
  });

  it('stays inside the strings and frets it was given', () => {
    expect(positionsSounding(64, [5], 12)).toEqual([{ stringIndex: 5, fret: 0 }]);
    expect(positionsSounding(64, ALL_STRINGS, 3)).toEqual([{ stringIndex: 5, fret: 0 }]);
    expect(positionsSounding(39, ALL_STRINGS, 12)).toEqual([]); // below the low E
  });
});

describe('midisInScope', () => {
  it('is every distinct pitch the scope can sound, once each', () => {
    const midis = midisInScope(ALL_STRINGS, 12);
    // E2 to E5 without a gap: the strings overlap, and a pitch is one card however many places
    // on the neck play it.
    expect(midis[0]).toBe(40);
    expect(midis[midis.length - 1]).toBe(76);
    expect(midis).toHaveLength(37);
    expect(new Set(midis).size).toBe(midis.length);
  });

  it('shrinks with the scope', () => {
    expect(midisInScope([0], 3)).toEqual([40, 41, 42, 43]);
    expect(midisInScope([], 12)).toEqual([]);
  });
});

describe('cardNoteLabel', () => {
  const find = (
    fret: number,
    spelling: 'sharp' | 'flat',
    notation: 'international' | 'german' = 'international'
  ) => parseCardId(cardId('find', 1, fret, spelling, notation))!;

  it('names a find card under the one spelling it asks', () => {
    expect(cardNoteLabel(find(4, 'sharp'))).toBe('C♯');
    expect(cardNoteLabel(find(4, 'flat'))).toBe('D♭');
  });

  it('names a name card under both, because either answer is right', () => {
    expect(cardNoteLabel(parseCardId('name:1-4')!)).toBe('C♯/D♭');
    expect(cardNoteLabel(parseCardId('name:1-4:de')!)).toBe('Cis/Des');
  });

  it('follows the notation the card asks in, not one it is handed', () => {
    expect(cardNoteLabel(find(1, 'flat', 'german'))).toBe('B');
    expect(cardNoteLabel(find(1, 'sharp', 'german'))).toBe('Ais');
    expect(cardNoteLabel(find(1, 'sharp'))).toBe('A♯');
  });
});

describe('hasTwoNotations and cardNotation', () => {
  it('is two cards exactly where the two notations print different words', () => {
    expect(hasTwoNotations(parseCardId('find:1-4')!)).toBe(true); // C♯ / Cis
    expect(hasTwoNotations(parseCardId('find:1-2')!)).toBe(true); // B / H
    expect(hasTwoNotations(parseCardId('find:1-3')!)).toBe(false); // C / C
    expect(hasTwoNotations(parseCardId('name:1-3')!)).toBe(false);
    expect(hasTwoNotations(parseCardId('pitch:60')!)).toBe(false); // C4 / C4
  });

  it('draws a card in its own notation, and borrows the display one when it has none', () => {
    expect(cardNotation(parseCardId('find:1-4')!, 'german')).toBe('international');
    expect(cardNotation(parseCardId('find:1-4:de')!, 'international')).toBe('german');
    // Nothing to insist on: the whole card would read the same either way, so the sitting keeps
    // whichever notation it is otherwise showing rather than flipping on the naturals.
    expect(cardNotation(parseCardId('find:1-3')!, 'german')).toBe('german');
    expect(cardNotation(parseCardId('find:1-3')!, 'international')).toBe('international');
  });
});

describe('displayNotation', () => {
  it('prefers German whenever it is in the deck at all', () => {
    expect(displayNotation(['international'])).toBe('international');
    expect(displayNotation(['german'])).toBe('german');
    expect(displayNotation(['international', 'german'])).toBe('german');
  });
});

describe('fretsSounding', () => {
  it('finds the one place a note sits on a string', () => {
    expect(fretsSounding(0, 'A', 12)).toEqual([5]);
    expect(fretsSounding(2, 'A', 12)).toEqual([7]);
  });

  it('counts the open string and its octave as the same answer', () => {
    // Marking the twelfth fret wrong for a card written at the nut would teach something false.
    expect(fretsSounding(0, 'E', 12)).toEqual([0, 12]);
    expect(fretsSounding(4, 'B', 12)).toEqual([0, 12]);
  });

  it('stays inside the scope it was given', () => {
    expect(fretsSounding(0, 'E', 5)).toEqual([0]);
    expect(fretsSounding(0, 'A', 4)).toEqual([]);
  });
});
