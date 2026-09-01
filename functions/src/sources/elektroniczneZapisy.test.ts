import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseListing, splitPlace } from './elektroniczneZapisy';
import { RUNNING_LISTINGS } from '../../../korczak-xyz/src/utils/events/sources';

/*
 * A committed fixture of the real listing.
 *
 * The platform is a Bootstrap 3 table that will eventually be rebuilt, and when it is this test is
 * what turns a silently empty running feed into a red build. The page it came from is the one the
 * catalogue names, so the fixture is parsed with that page's own tags and country rather than with
 * a stand-in — the row's `tags` are the seeded interest's entire filter, and a page that stopped
 * stamping them would empty the feed without any of these assertions noticing.
 */
const html = readFileSync(
  new URL('./fixtures/elektroniczne-zapisy-bieg.html', import.meta.url),
  'utf8',
);
const page = RUNNING_LISTINGS[0];
const events = parseListing(html, page);

describe('parseListing', () => {
  it('finds the races', () => {
    expect(events.length).toBeGreaterThanOrEqual(10);
  });

  it('reads a title, a day and the town, with the town taken off the title', () => {
    const maraton = events.find((e) => e.title === '48. Maraton Warszawski');
    expect(maraton).toBeDefined();
    expect(maraton!.city).toBe('Warszawa');
    expect(maraton!.url).toBe('https://elektronicznezapisy.pl/event/15822/strona.html');
    // 27 September 2026, no time given, so 10:00 Warsaw — summer time, which is 08:00 UTC.
    expect(new Date(maraton!.startsAt!).toISOString()).toBe('2026-09-27T08:00:00.000Z');
  });

  it('uses the hour when the row gives one', () => {
    const rolnika = events.find((e) => e.title.startsWith('XVII Bieg Rolnika'))!;
    // 19 September 2026 10:00 Warsaw. The mobile span beside the title says the same thing here,
    // but it pads a dateless row out to 00:00 — which is why the desktop cell is what is read.
    expect(new Date(rolnika.startsAt!).toISOString()).toBe('2026-09-19T08:00:00.000Z');
    expect(rolnika.dateText).toBe('2026-09-19 10:00');
  });

  it('keys every race on the platform’s numeric id, never on its name', () => {
    // A race renamed for its sponsor — and they are, every year — must not become a second
    // document that is announced all over again.
    for (const event of events) expect(event.sourceKey).toMatch(/^\d+$/);
    expect(events.find((e) => e.title === '48. Maraton Warszawski')!.sourceKey).toBe('15822');
  });

  it('links the entry form separately, which is what makes an onsale transition possible', () => {
    const maraton = events.find((e) => e.title === '48. Maraton Warszawski')!;
    expect(maraton.ticketUrl).toBe('https://elektronicznezapisy.pl/event/15822/signup.html');
    expect(maraton.ticketUrl).not.toBe(maraton.url);
  });

  it('stamps the page’s tags and country on every row, which is the whole filter', () => {
    for (const event of events) {
      expect(event.tags).toEqual(['running']);
      expect(event.country).toBe('PL');
    }
  });

  it('reads the town per row rather than from the page, the listing being national', () => {
    const cities = new Set(events.map((e) => e.city));
    expect(cities.has('Warszawa')).toBe(true);
    expect(cities.size).toBeGreaterThan(1);
  });

  it('ignores the header row and anything without a race link', () => {
    expect(events.every((e) => e.title && e.title !== 'Nazwa')).toBe(true);
  });
});

describe('splitPlace', () => {
  it('splits the town off the quoted name', () => {
    expect(splitPlace('Warszawa, "48. Maraton Warszawski"')).toEqual({
      city: 'Warszawa',
      title: '48. Maraton Warszawski',
    });
  });

  it('keeps a place whose own name has a comma in it', () => {
    // `Kurejwa, gm. Grajewo` is one village. Split on the first comma it becomes `Kurejwa`, which
    // is a city option the picker shows once and nothing else ever lands in.
    expect(splitPlace('Kurejwa, gm. Grajewo, "XVII Bieg Rolnika"')).toEqual({
      city: 'Kurejwa, gm. Grajewo',
      title: 'XVII Bieg Rolnika',
    });
  });

  it('keeps the whole string as a title when the shape is not there', () => {
    // Better an unplaced race than a dropped one: the city is one axis, and losing the row loses
    // every other.
    expect(splitPlace('Bieg bez miasta')).toEqual({ title: 'Bieg bez miasta' });
  });
});
