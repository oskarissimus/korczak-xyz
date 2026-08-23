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
