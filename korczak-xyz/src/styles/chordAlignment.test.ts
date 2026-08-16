import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The songbook aligns chords over lyrics in *characters*: the chord written at column N of
 * the chord line has to be drawn over the character at column N of the lyric line beneath
 * it. Nothing enforces that but the two lines agreeing on the width of a cell, and they are
 * the same font at the same size — so the only way to break it is to declare something on
 * one line that changes its metrics.
 *
 * `font-weight: bold` was such a thing, and it is the reason this file exists. VT323 is
 * self-hosted at weight 400 only, so bold is synthesised, and WebKit's CoreText backend
 * synthesises it by adding `size / 36` to the advance of every glyph (`FontCoreText.cpp`,
 * `WidthIterator.cpp`). Against VT323's 0.40em cell that is 1/14.4 of a cell per character,
 * whatever the font size: the chord line stretched, and a chord at column 14 drew at 14.97.
 *
 * It could not be caught by rendering the page here. Skia and FreeType embolden by stroking
 * the glyph and leave the advance alone, so Chromium and WebKit-on-Linux both place the
 * chord perfectly; only Safari and the installed songbook showed it. So the guard is on the
 * declaration rather than on the result, and the stylesheet is read as text — the same
 * approach `pwa/tiers.test.ts` takes to facts that no test can reach by running the thing.
 */
const songCss = readFileSync(new URL('./song.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../layouts/Layout.astro', import.meta.url), 'utf8');

/** Every declaration block whose selector list mentions `.chord-line`. */
function chordLineBlocks(): string[] {
  const blocks: string[] = [];
  for (const match of songCss.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const [, selector, body] = match;
    // The selector is whatever follows the previous block; keep only its last line so a
    // preceding comment or at-rule does not drag an unrelated `.chord-line` mention in.
    const lastLine = selector.trim().split('\n').pop()!.trim();
    if (/(^|[\s,])\.[\w.-]*chord-line\b/.test(lastLine)) blocks.push(body);
  }
  return blocks;
}

/** Strip comments, then read a property's declared values out of a block. */
function declared(body: string, property: string): string[] {
  return [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g')
  )].map(m => m[1].replace(/!important/, '').trim());
}

describe('chord-over-lyric alignment', () => {
  it('finds the .chord-line rules it is meant to be guarding', () => {
    expect(chordLineBlocks().length).toBeGreaterThan(0);
  });

  it('never asks for a weight VT323 does not ship', () => {
    for (const body of chordLineBlocks()) {
      for (const value of declared(body, 'font-weight')) {
        // `bold`, `bolder` and anything >= 500 all resolve to a face we do not have, and
        // Safari pays for the substitute in advance width. Only 400 is really there.
        expect(
          /^(normal|400)$/.test(value),
          `.chord-line declares font-weight: ${value} — VT323 ships weight 400 only, so ` +
          `this is synthesised, and CoreText widens every glyph by size/36 to do it. ` +
          `The chord line then measures wider than the lyrics under it and the chords ` +
          `drift right, one character per 14.4. Embolden with paint (text-shadow, ` +
          `-webkit-text-stroke) instead — those do not touch the advance.`
        ).toBe(true);
      }
    }
  });

  it('never changes the size of the chord line\'s cell', () => {
    // The lyric line takes its metrics from `.blog_post pre code`. Anything here that
    // resizes or re-spaces the chord line's characters breaks the same alignment by a
    // different route, and would be just as invisible in the engines available locally.
    for (const body of chordLineBlocks()) {
      for (const property of ['font-family', 'font-size', 'font-stretch', 'letter-spacing',
                              'word-spacing', 'transform', 'zoom']) {
        expect(
          declared(body, property),
          `.chord-line must not declare ${property}: it is positioned in character cells ` +
          `and has to keep the lyric line's.`
        ).toEqual([]);
      }
    }
  });

  it('still self-hosts VT323 at exactly one weight, which is what makes bold synthetic', () => {
    // If VT323 ever ships a real bold face the reasoning above changes and the first test
    // should be revisited rather than worked around.
    const weights = [...layout.matchAll(/font-family:\s*'VT323'[\s\S]*?font-weight:\s*(\d+)/g)]
      .map(m => m[1]);
    expect(weights.length).toBeGreaterThan(0);
    expect([...new Set(weights)]).toEqual(['400']);
  });
});
