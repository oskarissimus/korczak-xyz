/*
 * Which of these progressions actually turn up in the songbook, and in which songs.
 *
 * The point of anchoring the deck to the library is that "I IV V in G" is an abstraction until it
 * is *Wish You Were Here*. So every card that has a song behind it says so — after the answer,
 * never before it, because on a `key` card the title would hand over the answer.
 *
 * It is also a scope: `Settings.keys = 'songbook'` narrows the deck to the keys these songs are
 * written in, which is seven of the twelve and the ones a guitar is happiest in.
 *
 * The chord lines are read through the songbook's own grammar — `isChordLine` and `parseChord`
 * from `src/utils/chords.ts` — rather than a second regex here, because a parser that drifted from
 * the one the song pages use would quietly disagree with them about what a song contains.
 *
 * This runs at **build time**, in the page, over `getCollection('songs')`. Not a generated file:
 * one committed with the song texts is one that can fall out of step with them, and the analysis
 * is a few milliseconds over 40 songs.
 */

import { isChordLine, parseChord } from '../chords';
import type { PatternId, PitchClass } from './theory';
import { PATTERN_IDS, chordsOf, isDiatonic, keyOf, mod12 } from './theory';

export interface SongRef {
  title: string;
  author: string;
  /** Where the song lives, so the verdict can link to it. */
  slug: string;
}

export interface SongSource extends SongRef {
  /** The song's raw body — chord lines and lyrics, as written. */
  body: string;
}

/**
 * Songs by `${tonic}:${pattern}`.
 *
 * A plain record rather than a Map because it crosses from the Astro page into the React island
 * as a prop, and a Map does not survive that.
 */
export type LibraryIndex = Record<string, SongRef[]>;

export function libraryKey(tonic: PitchClass, pattern: PatternId): string {
  return `${mod12(tonic)}:${pattern}`;
}

interface SongChord {
  pc: PitchClass;
  minor: boolean;
}

/** Every distinct chord a song plays, as pitch class and quality, in the order first played. */
export function songChords(body: string): SongChord[] {
  const seen = new Map<string, SongChord>();
  for (const line of body.split('\n')) {
    if (!isChordLine(line)) continue;
    for (const token of line.trim().split(/\s+/)) {
      const parsed = parseChord(token);
      if (!parsed) continue;
      const chord = { pc: parsed.pitchClass, minor: parsed.minor };
      const id = `${chord.pc}:${chord.minor}`;
      if (!seen.has(id)) seen.set(id, chord);
    }
  }
  return [...seen.values()];
}

/**
 * How much of a song sits inside a given key — the share of its distinct chords that are diatonic.
 *
 * This is what stops a song with a wide chord vocabulary being filed under every key it happens to
 * contain a I, a IV and a V for. *Here Comes the Sun* has enough chords to contain I IV V in four
 * different keys; only one of them is the key it is in, and it is the one nearly all of its chords
 * belong to.
 */
function diatonicShare(chords: SongChord[], tonic: PitchClass, pattern: PatternId): number {
  if (chords.length === 0) return 0;
  const key = keyOf(tonic, pattern);
  const inside = chords.filter((c) => isDiatonic(key, c.pc, c.minor)).length;
  return inside / chords.length;
}

function contains(chords: SongChord[], tonic: PitchClass, pattern: PatternId): boolean {
  return chordsOf(tonic, pattern).every((wanted) =>
    chords.some((c) => c.pc === wanted.pc && c.minor === (wanted.quality === 'minor'))
  );
}

/**
 * Index the library.
 *
 * A song is filed under (tonic, pattern) when it plays all of that pattern's chords **and** no
 * other candidate key fits it better. Two filters, in this order:
 *
 *   1. **Diatonic share.** How much of the song sits inside the key. This is what settles most of
 *      it, and it is why a wide-vocabulary song is not filed under every key it happens to contain
 *      a I, a IV and a V for.
 *   2. **The first chord.** Among keys that fit equally well, the one the song *opens on* — songs
 *      overwhelmingly start on their tonic, and a tie means the harmony alone cannot tell the
 *      readings apart. Applied only when some candidate matches, so it can break a tie and never
 *      empty the list.
 *
 * A tie surviving both is kept as a tie: a song that genuinely sits equally well in two readings is
 * a fact about the song, not a decision this function should be making up.
 */
export function analyseSongs(songs: SongSource[]): LibraryIndex {
  const index: LibraryIndex = {};

  for (const song of songs) {
    const chords = songChords(song.body);
    if (chords.length === 0) continue;

    const candidates: { tonic: PitchClass; pattern: PatternId; share: number }[] = [];
    for (const pattern of PATTERN_IDS) {
      for (let tonic = 0; tonic < 12; tonic++) {
        if (!contains(chords, tonic, pattern)) continue;
        candidates.push({ tonic, pattern, share: diatonicShare(chords, tonic, pattern) });
      }
    }
    if (candidates.length === 0) continue;

    const best = Math.max(...candidates.map((c) => c.share));
    let kept = candidates.filter((c) => c.share >= best);

    const opening = chords[0].pc;
    const opens = kept.filter((c) => c.tonic === opening);
    if (opens.length > 0) kept = opens;

    for (const candidate of kept) {
      const key = libraryKey(candidate.tonic, candidate.pattern);
      (index[key] ??= []).push({ title: song.title, author: song.author, slug: song.slug });
    }
  }

  for (const songs of Object.values(index)) {
    songs.sort((a, b) => a.title.localeCompare(b.title));
  }
  return index;
}

/** The songs behind one key and pattern, if any. */
export function songsFor(
  index: LibraryIndex,
  tonic: PitchClass,
  pattern: PatternId
): SongRef[] {
  return index[libraryKey(tonic, pattern)] ?? [];
}

/**
 * Which tonics the library uses for a pattern — the `songbook` scope.
 *
 * Sorted, so `scopeIds` stays a stable enumeration whichever order the index was built in.
 */
export function libraryTonics(index: LibraryIndex, pattern: PatternId): PitchClass[] {
  const tonics: PitchClass[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    if (songsFor(index, tonic, pattern).length > 0) tonics.push(tonic);
  }
  return tonics;
}
