import { describe, expect, it } from 'vitest';
import {
  answerChords,
  answerLength,
  cardId,
  cardLabels,
  canonicalNotation,
  displayNotation,
  parseCardId,
  promptChords,
  subjectOf,
} from './cards';
import type { CardKey } from './cards';
import { NOTATIONS } from './theory';
import type { Notation } from './theory';

const polish: Notation = 'polish';
const german: Notation = 'german';
const intl: Notation = 'international';

describe('card ids', () => {
  it('names the three directions', () => {
    expect(
      cardId({ direction: 'transpose', from: 9, to: 0, pattern: '145', notation: polish })
    ).toBe('transpose:9-0:145');
    expect(cardId({ direction: 'degrees', tonic: 9, pattern: '145', notation: polish })).toBe(
      'degrees:9:145'
    );
    expect(cardId({ direction: 'key', tonic: 9, pattern: '145', notation: polish })).toBe(
      'key:9:145'
    );
  });

  it('round-trips every card the deck can hold, under every notation', () => {
    for (const notation of NOTATIONS) {
      for (const pattern of ['145', '1456', 'm145', 'm14V'] as const) {
        for (let tonic = 0; tonic < 12; tonic++) {
          const keys: CardKey[] = [
            { direction: 'degrees', tonic, pattern, notation },
            { direction: 'key', tonic, pattern, notation },
            { direction: 'transpose', from: tonic, to: (tonic + 5) % 12, pattern, notation },
          ];
          for (const key of keys) {
            const id = cardId(key);
            expect(parseCardId(id), id).toEqual({ ...key, notation: canonicalNotation(key) });
          }
        }
      }
    }
  });
});

describe('a card splits only where its own words differ', () => {
  it('is one card when every system prints the same words', () => {
    // C F G is C F G everywhere, so there is one schedule and not three.
    const ids = NOTATIONS.map((notation) =>
      cardId({ direction: 'degrees', tonic: 0, pattern: '145', notation })
    );
    expect(new Set(ids)).toEqual(new Set(['degrees:0:145']));
  });

  it('is two cards when only the international system differs', () => {
    // F B C in a Polish chart, F Bb C in an English one — and the German syllables leave B alone,
    // so `polish` and `german` collapse into the unsuffixed card.
    const ids = NOTATIONS.map((notation) =>
      cardId({ direction: 'degrees', tonic: 5, pattern: '145', notation })
    );
    expect(new Set(ids)).toEqual(new Set(['degrees:5:145', 'degrees:5:145:in']));
    expect(cardId({ direction: 'degrees', tonic: 5, pattern: '145', notation: german })).toBe(
      'degrees:5:145'
    );
  });

  it('is three cards when all three systems disagree', () => {
    // A D E and the vi: `f#`, `fis`, `F#m`.
    const ids = NOTATIONS.map((notation) =>
      cardId({ direction: 'degrees', tonic: 9, pattern: '1456', notation })
    );
    expect(new Set(ids)).toEqual(
      new Set(['degrees:9:1456', 'degrees:9:1456:de', 'degrees:9:1456:in'])
    );
  });

  it('collapses the two H-systems when the only difference would be a black key', () => {
    // D G A h / D G A h / D G A Bm — no black key printed, so German has nothing to add.
    const ids = NOTATIONS.map((notation) =>
      cardId({ direction: 'degrees', tonic: 2, pattern: '1456', notation })
    );
    expect(new Set(ids)).toEqual(new Set(['degrees:2:1456', 'degrees:2:1456:in']));
  });

  it('reads the source key of a transpose card too, not only the target', () => {
    // C F G into G prints nothing either system disagrees about; into B♭ it does, and so does
    // coming *from* B♭.
    expect(
      cardId({ direction: 'transpose', from: 0, to: 7, pattern: '145', notation: intl })
    ).toBe('transpose:0-7:145');
    expect(
      cardId({ direction: 'transpose', from: 0, to: 10, pattern: '145', notation: intl })
    ).toBe('transpose:0-10:145:in');
    expect(
      cardId({ direction: 'transpose', from: 10, to: 0, pattern: '145', notation: intl })
    ).toBe('transpose:10-0:145:in');
  });

  it('normalises an unused system away rather than storing it', () => {
    expect(
      canonicalNotation({ direction: 'degrees', tonic: 0, pattern: '145', notation: german })
    ).toBe('polish');
    expect(
      canonicalNotation({ direction: 'degrees', tonic: 6, pattern: '145', notation: german })
    ).toBe('german');
  });
});

