import { describe, expect, it } from 'vitest';
import { analyseSongs, libraryTonics, songChords, songsFor } from './library';
import type { SongSource } from './library';

function song(title: string, body: string): SongSource {
  return { title, author: 'someone', slug: title.toLowerCase().replace(/\s+/g, '-'), body };
}

/** A three-chord song in G, written the way the songbook writes them. */
const wish = song(
  'Wish You Were Here',
  [
    'G          C',
    'So, so you think you can tell',
    'C                 G',
    'Heaven from hell?',
    'D             C          G',
    'Blue skies from pain',
  ].join('\n')
);

/** A minor one, with the raised seventh the charts actually play. */
const mury = song(
  'Mury',
  ['   e     H7        e', '1. On natchniony i młody był,', '  a              e', 'A mury runą'].join(
    '\n'
  )
);

describe('songChords', () => {
  it('reads chord lines and leaves the lyrics alone', () => {
    expect(songChords(wish.body).map((c) => `${c.pc}${c.minor ? 'm' : ''}`).sort()).toEqual([
      '0',
      '2',
      '7',
    ]);
  });

  it('reads the songbook’s lowercase minors and its H', () => {
    const chords = songChords(mury.body);
    expect(chords).toContainEqual({ pc: 4, minor: true }); // e
    expect(chords).toContainEqual({ pc: 9, minor: true }); // a
    expect(chords).toContainEqual({ pc: 11, minor: false }); // H7 — B natural, major
  });

  it('finds nothing in a song with no chart', () => {
    expect(songChords('just some words\nand some more')).toEqual([]);
  });
});

describe('analyseSongs', () => {
  it('files a three-chord song under the key it is in', () => {
    const index = analyseSongs([wish]);
    expect(songsFor(index, 7, '145').map((s) => s.title)).toEqual(['Wish You Were Here']);
    expect(songsFor(index, 0, '145')).toEqual([]);
  });

  it('files a minor song under the harmonic pattern its dominant belongs to', () => {
    const index = analyseSongs([mury]);
    expect(songsFor(index, 4, 'm14V').map((s) => s.title)).toEqual(['Mury']);
  });

  it('does not file a song under every key it happens to contain a I IV V for', () => {
    // A wide-vocabulary song in C: it contains C F G, and also G C D, but it is in C — nearly all
    // of its chords are C's. Only C should claim it.
    const wide = song('Wide', 'C F G D Am Em Dm\nla la la');
    const index = analyseSongs([wide]);
    expect(songsFor(index, 0, '145').map((s) => s.title)).toEqual(['Wide']);
    expect(songsFor(index, 7, '145')).toEqual([]);
  });

  it('breaks a tie on the chord the song opens with', () => {
    // G C D and C F G both fit this one exactly — every chord is diatonic in both readings, so the
    // share cannot separate them. It opens on G, and songs open on their tonic.
    const index = analyseSongs([song('Opener', 'G C D F Am Em\nla la')]);
    expect(songsFor(index, 7, '145').map((s) => s.title)).toEqual(['Opener']);
    expect(songsFor(index, 0, '145')).toEqual([]);
  });

  it('ignores a song with no chords at all', () => {
    expect(analyseSongs([song('Silent', 'no chart here')])).toEqual({});
  });

  it('sorts the songs under a key, so the index does not depend on file order', () => {
    const other = song('Aaa', wish.body);
    expect(analyseSongs([wish, other])['7:145'].map((s) => s.title)).toEqual([
      'Aaa',
      'Wish You Were Here',
    ]);
  });
});

describe('libraryTonics', () => {
  it('lists the keys the library uses, in order', () => {
    const index = analyseSongs([wish, mury, song('Sto lat', 'C F G\nsto lat')]);
    expect(libraryTonics(index, '145')).toEqual([0, 7]);
    expect(libraryTonics(index, 'm14V')).toEqual([4]);
    expect(libraryTonics(index, '1456')).toEqual([]);
  });
});
