import { describe, expect, it } from 'vitest';

import { creditSeconds, formatPlay, lastDays, playtimeOf, summarize, windowsOf, type AdminAccount } from './playtime';

const NOW = Date.UTC(2026, 10, 24, 10, 0, 0); // 24 Nov 2026, 11:00 in Warsaw

describe('creditSeconds', () => {
  it('takes what a report asks, up to two minutes', () => {
    expect(creditSeconds(60, null, NOW)).toBe(60);
    expect(creditSeconds(500, null, NOW)).toBe(120);
    expect(creditSeconds(-4, null, NOW)).toBe(0);
    expect(creditSeconds('60', null, NOW)).toBe(0);
    expect(creditSeconds(Number.NaN, null, NOW)).toBe(0);
  });
  it('never more than the time since the last report, so two tabs count wall time once', () => {
    expect(creditSeconds(60, NOW - 20_000, NOW)).toBe(25);
    expect(creditSeconds(60, NOW - 90_000, NOW)).toBe(60);
  });
});

describe('the windows', () => {
  it('lists Warsaw days back across a month end', () => {
    expect(lastDays('2026-12-02', 4)).toEqual(['2026-12-02', '2026-12-01', '2026-11-30', '2026-11-29']);
  });
  it('sums today, 7 and 30 days, and keeps the total', () => {
    const p = playtimeOf({
      total: 10_000,
      days: {
        '2026-11-24': 60,
        '2026-11-20': 100,
        '2026-11-01': 1000,
        '2026-10-01': 5,
        junk: 9,
      },
      lastAt: NOW,
    });
    expect(windowsOf(p, NOW)).toEqual({
      today: 60,
      d7: 160,
      d30: 1160,
      all: 10_000,
    });
  });
  it('reads a missing document as nothing', () => {
    expect(windowsOf(playtimeOf(undefined), NOW)).toEqual({
      today: 0,
      d7: 0,
      d30: 0,
      all: 0,
    });
  });
});

describe('summarize', () => {
  const account = (createdAt: number | null, play: AdminAccount['play']): AdminAccount => ({
    uid: String(Math.random()),
    email: null,
    createdAt,
    lastSignInAt: null,
    admin: false,
    disabled: false,
    balanceUsd: null,
    play,
    lastPlayedAt: null,
  });
  it('counts new accounts, players and time per window', () => {
    const t = summarize(
      [
        account(NOW - 3_600_000, { today: 60, d7: 60, d30: 60, all: 60 }),
        account(NOW - 3 * 86_400_000, { today: 0, d7: 30, d30: 30, all: 30 }),
        account(NOW - 60 * 86_400_000, { today: 0, d7: 0, d30: 0, all: 0 }),
      ],
      NOW,
    );
    expect(t.accounts).toBe(3);
    expect(t.created).toEqual({ today: 1, d7: 2, d30: 2, all: 3 });
    expect(t.active).toEqual({ today: 1, d7: 2, d30: 2, all: 2 });
    expect(t.seconds).toEqual({ today: 60, d7: 90, d30: 90, all: 90 });
  });
});

describe('formatPlay', () => {
  it('says time the way a person reads it', () => {
    expect(formatPlay(0)).toBe('—');
    expect(formatPlay(40)).toBe('40 s');
    expect(formatPlay(240)).toBe('4 min');
    expect(formatPlay(7500)).toBe('2 h 05 min');
  });
});
