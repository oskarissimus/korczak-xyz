/*
 * Teatr Wielki – Opera Narodowa, from the season repertoire pages.
 *
 * This is the source the app was really asked for: "tell me when new repertoire is announced", with
 * a season of lead time on a Figaro or a Salome.
 *
 * The obvious page, `/kalendarium/`, is useless to us — it is a TYPO3 shell whose calendar is drawn
 * by JavaScript, so the HTML contains `data-day` attributes and no events at all. The *season* page
 * is plain server-rendered markup and carries more than the calendar would anyway:
 *
 *     <a href="https://teatrwielki.pl/kalendarium/2026-2027/salome/" class="-layer">
 *       <div class="teaser">
 *         <h2>SALOME</h2>
 *         <p>OPERA</p>
 *         <p>Richard Strauss</p>
 *         <p><strong>Premiera: 22 listopada 2026</strong></p>
 *
 * — a title, a genre, a composer, a premiere date, and a slug that makes a stable id. Note
 * `<h2>COPP<span>É</span>LIA</h2>`: the titles contain inner tags, so they must be stripped rather
 * than read raw.
 *
 * What this cannot give us is individual performance nights; those live behind the JS calendar. That
 * is an acceptable gap — the question is "is Figaro programmed this season", not "which Tuesday".
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import { fetchText } from './types';
import { parsePolishDate, stripTags, warsawEpoch } from './html';

const HOST = 'https://teatrwielki.pl';

/**
 * Which season pages to read.
 *
 * Both the current and the next, because the whole point is catching the announcement — and a new
 * season page appearing *is* the announcement. The URL shape is `/repertuar/sezon-2026/27/`, which
 * is the theatre's own odd split of the year pair.
 */
export function seasonPaths(now: number): string[] {
  const year = new Date(now).getUTCFullYear();
  const month = new Date(now).getUTCMonth() + 1;
  // A season is announced in spring and runs to the following summer, so from about March the
  // interesting pair is this year's; before that, last year's is still current.
  const first = month >= 3 ? year : year - 1;
  return [first, first + 1].map(
    (start) => `${HOST}/repertuar/sezon-${start}/${String((start + 1) % 100).padStart(2, '0')}/`,
  );
}

/** One `<li class="page">…</li>` block per production. */
const BLOCK = /<li class="page">([\s\S]*?)<\/li>/g;

/**
 * Pulls the productions out of one season page.
 *
 * Exported and pure so `teatrWielki.test.ts` can run it against a committed fixture. When the
 * theatre redesigns — and it will — that test is what turns a silent empty feed into a red build.
 */
export function parseSeasonPage(html: string): RawEvent[] {
  const out: RawEvent[] = [];

  for (const match of html.matchAll(BLOCK)) {
    const block = match[1];

    const href = /<a[^>]+href="([^"]+)"/.exec(block)?.[1];
    // Inner tags: COPP<span>É</span>LIA.
    const title = stripTags(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? '');
    if (!href || !title) continue;

    /*
     * A production, and not one of the education tiles the season page also carries.
     *
     * Two of the sixty-four blocks link outside /kalendarium/ — "PRÓBY OTWARTE" (open rehearsals)
     * and "WYCIECZKI PO TEATRZE" (guided tours). They are things the house does, not things it has
     * programmed, and they were previously kept with a key synthesised from the season page's own
     * URL: `teatr-wielki_https-teatrwielki-pl-repertuar-sezon-2026-27-WYCIECZKI-PO-TEATRZE`. That
     * is stable enough not to re-announce, and still wrong — the slug is the theatre's own
     * identifier for a production, so its absence is the signal that this is not one.
     */
    const slug = slugOf(href);
    if (!slug) continue;

    const paragraphs = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((p) => stripTags(p[1]))
      .filter(Boolean);

    // The teaser's paragraphs are, in order: genre, composer/creators, and the premiere line.
    const premiereLine = paragraphs.find((p) => /premiera/i.test(p));
    const rest = paragraphs.filter((p) => p !== premiereLine);
    const genre = rest[0];
    const composer = rest.slice(1).join(' · ') || undefined;

    const day = premiereLine ? parsePolishDate(premiereLine) : null;

    out.push({
      // The slug is the id. It survives a redesign of everything around it, and it is what the
      // theatre itself uses to identify the production.
      sourceKey: slug,
      title,
      subtitle: composer,
      url: href.startsWith('http') ? href : `${HOST}${href}`,
      startsAt: day ? warsawEpoch(day, 19) : null,
      // Kept whatever happens: "Premiera: jesień 2027" is genuinely what the theatre said, and a
      // card with no date at all reads as a bug.
      dateText: premiereLine,
      city: 'Warszawa',
      venue: 'Teatr Wielki – Opera Narodowa',
      tags: tagsFor(genre),
      description: [genre, composer].filter(Boolean).join(' '),
    });
  }

  return out;
}

/** `https://teatrwielki.pl/kalendarium/2026-2027/salome/` -> `2026-2027/salome`. */
export function slugOf(href: string): string | null {
  const match = /\/kalendarium\/([^?#]+)/.exec(href);
  if (!match) return null;
  return match[1].replace(/^\/+|\/+$/g, '') || null;
}

/**
 * The genre line as tags.
 *
 * `opera` is what the seeded Opera Narodowa interest matches on — it has no keywords at all, so
 * this tag is the entire reason that interest works. Ballet gets its own so it can be excluded.
 */
export function tagsFor(genre: string | undefined): string[] {
  const tags = ['theatre', 'teatr-wielki'];
  const value = (genre ?? '').toLowerCase();
  if (value.includes('balet') || value.includes('ballet')) tags.push('ballet');
  else if (value.includes('opera')) tags.push('opera');
  // Anything else — a gala, a recital, a concert — gets neither. It used to fall through to
  // `opera`, which meant the keyword-less Opera Narodowa interest claimed the entire season
  // including the things that are not operas. `teatr-wielki` still marks the house, so an
  // interest that genuinely wants everything from here can ask for that tag instead.
  return tags;
}

export const teatrWielki: EventSource = {
  id: 'teatr-wielki',
  label: 'Teatr Wielki – Opera Narodowa',
  async fetchEvents(ctx: SourceContext): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    const paths = seasonPaths(ctx.now);
    let reached = 0;

    for (const url of paths) {
      let html: string;
      try {
        html = await fetchText(ctx, url);
      } catch {
        // A season page that does not exist yet is the normal case for half the year, not a
        // failure — next season's URL 404s until it is announced, and that announcement is the
        // very thing being watched for.
        continue;
      }
      reached += 1;
      out.push(...parseSeasonPage(html));
    }

    // Every page unreachable is different from "the current season has nothing on", and only the
    // first is worth recording as a broken source.
    if (reached === 0) throw new Error(`no season page reachable (${paths.join(', ')})`);
    return out;
  },
};
