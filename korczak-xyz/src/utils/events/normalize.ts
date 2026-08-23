/*
 * Turning what a source says into what the matcher reads.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

/**
 * Polish letters NFD does not decompose.
 *
 * Stripping combining marks after NFD handles ą ć ę ń ó ś ź ż — but **ł and Ł are not a base
 * letter plus a mark**, they are their own code points (U+0142, U+0141), so NFD leaves them
 * untouched and the strip never sees them. Miss this and `Bydgoszcz` folds fine while `Michał`,
 * `Wrocław`, `Białystok` and `Łódź` quietly do not, which is the half of the alphabet a Polish
 * events app is made of.
 *
 * German and Nordic sources reach this too (a klezmer festival in Kraków is as likely to be
 * written up in German as in Polish), hence ß/æ/ø/đ.
 */
const ATOMIC: Record<string, string> = {
  ł: 'l', Ł: 'l',
  ß: 'ss',
  æ: 'ae', Æ: 'ae',
  ø: 'o', Ø: 'o',
  å: 'a', Å: 'a',
  đ: 'd', Đ: 'd',
  ð: 'd', Ð: 'd',
  þ: 'th', Þ: 'th',
  œ: 'oe', Œ: 'oe',
};

/**
 * The single normalisation used for every comparison in this app: event text, interest keywords,
 * city names, fingerprints.
 *
 * One function rather than one per call site, because the whole point is that a keyword typed as
 * "Średniowieczny" reaches the same string as a scraped "ŚREDNIOWIECZNY" and a feed-mangled
 * "sredniowieczny". Two implementations that agree today would not agree after the first bug fix.
 */
export function foldText(input: string): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) out += ATOMIC[ch] ?? ch;
  return out
    .normalize('NFD')
    // Combining diacritical marks. Applied after the atomic map so ł is already gone.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A string safe to use as a Firestore document id.
 *
 * Firestore rejects ids containing `/`, ids that are `.` or `..`, ids matching `__.*__`, and
 * anything past 1500 bytes. Truncating to 200 chars of `[A-Za-z0-9_-]` satisfies all four with
 * room to spare, and keeps ids short enough to read in a console.
 */
export function slugKey(input: string): string {
  const cleaned = (input || '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
  // `__x__` is reserved, and an empty or dot-only id is rejected outright.
  if (!cleaned || /^\.+$/.test(cleaned)) return 'x';
  return /^__.*__$/.test(cleaned) ? `x${cleaned}` : cleaned;
}

/**
 * The document id for an event.
 *
 * Derived from the source and the source's own key, and from nothing else. Price, ticket URL,
 * description, availability and scraped "last updated" stamps must never reach this: if any of
 * them moves, the next collector run mints a second document, `firstSeenAt` is fresh, and the
 * event is announced again. That is the bug that gets a push app deleted.
 */
export function eventIdFor(source: string, sourceKey: string): string {
  return `${slugKey(source)}_${slugKey(sourceKey)}`;
}

/**
 * A stable key for a source that offers no id of its own — a scrape, usually.
 *
 * Built from the three things that identify a performance to a human and that a redesign will not
 * change. Not a hash of the whole row, which would change with the price.
 */
export function synthKey(title: string, day: string | null, venue?: string): string {
  return slugKey(`${foldText(title)}-${day ?? 'undated'}-${foldText(venue ?? '')}`).slice(0, 80);
}

/**
 * The cross-source identity. Two documents may share it; that is the point.
 *
 * Punctuation and spacing go entirely, because "Wesele Figara" and "Wesele Figara —" and
 * "Wesele  Figara" are one opera. The day and city stay separate so two different nights of the
 * same production remain two events.
 */
export function fingerprintOf(e: { title: string; day: string | null; city?: string }): string {
  const title = foldText(e.title).replace(/[^a-z0-9]+/g, '');
  return `${title}|${e.day ?? 'undated'}|${foldText(e.city ?? '').replace(/[^a-z0-9]+/g, '')}`;
}

/** `${slugKey(fingerprint)}|${kind}`. The separator is `|` because slugKey emits neither. */
export function noticeIdFor(fingerprint: string, kind: string): string {
  return `${slugKey(fingerprint)}|${kind}`;
}

/** Splits a notice id back apart. `|` cannot appear in the slug half, so this is unambiguous. */
export function parseNoticeId(id: string): { fingerprint: string; kind: string } | null {
  const at = id.lastIndexOf('|');
  if (at <= 0 || at === id.length - 1) return null;
  return { fingerprint: id.slice(0, at), kind: id.slice(at + 1) };
}

const WARSAW = 'Europe/Warsaw';

/**
 * The local calendar day an instant falls on, in Warsaw, as `YYYY-MM-DD`.
 *
 * Via `Intl` rather than an offset constant because Poland observes DST, so a fixed +01:00 puts
 * every summer evening after 23:00 on the wrong day — which for a 20:00 curtain is most of the
 * season. `en-CA` because its short date format *is* ISO.
 */
export function dayKeyOf(at: number, timeZone: string = WARSAW): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/** Whole days from `now` until `at`, by calendar day rather than by elapsed hours. */
export function daysUntil(at: number, now: number, timeZone: string = WARSAW): number {
  const a = Date.parse(`${dayKeyOf(now, timeZone)}T00:00:00Z`);
  const b = Date.parse(`${dayKeyOf(at, timeZone)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * Everything the *keywords* will be matched against, folded into one string.
 *
 * **Tags are deliberately not in here.** They are matched structurally, by `interest.tags`, and
 * folding them into the keyword text makes the two mechanisms one — with the result that any
 * tag a source applies feed-wide becomes a blanket keyword hit for every row it produces. That
 * is not hypothetical: tagging the Jewish Culture Festival's feed `klezmer` made the Klezmer
 * interest match all 67 of its articles, Ted Kaczynski included, because the word was in every
 * haystack. Keywords ask what an event *says*; tags ask what it *is*.
 *
 * The description is capped: a source that pastes a whole press release would otherwise let a
 * keyword match on a word mentioned once in the ninth paragraph, and would bloat every document
 * in a collection the client pulls whole.
 */
export function haystackOf(parts: {
  title: string;
  subtitle?: string;
  venue?: string;
  city?: string;
  description?: string;
}): string {
  return foldText(
    [
      parts.title,
      parts.subtitle ?? '',
      parts.venue ?? '',
      parts.city ?? '',
      (parts.description ?? '').slice(0, 600),
    ].join(' '),
  );
}
