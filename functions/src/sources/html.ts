/*
 * Just enough HTML handling for a scrape. Pure, and tested.
 *
 * Regexes rather than a DOM parser: the alternative is a dependency in a deploy bundle for three
 * functions' worth of extraction, and the pages here are stable enough markup that a narrow regex
 * is honest about how fragile it is. When one of these breaks it should break loudly, against a
 * committed fixture, rather than quietly returning nothing.
 */

/** Text content of a fragment, with tags dropped and entities resolved. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  oacute: 'ó', Oacute: 'Ó', eacute: 'é', Eacute: 'É', hellip: '…',
  mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[name] ?? whole);
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** Every match of a tag pair, inner HTML only. */
export function matchAll(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((m) => m[1] ?? '');
}

const PL_MONTHS: Record<string, number> = {
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6,
  lipca: 7, sierpnia: 8, wrzesnia: 9, pazdziernika: 10, listopada: 11, grudnia: 12,
  // The nominative forms, in case a page writes a bare month.
  styczen: 1, luty: 2, marzec: 3, kwiecien: 4, maj: 5, czerwiec: 6,
  lipiec: 7, sierpien: 8, wrzesien: 9, pazdziernik: 10, listopad: 11, grudzien: 12,
};

/**
 * A Polish long-form date — "22 listopada 2026" — as `YYYY-MM-DD`.
 *
 * The month is genitive on a real date ("listopada", not "listopad"), which is why both forms are
 * in the table. Diacritics are folded before the lookup so `października` and `pazdziernika` are
 * one key; ł does not decompose under NFD, hence the explicit replace.
 *
 * Returns null rather than guessing: an unparseable date becomes `dateText` on the event and is
 * printed as the theatre wrote it, which is better than a wrong day.
 */
export function parsePolishDate(text: string): string | null {
  const folded = text
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const match = folded.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!match) return null;
  const month = PL_MONTHS[match[2]];
  if (!month) return null;
  const day = Number(match[1]);
  if (day < 1 || day > 31) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** When a sale announcement names a day but no hour. Box offices open in the morning. */
export const SALE_DEFAULT_HOUR = 10;

/**
 * "sprzedaż" in any inflection — the word the whole read hangs on.
 *
 * Deliberately the only way in. "Bilety od 50 zł" and "Od 12 czerwca … zniżki na parking" are both
 * on these pages, and a reader that took any date after "od" would turn a car park discount into a
 * ticket-sale alarm.
 */
const SALE_PHRASE = /sprzeda[zż]\w*/;

/** Folded to the alphabet `parsePolishDate`'s month table is keyed on. */
function foldPolish(text: string): string {
  return text
    .replace(/\u0142/g, 'l')
    .replace(/\u0141/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * A sale-opening moment stated in prose, as `{ day, hour }` — or null when the text is not about
 * a sale opening at all.
 *
 * This exists because the sentence Teatr Wielki publishes is "Sprzedaż biletów od 1 września,
 * g. 11.00", and **there is no year in it**. `parsePolishDate` requires one and rightly refuses to
 * guess; here the guess is safe and has to be made, because a year-less date is what the source
 * actually says. The article's own publication day settles it: a sale is announced before it
 * opens, so the answer is the next occurrence of that day and month at or after publication, which
 * rolls a December announcement of a January sale into the following year without special-casing
 * the turn of the year.
 *
 * Three things it must not do, each a way of inventing a deadline that does not exist:
 *
 *   - **It requires the sale wording.** The same news list carries "Od 12 czerwca 2026 roku nasi
 *     Widzowie mogą korzystać z 30% zniżki na parking" — a date, after "od", about a car park. A
 *     bare date-after-"od" reader would file that as a ticket sale and warn about it.
 *   - **It reads the date that follows the sale wording**, not the first date on the row. A teaser
 *     may mention a premiere before it mentions the sale.
 *   - **It returns null rather than a default** when the day or month will not parse. An
 *     unparseable date becomes prose on the card, which is what `dateText` is for; a wrong one
 *     becomes a notification on the wrong morning.
 *
 * The hour matters and is read where given: a sale opening at 11.00 is not a sale opening at
 * midnight, and the reminder says which. Absent, `SALE_DEFAULT_HOUR` stands in.
 */
export function parseSaleAnnouncement(
  text: string,
  publishedDay: string | null,
): { day: string; hour: number } | null {
  const folded = foldPolish(text);
  const phrase = SALE_PHRASE.exec(folded);
  if (!phrase) return null;

  // Only what comes after the word "sprzedaż" — see the second rule above.
  const tail = folded.slice(phrase.index);
  const date = /\bod\s+(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/.exec(tail);
  if (!date) return null;

  const month = PL_MONTHS[date[2]];
  if (!month) return null;
  const dayOfMonth = Number(date[1]);
  if (dayOfMonth < 1 || dayOfMonth > 31) return null;

  const year = date[3] ? Number(date[3]) : yearFor(dayOfMonth, month, publishedDay);
  if (year === null) return null;

  const day = `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  // A calendar the source got wrong (31 lutego) must not become the 3rd of March.
  if (!isRealDay(day)) return null;

  return { day, hour: hourIn(tail) };
}

/**
 * The year a year-less date means, given the day the article was published.
 *
 * The publication year, unless that puts the sale before the announcement — which is what a
 * December announcement of a January sale does, and is the only case where the naive answer is
 * wrong. Without a publication date there is nothing to reason from and this refuses.
 */
function yearFor(day: number, month: number, publishedDay: string | null): number | null {
  if (!publishedDay || !/^\d{4}-\d{2}-\d{2}$/.test(publishedDay)) return null;
  const year = Number(publishedDay.slice(0, 4));
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return candidate >= publishedDay ? year : year + 1;
}

/** "g. 11.00", "godz. 11:00", "od godziny 9" — the hour, or the default. */
function hourIn(text: string): number {
  const match = /\bg(?:odz(?:in[ay])?)?\.?\s*(\d{1,2})(?:[.:]\d{2})?/.exec(text);
  if (!match) return SALE_DEFAULT_HOUR;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : SALE_DEFAULT_HOUR;
}

/** Whether `YYYY-MM-DD` is a day that exists — 31 listopada is a typo, not a date. */
export function isRealDay(day: string): boolean {
  const [y, m, d] = day.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * A `YYYY-MM-DD` as an epoch, at a given local hour in Warsaw.
 *
 * Poland observes DST, so the offset is looked up for that date rather than assumed: a fixed +01:00
 * puts every summer curtain an hour out, and a fixed +02:00 does the same all winter.
 */
export function warsawEpoch(day: string, hour = 19): number | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parsed) return null;
  const naive = Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]), hour, 0, 0);
  // Two passes: the offset depends on the instant, and the instant depends on the offset.
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    guess = naive - offsetAt(guess);
  }
  return guess;
}

function offsetAt(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instant;
}
