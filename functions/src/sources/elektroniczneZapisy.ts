/*
 * Road races, from elektronicznezapisy.pl's discipline listings.
 *
 * The app had no way to answer "what am I able to run in Warsaw this autumn". Ticketmaster does not
 * sell races, and a race is not repertoire — the organisers publish, but each one publishes on its
 * own WordPress, so the RSS route would have meant a line in `FEEDS` per club and still no dates.
 * A **registration platform** is the one place a race is a row: it exists to be signed up to, so
 * the listing carries a stable numeric id, a day, a place and a link that becomes the entry form.
 *
 *     <tr class="even">
 *       <td>68.</td>
 *       <td><a href="event/15822/strona.html">Warszawa, "48. Maraton Warszawski"</a>…</td>
 *       <td class="hidden-xs text-nowrap">2026-09-27</td>
 *       …
 *       <td><a href="event/15822/signup.html" class="btn btn-primary btn-xs">Zapisz się</a></td>
 *     </tr>
 *
 * Two things about that row are worth naming.
 *
 * **The city is inside the title**, as `Miasto, "Nazwa"` — which is why this adapter splits it out
 * rather than stamping one on from the page the way the RSS feeds do. It is the same fact the
 * platform's own city dropdown filters on, and reading it per row is what lets the collector take
 * the national listing while `Interest.cities` and the feed's city picker decide what is Warsaw.
 * Narrowing the *fetch* to `?city_id=12` was the other option and is the wrong one: it would bake
 * one reader's preference into a corpus every account shares, and the day the question became
 * "what about Kraków" there would be nothing stored to answer it with.
 *
 * **`signup.html` is a second page, not the listing itself.** That is what makes an `onsale`
 * transition real here where it can never be for Ticketmaster: a race is announced with its date
 * long before entries open, and the button appearing is the event. A row that already has one on
 * the run it is first seen announces rather than going on sale — `mergeRecord` handles that — so
 * the notice only ever fires for a form that opened while we were watching.
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import { fetchText } from './types';
import { stripTags, warsawEpoch } from './html';
import {
  ELEKTRONICZNE_ZAPISY_HOST as HOST,
  RUNNING_LISTINGS,
  type SourcePage,
} from '../../../korczak-xyz/src/utils/events/sources';

/** One row of the listing table. */
const ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/g;

/**
 * When a row gives a day and no time.
 *
 * Races start in the morning; a midnight default would file every dateless-time race on the
 * evening before in a reader's head, and `soon` counts calendar days anyway. The source's own
 * string is kept in `dateText` regardless, so the card never claims a precision the page did not.
 */
const DEFAULT_START_HOUR = 10;

/**
 * `Warszawa, "48. Maraton Warszawski"` -> the two halves.
 *
 * Greedy on the left because a place can carry a comma of its own — `Kurejwa, gm. Grajewo` is one
 * village, and splitting on the first comma would file it under `Kurejwa` while the picker's other
 * rows say the whole thing. Returns the raw text as the title when the shape is not there at all,
 * which is better than dropping a race over its punctuation.
 */
export function splitPlace(text: string): { city?: string; title: string } {
  const match = /^([^"]+),\s*"(.+)"$/.exec(text.trim());
  if (!match) return { title: text.trim() };
  return { city: match[1].trim(), title: match[2].trim() };
}

/**
 * Pulls the races out of one discipline listing.
 *
 * Exported and pure so `elektroniczneZapisy.test.ts` can run it against a committed fixture. This
 * is a bootstrap table on a platform that will eventually be rebuilt; the fixture is what turns
 * that into a red build rather than a source that quietly returns nothing.
 */
export function parseListing(html: string, page: SourcePage): RawEvent[] {
  const out: RawEvent[] = [];

  for (const match of html.matchAll(ROW)) {
    const row = match[1];

    const link = /<a[^>]+href="(?:\/)?event\/(\d+)\/strona\.html"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    if (!link) continue;
    const [, id, rawTitle] = link;

    const { city, title } = splitPlace(stripTags(rawTitle));
    if (!title) continue;

    /*
     * The desktop date cell, which is a day and sometimes an hour. Deliberately not the mobile
     * `<span>` beside the title: that one pads every day out to `00:00`, so reading it would
     * invent a midnight start for every race the platform has only a date for.
     */
    const when = /<td[^>]*class="[^"]*text-nowrap[^"]*"[^>]*>\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}):(\d{2}))?\s*<\/td>/.exec(
      row,
    );
    const day = when?.[1] ?? null;
    const time = when?.[2] !== undefined ? `${when[2]}:${when[3]}` : undefined;
    // `warsawEpoch` resolves the zone offset for that particular day, which is the part a constant
    // gets wrong twice a year; the minutes are then plain arithmetic on an instant.
    const startsAt =
      day === null
        ? null
        : addMinutes(
            warsawEpoch(day, time ? Number(time.slice(0, 2)) : DEFAULT_START_HOUR),
            time ? Number(time.slice(3, 5)) : 0,
          );

    const signup = /<a[^>]+href="(?:\/)?(event\/\d+\/signup\.html)"/.exec(row)?.[1];

    out.push({
      // The platform's own numeric id. It survives a rename of the race, a change of date and a
      // redesign of everything around it, which is the whole contract `sourceKey` has.
      sourceKey: id,
      title,
      url: `${HOST}/event/${id}/strona.html`,
      startsAt,
      dateText: day ? [day, time].filter(Boolean).join(' ') : undefined,
      city,
      country: page.country,
      tags: page.tags,
      ticketUrl: signup ? `${HOST}/${signup}` : undefined,
    });
  }

  return out;
}

function addMinutes(at: number | null, minutes: number): number | null {
  return at === null ? null : at + minutes * 60000;
}

export const elektroniczneZapisy: EventSource = {
  id: 'elektroniczne-zapisy',
  label: 'Elektroniczne Zapisy – biegi',
  async fetchEvents(ctx: SourceContext): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    let reached = 0;
    const failures: string[] = [];

    for (const page of RUNNING_LISTINGS) {
      try {
        out.push(...parseListing(await fetchText(ctx, page.url), page));
        reached += 1;
      } catch (e) {
        failures.push(`${page.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // One discipline page moving is not the platform being gone, and the ultras alone are nine
    // rows against the road races' hundred-odd. Every page unreachable is the real failure.
    if (reached === 0) throw new Error(failures.join('; ') || 'no listings configured');

    /*
     * A race entered in two disciplines — a cross that is also an ultra — is two rows on two pages
     * and one event. They mint the same id, so `runCollection` would collapse them anyway; doing
     * it here keeps this adapter's own count honest, which is what the health row reports.
     */
    const byKey = new Map(out.map((event) => [event.sourceKey, event]));
    return [...byKey.values()];
  },
};
