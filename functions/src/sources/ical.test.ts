import { describe, expect, it } from 'vitest';
import { firstUrl, parseIcal, parseIcalDate, unfold } from './ical';

describe('unfold', () => {
  it('rejoins RFC 5545 continuation lines', () => {
    // THE iCal parsing bug: a line beginning with a space continues the previous one. Miss it and
    // every long SUMMARY is silently truncated at 75 octets, which looks like the feed having
    // short titles rather than like the parser being wrong.
    const folded = 'SUMMARY:A very long conference name that ex\n ceeds the line limit';
    expect(unfold(folded)).toEqual(['SUMMARY:A very long conference name that exceeds the line limit']);
  });

  it('handles a tab continuation and CRLF', () => {
    expect(unfold('SUMMARY:ab\r\n\tcd')).toEqual(['SUMMARY:abcd']);
  });

  it('does not eat a leading space on the first line', () => {
    expect(unfold(' orphan')).toEqual([' orphan']);
  });
});

describe('parseIcalDate', () => {
  it('reads an all-day date', () => {
    const parsed = parseIcalDate('20261122', 'VALUE=DATE');
    expect(parsed.allDay).toBe(true);
    expect(new Date(parsed.at!).toISOString()).toBe('2026-11-22T00:00:00.000Z');
  });

  it('reads a UTC timestamp', () => {
    const parsed = parseIcalDate('20261122T190000Z', '');
    expect(parsed.allDay).toBe(false);
    expect(new Date(parsed.at!).toISOString()).toBe('2026-11-22T19:00:00.000Z');
  });

  it('does not mistake VALUE=DATE-TIME for an all-day event', () => {
    expect(parseIcalDate('20261122T190000Z', 'VALUE=DATE-TIME').allDay).toBe(false);
  });

  it('returns null rather than a wrong date for junk', () => {
    expect(parseIcalDate('not-a-date', '').at).toBeNull();
  });
});

describe('parseIcal', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:abc123@google.com',
    'SUMMARY:PyCon PL 2026',
    'DTSTART;VALUE=DATE:20261015',
    'DTEND;VALUE=DATE:20261018',
    'LOCATION:Hotel Ossa\\, Rawa Mazowiecka\\, Poland',
    'DESCRIPTION:See https://pl.pycon.org/2026/ for details',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:no-summary@x',
    'DTSTART;VALUE=DATE:20261015',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('extracts the fields we use', () => {
    const [event] = parseIcal(ics);
    expect(event.uid).toBe('abc123@google.com');
    expect(event.summary).toBe('PyCon PL 2026');
    expect(event.allDay).toBe(true);
    expect(event.location).toBe('Hotel Ossa, Rawa Mazowiecka, Poland');
  });

  it('skips an event with no summary rather than emitting a blank row', () => {
    expect(parseIcal(ics)).toHaveLength(1);
  });

  it('survives a truncated feed', () => {
    expect(() => parseIcal('BEGIN:VEVENT\r\nUID:x')).not.toThrow();
    expect(parseIcal('BEGIN:VEVENT\r\nUID:x')).toEqual([]);
  });

  it('unescapes commas and semicolons the way the spec escapes them', () => {
    const [event] = parseIcal(
      'BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Kraków\\, Poland\r\nEND:VEVENT',
    );
    expect(event.summary).toBe('Kraków, Poland');
  });
});

describe('firstUrl', () => {
  it('digs a link out of a description', () => {
    expect(firstUrl('See https://pl.pycon.org/2026/ for details')).toBe('https://pl.pycon.org/2026/');
  });

  it('is undefined when there is none', () => {
    expect(firstUrl('no link here')).toBeUndefined();
    expect(firstUrl(undefined)).toBeUndefined();
  });
});
