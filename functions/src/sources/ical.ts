/*
 * A minimal iCalendar reader. Pure, and tested against a committed fixture.
 *
 * Deliberately not a library: we want SUMMARY, DTSTART, DTEND, UID, LOCATION and URL out of a
 * public feed, and an RFC 5545 implementation is a dependency in a deploy bundle for six fields.
 */

export interface IcalEvent {
  uid: string;
  summary: string;
  start: number | null;
  end?: number;
  allDay: boolean;
  location?: string;
  url?: string;
  description?: string;
}

/**
 * Undoes RFC 5545 line folding.
 *
 * A line beginning with a space or tab continues the previous one. This is *the* iCal parsing bug:
 * miss it and every long SUMMARY is silently truncated at 75 octets, which looks like the feed
 * having short titles rather than like a parser being wrong.
 */
export function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** `DTSTART;VALUE=DATE:20261122` and `DTSTART:20261122T190000Z` are both dates here. */
export function parseIcalDate(value: string, params: string): { at: number | null; allDay: boolean } {
  const allDay = /VALUE=DATE(?!-TIME)/i.test(params);
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    return { at: Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]), allDay: true };
  }
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!full) return { at: null, allDay };
  const at = Date.UTC(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +full[6]);
  /*
   * A floating time (no Z, no TZID) is "local wherever you are". Treating it as UTC is the least
   * wrong option available without a timezone database: these feeds are worldwide, the events are
   * matched by day rather than by hour, and being a few hours out never changes the day enough to
   * matter for a conference.
   */
  return { at, allDay: false };
}

function unescape(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

export function parseIcal(text: string): IcalEvent[] {
  const out: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;

  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = { allDay: false };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.uid && current.summary) {
        out.push({
          uid: current.uid,
          summary: current.summary,
          start: current.start ?? null,
          end: current.end,
          allDay: current.allDay ?? false,
          location: current.location,
          url: current.url,
          description: current.description,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const split = line.indexOf(':');
    if (split < 0) continue;
    const rawName = line.slice(0, split);
    const value = line.slice(split + 1);
    const semi = rawName.indexOf(';');
    const name = (semi < 0 ? rawName : rawName.slice(0, semi)).toUpperCase();
    const params = semi < 0 ? '' : rawName.slice(semi + 1);

    switch (name) {
      case 'UID':
        current.uid = value.trim();
        break;
      case 'SUMMARY':
        current.summary = unescape(value);
        break;
      case 'LOCATION':
        current.location = unescape(value);
        break;
      case 'URL':
        current.url = value.trim();
        break;
      case 'DESCRIPTION':
        current.description = unescape(value);
        break;
      case 'DTSTART': {
        const parsed = parseIcalDate(value.trim(), params);
        current.start = parsed.at;
        current.allDay = parsed.allDay;
        break;
      }
      case 'DTEND': {
        const parsed = parseIcalDate(value.trim(), params);
        if (parsed.at !== null) current.end = parsed.at;
        break;
      }
    }
  }
  return out;
}

/** The first http(s) URL in a blob of text — how python.org hides a link in DESCRIPTION. */
export function firstUrl(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return /https?:\/\/[^\s<>"]+/.exec(text)?.[0];
}
