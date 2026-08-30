---
name: songbook
description: The songbook at /songs - chord lines aligned in characters, and why .chord-line must never be synthetically bold.
paths:
  - "**/content/songs/**"
  - "**/utils/chords.ts"
  - "**/utils/chordDiagram.ts"
  - "**/styles/song.css"
  - "**/styles/chordMarks.css"
  - "**/styles/chordAlignment.test.ts"
  - "**/components/Song*"
  - "**/pages/**/songs/**"
  - "**/SongPostPage.astro"
---

## Songbook

Songs are fenced `plaintext` blocks at `src/content/songs/pl/`, chord line above lyric line,
aligned **in characters**: the chord at column N is drawn over the character at column N below
it. `SongPostPage.astro` re-emits each line verbatim inside `<span class="chord-line">` and lets
`white-space: pre-wrap` in a monospace font do the positioning. Transposition is the only thing
that rewrites a chord line, and `transposeLine` puts every chord back at the column it started
in for exactly this reason.

So nothing may change the chord line's metrics, and `.chord-line` in `song.css` carries the
list. `font-weight: bold` was on it for years and is the trap: we self-host VT323 at weight 400
only, so bold is **synthesised**, and WebKit's CoreText backend synthesises it by adding
`size / 36` to the advance of every glyph (`m_syntheticBoldOffset` in `FontCoreText.cpp`, added
to the advance in `WidthIterator.cpp`). Against VT323's 0.40em cell that is 1/14.4 of a cell per
character — **a ratio independent of font size**, so no size setting escapes it. The chord line
stretched against the lyrics beneath it and a chord at column N drew at column N × 1.069: half a
cell out by column 8, a whole character by column 14, two by column 29. In `Sto psot` the D sits
at column 14 of `Bo koty lubią psoty`, which is the `p` of *psoty*; it drew at 14.97, over the
`s`. Every chord past the first few in the song was wrong, and the further right, the wronger.

It is invisible on anything but an Apple device, which is what makes it worth writing down.
Skia and FreeType embolden by stroking the glyph and leave the advance alone, so Chromium and
WebKit-on-Linux both place the chord exactly — measured at 0.01px — and only Safari and the
installed songbook show the drift. A rendering test here can therefore never catch it.
`src/styles/chordAlignment.test.ts` reads the stylesheet as text instead and guards the
declaration, the way `pwa/tiers.test.ts` guards facts no test can reach by running the thing.

The weight is kept as paint: `text-shadow`, which is what WebKit itself draws for synthetic bold
(the glyph again, offset by `size/36`) minus the part that reaches the layout. Same rule, same
reason, as the boxed marks in `chordMarks.css` — a glyph's ink may overhang, its advance may not.

The side layout (`renderSideLayout`) is exempt from all of this: it strips the positioning
spaces and puts the chords in their own flex column, so `.chord-col` may be bold and is.
