import { describe, expect, it } from 'vitest';

import { checklistNight, parseChecklist, serializeChecklist } from './checklist';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

const COUNT = 10;

describe('checklistNight', () => {
  it('files an evening under its own date', () => {
    expect(checklistNight(local(2026, 9, 3, 19, 30))).toBe('2026-09-03');
  });

  it('keeps a routine that ran past midnight on the evening it started in', () => {
    expect(checklistNight(local(2026, 9, 4, 0, 10))).toBe('2026-09-03');
  });

  it('starts a new sheet once the morning is properly under way', () => {
    expect(checklistNight(local(2026, 9, 4, 9, 0))).toBe('2026-09-04');
  });
});

describe('parseChecklist', () => {
  const night = '2026-09-03';

  it('reads back the ticks made tonight', () => {
    const raw = JSON.parse(serializeChecklist(night, [4, 0, 2]));
    expect(parseChecklist(raw, night, COUNT)).toEqual([0, 2, 4]);
  });

  it('reads last night as an empty sheet, not as tonight', () => {
    const raw = JSON.parse(serializeChecklist('2026-09-02', [0, 1, 2]));
    expect(parseChecklist(raw, night, COUNT)).toEqual([]);
  });

  it('drops an index past the end of the list', () => {
    // A shorter sheet must not leave a tick on a row that now means something else.
    expect(parseChecklist({ night, done: [1, 9, 10, 42] }, night, COUNT)).toEqual([1, 9]);
  });

  it('takes anything unreadable as an empty sheet', () => {
    expect(parseChecklist(null, night, COUNT)).toEqual([]);
    expect(parseChecklist('nope', night, COUNT)).toEqual([]);
    expect(parseChecklist({ night }, night, COUNT)).toEqual([]);
    expect(parseChecklist({ night, done: ['1', null, 2.5, -1] }, night, COUNT)).toEqual([]);
  });

  it('survives a duplicated index', () => {
    expect(parseChecklist({ night, done: [3, 3, 1] }, night, COUNT)).toEqual([1, 3]);
  });
});
