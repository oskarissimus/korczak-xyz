#!/usr/bin/env node
/**
 * Converts a wywrota.pl song page to the korczak-xyz song markdown format.
 * Usage: node scripts/wywrota-to-song.mjs <url>
 *
 * Requires @playwright/test or playwright to be installed globally or in the project.
 * Alternatively, run inside an existing playwright session.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Builds the chord annotation line that sits above a lyrics line */
function buildChordLine(chords) {
  if (chords.length === 0) return null;

  let result = '';
  let cursor = 0;

  for (const { pos, chord } of chords) {
    if (pos > cursor) {
      result += ' '.repeat(pos - cursor);
      cursor = pos;
    } else if (pos < cursor) {
      // Chord overlaps previous one — add a single space separator
      result += ' ';
      cursor = result.length;
    }
    result += chord;
    cursor = result.length;
  }

  return result;
}

/** Converts extracted line data to the plaintext chord+lyrics block */
function convertToPlaintext(lines) {
  const out = [];
  let firstVerse = true;

  for (const { lyrics, chords } of lines) {
    const isNewVerse = /^\d+\./.test(lyrics);

    if (isNewVerse) {
      if (!firstVerse) out.push('');
      firstVerse = false;
    }

    const chordLine = buildChordLine(chords);
    if (chordLine) out.push(chordLine);
    out.push(lyrics);
  }

  return out.join('\n');
}

/** Extracts song data from a loaded playwright page */
async function extractSongData(page) {
  return page.evaluate(() => {
    function processNode(node, chords, currentLen) {
      let text = '';
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.textContent;
        } else if (child.nodeName === 'CODE' && child.classList.contains('an')) {
          chords.push({ pos: currentLen + text.length, chord: child.dataset.chord });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          text += processNode(child, chords, currentLen + text.length);
        }
      }
      return text;
    }

    const container = document.querySelector('.interpretation-content');
    if (!container) throw new Error('Could not find .interpretation-content');

    const spans = container.querySelectorAll('span.annotated-lyrics');
    const lines = [];
    for (const span of spans) {
      const chords = [];
      const lyrics = processNode(span, chords, 0);
      lines.push({ lyrics, chords });
    }

    const titleEl = document.querySelector('h1 strong');
    const artistEl = document.querySelector('h1');
    const title = titleEl?.textContent?.trim() ?? '';
    const artistRaw = artistEl?.textContent?.replace(title, '').trim() ?? '';

    return { lines, title, artist: artistRaw };
  });
}

/** Slugifies a string */
function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/wywrota-to-song.mjs <wywrota-url>');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const { lines, title, artist } = await extractSongData(page);
  await browser.close();

  const slug = slugify(title);
  const today = new Date().toISOString().split('T')[0];
  const plaintext = convertToPlaintext(lines);

  const markdown = `---
title: ${title}
slug: ${slug}
author: ${artist}
published: true
language: pl
dateAdded: ${today}
---
\`\`\`plaintext
${plaintext}
\`\`\`
`;

  const outPath = join(__dirname, '..', 'korczak-xyz', 'src', 'content', 'songs', 'pl', `${title.toLowerCase()}.md`);
  writeFileSync(outPath, markdown, 'utf8');
  console.log(`Written to: ${outPath}`);
  console.log('\n--- Preview ---\n');
  console.log(markdown);
}

main().catch(e => { console.error(e); process.exit(1); });
