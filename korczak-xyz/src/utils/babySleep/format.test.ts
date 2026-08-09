import { describe, expect, it } from 'vitest';

import {
  authorLabel,
  formatClock,
  formatHm,
  formatRunning,
  formatSpread,
  fromDateTimeInputs,
  toDateInputValue,
  toTimeInputValue,
} from './format';

describe('formatHm', () => {
  it('drops the hours below one', () => {
    expect(formatHm(0)).toBe('0m');
    expect(formatHm(45 * 60_000)).toBe('45m');
  });

  it('pads the minutes so a column of figures lines up', () => {
    expect(formatHm(65 * 60_000)).toBe('1h 05m');
    expect(formatHm(60 * 60_000)).toBe('1h 00m');
  });

  it('handles a long night and more than a day', () => {
    expect(formatHm(11 * 3_600_000 + 20 * 60_000)).toBe('11h 20m');
    expect(formatHm(26 * 3_600_000)).toBe('26h 00m');
  });

  it('rounds to the nearest minute rather than showing seconds', () => {
    expect(formatHm(59_000)).toBe('1m');
    expect(formatHm(29_000)).toBe('0m');
  });

  it('never shows a negative duration', () => {
    expect(formatHm(-5000)).toBe('0m');
  });
});

describe('formatSpread', () => {
  it('is always signed', () => {
    expect(formatSpread(38 * 60_000)).toBe('±38m');
    expect(formatSpread(65 * 60_000)).toBe('±1h 05m');
  });
});

describe('formatClock', () => {
  it('pads both halves', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9 * 60 + 5)).toBe('09:05');
    expect(formatClock(21 * 60 + 30)).toBe('21:30');
  });

  it('wraps, so an unwrapped chart value still reads as a clock', () => {
    expect(formatClock(1440)).toBe('00:00');
    expect(formatClock(-10)).toBe('23:50');
    expect(formatClock(1450)).toBe('00:10');
  });

  it('rounds to the minute', () => {
    expect(formatClock(20 * 60 + 29.6)).toBe('20:30');
  });
});

describe('formatRunning', () => {
  it('shows the seconds, which are the part that moves', () => {
    expect(formatRunning(7 * 60_000 + 12_000)).toBe('0:07:12');
    expect(formatRunning(3_600_000 + 23 * 60_000 + 45_000)).toBe('1:23:45');
    expect(formatRunning(0)).toBe('0:00:00');
  });
});

describe('date and time inputs', () => {
  const at = new Date(2026, 1, 3, 9, 5, 0, 0).getTime();

  it('round-trips an instant through the two fields', () => {
    const date = toDateInputValue(at);
    const time = toTimeInputValue(at);
    expect(date).toBe('2026-02-03');
    expect(time).toBe('09:05');
    expect(fromDateTimeInputs(date, time)).toBe(at);
  });

  it('reads a time with seconds, which some browsers add', () => {
    expect(fromDateTimeInputs('2026-02-03', '09:05:00')).toBe(at);
  });

  it('rejects an incomplete or malformed pair', () => {
    expect(fromDateTimeInputs('', '09:05')).toBeNull();
    expect(fromDateTimeInputs('2026-02-03', '')).toBeNull();
    expect(fromDateTimeInputs('not-a-date', '09:05')).toBeNull();
    expect(fromDateTimeInputs('2026-02-03', 'noon')).toBeNull();
  });

  it('rejects a date that does not exist rather than rolling it into next month', () => {
    expect(fromDateTimeInputs('2026-02-31', '09:05')).toBeNull();
    expect(fromDateTimeInputs('2026-13-01', '09:05')).toBeNull();
    expect(fromDateTimeInputs('2026-02-03', '25:00')).toBeNull();
  });

  it('accepts a leap day that does exist', () => {
    expect(fromDateTimeInputs('2024-02-29', '00:00')).toBe(new Date(2024, 1, 29).getTime());
  });
});

describe('authorLabel', () => {
  it('drops the domain, which is noise between two people who know the accounts', () => {
    expect(authorLabel('gowecla@gmail.com')).toBe('gowecla');
    expect(authorLabel('oskar.jan.korczak@gmail.com')).toBe('oskar.jan.korczak');
  });

  it('does not truncate — fitting the row is CSS’s job', () => {
    // A label cut to a fixed width cuts differently in every address, and an ellipsis mid-name
    // reads as a different person.
    const long = 'a'.repeat(60);
    expect(authorLabel(`${long}@gmail.com`)).toBe(long);
  });

  it('is empty for an absent author, so a caller can test the result', () => {
    expect(authorLabel(undefined)).toBe('');
    expect(authorLabel('')).toBe('');
  });

  it('passes through something that is not an address rather than dropping it', () => {
    expect(authorLabel('ola')).toBe('ola');
  });
});