describe('displayNotation', () => {
  const card: CardKey = {
    direction: 'transpose',
    from: 2,
    to: 8,
    pattern: '145',
    notation: intl,
  };

  it('never labels the pad in a system the player did not select', () => {
    // `D G A → Ab Db Eb` reads the same in Polish and international, so the card is filed as the
    // Polish one whichever was asked for. Drawing the *pad* in that notation put a button saying
    // `B` — which is B flat there — in front of a player who had selected international names, for
    // whom `B` is B natural. That is the exact confusion this axis exists to drill.
    expect(canonicalNotation(card)).toBe('polish');
    expect(displayNotation(card, ['international'])).toBe('international');
    expect(displayNotation(card, ['polish'])).toBe('polish');
  });

  it('always prints the card identically, whichever it picks', () => {
    // The property that makes this safe at all: whatever notation comes back, the words on the
    // card do not move. Checked over every card in the deck and every selection of systems.
    const selections: Notation[][] = [
      ['polish'],
      ['german'],
      ['international'],
      ['polish', 'german'],
      ['german', 'international'],
      [...NOTATIONS],
      [],
    ];
    for (const notation of NOTATIONS) {
      for (const pattern of ['145', '1456', 'm145', 'm14V'] as const) {
        for (let tonic = 0; tonic < 12; tonic++) {
          const minted = parseCardId(
            cardId({ direction: 'degrees', tonic, pattern, notation })
          )!;
          for (const available of selections) {
            const shown = displayNotation(minted, available);
            expect(cardLabels(minted, shown), `${minted.direction}:${tonic}:${pattern} → ${shown}`)
              .toEqual(cardLabels(minted, canonicalNotation(minted)));
          }
        }
      }
    }
  });

  it('prefers the card’s own system when the player has it, over the first in the list', () => {
    // A card that genuinely needs German syllables must be drawn in them even when another
    // notation comes first in the settings.
    const german3: CardKey = { direction: 'degrees', tonic: 9, pattern: '1456', notation: german };
    expect(canonicalNotation(german3)).toBe('german');
    expect(displayNotation(german3, ['polish', 'german'])).toBe('german');
  });

  it('falls back to the card’s own words when the setting has since been turned off', () => {
    // Never to the selection: that would print `As Des Es` on a card filed as `Ab Db Eb`, which is
    // the first bug with its two halves swapped. Only reachable for a card already out of scope.
    const german3: CardKey = { direction: 'degrees', tonic: 9, pattern: '1456', notation: german };
    expect(displayNotation(german3, ['international'])).toBe('german');
    expect(displayNotation(card, ['german'])).toBe('polish');
    expect(displayNotation(german3, [])).toBe('german');
  });
});

describe('parseCardId refuses what could never have been minted', () => {
  it('refuses a notation suffix on a card that reads the same either way', () => {
    // C F G is C F G under every system. An answer folded into `degrees:0:145:in` would give a
    // second schedule to a question that only exists once.
    expect(parseCardId('degrees:0:145:in')).toBeNull();
    expect(parseCardId('degrees:0:145:de')).toBeNull();
    // F B C is the same in both H-systems, so only the international card carries a suffix.
    expect(parseCardId('degrees:5:145:de')).toBeNull();
    expect(parseCardId('degrees:5:145:in')).not.toBeNull();
  });

  it('refuses a suffix it has never heard of, and a second one', () => {
    expect(parseCardId('degrees:9:1456:xx')).toBeNull();
    expect(parseCardId('degrees:9:1456:de:in')).toBeNull();
  });

  it('refuses a transpose card from a key to itself', () => {
    expect(parseCardId('transpose:3-3:145')).toBeNull();
  });

  it('refuses a direction, pattern or pitch class it has never heard of', () => {
    expect(parseCardId('invert:0:145')).toBeNull();
    expect(parseCardId('degrees:0:ii-V-I')).toBeNull();
    expect(parseCardId('degrees:12:145')).toBeNull();
    expect(parseCardId('degrees:-1:145')).toBeNull();
    expect(parseCardId('degrees:0')).toBeNull();
    expect(parseCardId('')).toBeNull();
  });
});

describe('what a card asks', () => {
  const transpose: CardKey = {
    direction: 'transpose',
    from: 9,
    to: 0,
    pattern: '145',
    notation: polish,
  };

  it('shows the source chords and is answered with the target’s', () => {
    expect(promptChords(transpose).map((c) => c.pc)).toEqual([9, 2, 4]); // A D E
    expect(answerChords(transpose).map((c) => c.pc)).toEqual([0, 5, 7]); // C F G
  });

  it('gives a degrees card nothing to read off the front', () => {
    const degrees: CardKey = { direction: 'degrees', tonic: 9, pattern: '145', notation: polish };
    expect(promptChords(degrees)).toEqual([]);
    expect(answerChords(degrees).map((c) => c.pc)).toEqual([9, 2, 4]);
  });

  it('budgets the answer time per tap the card asks for', () => {
    expect(answerLength(transpose, false)).toBe(3);
    expect(answerLength({ ...transpose, pattern: '1456' }, false)).toBe(4);
    const key: CardKey = { direction: 'key', tonic: 9, pattern: '145', notation: polish };
    expect(answerLength(key, false)).toBe(1);
    expect(answerLength(key, true)).toBe(2); // tonic and mode
  });

  it('everything a card prints is in cardLabels', () => {
    expect(cardLabels(transpose, polish)).toEqual(['A', 'D', 'E', 'C', 'C', 'F', 'G']);
  });
});

describe('subjectOf', () => {
  it('files the two ways round of one key together', () => {
    const degrees: CardKey = { direction: 'degrees', tonic: 9, pattern: '145', notation: polish };
    const key: CardKey = { direction: 'key', tonic: 9, pattern: '145', notation: polish };
    expect(subjectOf(degrees)).toBe(subjectOf(key));
  });

  it('files a transpose card under where it lands, not where it started', () => {
    const into: CardKey = {
      direction: 'transpose',
      from: 4,
      to: 9,
      pattern: '145',
      notation: polish,
    };
    const degrees: CardKey = { direction: 'degrees', tonic: 9, pattern: '145', notation: polish };
    expect(subjectOf(into)).toBe(subjectOf(degrees));
  });

  it('keeps a major key and its parallel minor apart', () => {
    const major: CardKey = { direction: 'degrees', tonic: 9, pattern: '145', notation: polish };
    const minor: CardKey = { direction: 'degrees', tonic: 9, pattern: 'm145', notation: polish };
    expect(subjectOf(major)).not.toBe(subjectOf(minor));
  });
});
