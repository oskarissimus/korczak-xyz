import { describe, expect, it } from 'vitest';

import { usdPerVoiceCredit } from './cost';
import {
  comparableFrom,
  DAY_MS,
  HOUR_MS,
  BadWalletPatch,
  driftRows,
  geminiBillingSql,
  parseGeminiBilling,
  ownSpend,
  parseElevenLabsLeft,
  parseFalBalance,
  parseOpenAiSpent,
  parseWalletPatch,
  walletStanding,
  type WalletReading,
  type WalletsPage,
} from './wallets';
import type { RequestLogEntry } from './requestLog';
import { fundsProviderOf, isProviderFundsError } from './fundsSigns';

const H = 3_600_000;
const now = Date.parse('2026-11-10T12:00:00Z');

function reading(over: Partial<WalletReading>): WalletReading {
  return { id: 'r', provider: 'fal', kind: 'balance', unit: 'usd', amount: 0, at: now, from: null, source: 'manual', note: null, by: null, ...over };
}

describe('what the providers answer', () => {
  it('reads fal’s bare number of dollars', () => {
    expect(parseFalBalance(8.20754251)).toBe(8.20754251);
    expect(parseFalBalance({ balance: 3 })).toBe(3);
    expect(parseFalBalance('x')).toBeNull();
  });

  it('reads ElevenLabs’ credits left', () => {
    expect(parseElevenLabsLeft({ character_count: 21000, character_limit: 121000 })).toBe(100000);
    expect(parseElevenLabsLeft({})).toBeNull();
  });

  it('sums every bucket of OpenAI’s costs', () => {
    const page = { data: [{ results: [{ amount: { value: 0.5 } }, { amount: { value: 0.25 } }] }, { results: [] }], has_more: true, next_page: 'p2' };
    expect(parseOpenAiSpent(page)).toEqual({ usd: 0.75, next: 'p2' });
  });
});

describe('the panel’s patch', () => {
  it('takes a hand-typed spend with its window', () => {
    const p = parseWalletPatch({ reading: { provider: 'google', kind: 'spent', amount: 1.5, at: now, from: now - 24 * H } }, now);
    expect(p.reading).toMatchObject({ provider: 'google', unit: 'usd', from: now - 24 * H, note: null });
  });

  it('refuses what it does not know', () => {
    expect(() => parseWalletPatch({ keys: { google: 'k' } }, now)).toThrow(BadWalletPatch);
    expect(() => parseWalletPatch({ reading: { provider: 'fal', kind: 'balance', unit: 'credits', amount: 1, at: now } }, now)).toThrow(BadWalletPatch);
    expect(() => parseWalletPatch({ reading: { provider: 'fal', kind: 'spent', amount: 1, at: now } }, now)).toThrow(BadWalletPatch);
    expect(() => parseWalletPatch({ reading: { provider: 'fal', kind: 'balance', amount: 1, at: now + H } }, now)).toThrow(BadWalletPatch);
  });
});

function entry(over: Partial<RequestLogEntry>): RequestLogEntry {
  return { id: 'x', at: now, uid: null, payer: 'diesel', provider: 'fal', host: 'h', method: 'POST', path: '/', model: 'm', status: 200, ms: 1, world: null, quest: null, usd: 0.1, source: 'list', basis: '', usdPln: null, fxDate: null, bodies: null, requestBytes: 0, responseBytes: 0, contentType: null, ...over };
}

describe('the drift', () => {
  it('counts only what spends the server’s keys', () => {
    const logged = ownSpend([entry({}), entry({ payer: 'account' }), entry({ reused: true }), entry({ provider: 'audioguide' as never })]);
    expect(logged).toHaveLength(1);
  });

  it('compares the drop between two balances with what the log priced in between', () => {
    const page: Pick<WalletsPage, 'readings' | 'logged' | 'loggingSince'> = {
      readings: [reading({ id: 'b', amount: 7, at: now }), reading({ id: 'a', amount: 8, at: now - 10 * H })],
      logged: [
        { provider: 'fal', at: now - 5 * H, usd: 0.6 },
        { provider: 'fal', at: now - 4 * H, usd: null },
        { provider: 'fal', at: now - 11 * H, usd: 5 },
        { provider: 'google', at: now - 5 * H, usd: 5 },
      ],
      loggingSince: now - 20 * H,
    };
    const [row] = driftRows(page);
    expect(row).toMatchObject({ provider: 'fal', calls: 2, unpriced: 1, topUp: false, beforeLogging: false });
    expect(row.actualUsd).toBeCloseTo(1, 10);
    expect(row.driftUsd).toBeCloseTo(0.4, 10);
  });

  it('calls a rising balance a top-up, not a drift', () => {
    const [row] = driftRows({ readings: [reading({ id: 'a', amount: 1, at: now - H }), reading({ id: 'b', amount: 20, at: now })], logged: [], loggingSince: 0 });
    expect(row).toMatchObject({ topUp: true, driftUsd: null });
  });

  it('prices ElevenLabs credits at the diesel’s rate and flags a window older than the log', () => {
    const rows = driftRows({
      readings: [
        reading({ id: 'a', provider: 'elevenlabs', unit: 'credits', amount: 100_000, at: now - 10 * H }),
        reading({ id: 'b', provider: 'elevenlabs', unit: 'credits', amount: 97_000, at: now }),
        reading({ id: 'c', provider: 'google', kind: 'spent', amount: 2, from: now - 48 * H, at: now }),
      ],
      logged: [{ provider: 'google', at: now - H, usd: 1.5 }],
      loggingSince: now - 5 * H,
    });
    const el = rows.find((r) => r.provider === 'elevenlabs')!;
    expect(el.actualCredits).toBe(3000);
    expect(el.actualUsd).toBeCloseTo(3000 * usdPerVoiceCredit(), 10);
    expect(el.beforeLogging).toBe(true);
    const g = rows.find((r) => r.provider === 'google')!;
    expect(g.driftUsd).toBeCloseTo(0.5, 10);
  });
});

describe('Google’s billing export', () => {
  it('asks for the Gemini API since the start of the window, in dollars, credits included', () => {
    const sql = geminiBillingSql(Date.parse('2026-11-01T00:00:00Z'));
    expect(sql).toContain("'Gemini API', 'Generative Language API'");
    expect(sql).toContain("TIMESTAMP('2026-11-01T00:00:00.000Z')");
    expect(sql).toContain('/ IF(currency_conversion_rate > 0, currency_conversion_rate, 1)');
    expect(sql).toContain('`korczak-rpg.billing_export.gcp_billing_export_v1_*`');
  });

  it('reads the one row BigQuery answers', () => {
    const json = { rows: [{ f: [{ v: '1.25' }, { v: '1762858800000' }, { v: 'korczak-rpg' }, { v: 'PLN' }] }] };
    expect(parseGeminiBilling(json)).toEqual({ usd: 1.25, until: 1762858800000, projects: 'korczak-rpg', currency: 'PLN' });
    expect(parseGeminiBilling({ rows: [{ f: [{ v: null }, { v: null }, { v: null }, { v: null }] }] })).toEqual({ usd: 0, until: null, projects: null, currency: null });
  });
});

describe('comparableFrom', () => {
  const month = Date.UTC(2026, 10, 1);
  const logged = Date.UTC(2026, 10, 10, 9, 22, 16);
  it('starts at the first whole hour after the first logged request', () => {
    expect(comparableFrom(month, logged, HOUR_MS)).toBe(Date.UTC(2026, 10, 10, 10));
  });
  it('and at the first whole day for a provider that counts by the day', () => {
    expect(comparableFrom(month, logged, DAY_MS)).toBe(Date.UTC(2026, 10, 11));
  });
  it('keeps the month once the log reaches back past it', () => {
    expect(comparableFrom(Date.UTC(2026, 11, 1), logged, HOUR_MS)).toBe(Date.UTC(2026, 11, 1));
  });
  it('keeps the month with no log at all, and a log starting on the hour', () => {
    expect(comparableFrom(month, null, HOUR_MS)).toBe(month);
    expect(comparableFrom(month, Date.UTC(2026, 10, 10, 9), HOUR_MS)).toBe(Date.UTC(2026, 10, 10, 9));
  });
});

describe('walletStanding: how much is left, at a glance', () => {
  const now = Date.UTC(2026, 10, 20, 20, 0);
  const reading = (over: Partial<WalletReading>): WalletReading => ({
    id: Math.random().toString(36),
    provider: 'fal',
    kind: 'balance',
    unit: 'usd',
    amount: 10,
    at: now - 3_600_000,
    from: null,
    source: 'manual',
    note: null,
    by: null,
    ...over,
  });

  it('takes a live balance as it is', () => {
    const st = walletStanding({ readings: [], logged: [], loggingSince: 0 }, 'fal', now, [
      { provider: 'fal', kind: 'balance', unit: 'usd', amount: 3.2, at: now, from: null, source: 'api', note: null },
    ]);
    expect(st.basis).toBe('live');
    expect(st.usd).toBeCloseTo(3.2);
    expect(st.level).toBe('low');
  });

  it('takes what the log priced on our keys since the newest balance off it', () => {
    const page = {
      readings: [reading({ amount: 10 })],
      logged: [
        { provider: 'fal' as const, at: now - 7_200_000, usd: 5 }, // before the reading: not taken off
        { provider: 'fal' as const, at: now - 600_000, usd: 4.8 },
        { provider: 'google' as const, at: now - 600_000, usd: 1 },
      ],
      loggingSince: 0,
    };
    const st = walletStanding(page, 'fal', now);
    expect(st.basis).toBe('estimate');
    expect(st.usd).toBeCloseTo(5.2);
    expect(st.loggedUsd).toBeCloseTo(4.8);
    expect(st.level).toBe('ok');
    expect(st.partial).toBe(false);
  });

  it('counts ElevenLabs in credits and dollars both', () => {
    const st = walletStanding({ readings: [reading({ provider: 'elevenlabs', unit: 'credits', amount: 20_000 })], logged: [], loggingSince: 0 }, 'elevenlabs', now);
    expect(st.basis).toBe('read');
    expect(st.credits).toBe(20_000);
    expect(st.usd).toBeCloseTo(20_000 * usdPerVoiceCredit());
    expect(st.level).toBe('low');
  });

  it('says only what was spent where no API gives a balance', () => {
    const st = walletStanding(
      { readings: [reading({ provider: 'openai', kind: 'spent', amount: 1.5, from: now - 86_400_000, source: 'api' })], logged: [], loggingSince: 0 },
      'openai',
      now,
    );
    expect(st.basis).toBe('spent');
    expect(st.level).toBe('unknown');
    expect(walletStanding({ readings: [], logged: [], loggingSince: 0 }, 'google', now).basis).toBe('none');
  });

  it('is empty whatever the figure once a request was refused for money after it', () => {
    const alarm = { provider: 'fal' as const, at: now - 60_000, status: 403, error: 'User is locked. Reason: TOP_UP.', where: 'gateway', count: 2 };
    const st = walletStanding({ readings: [reading({ amount: 50 })], logged: [], loggingSince: 0, alarms: [alarm] }, 'fal', now);
    expect(st.level).toBe('empty');
    expect(st.alarm).toEqual(alarm);
    // An alarm older than the reading (the owner topped up since) does not count.
    const after = walletStanding({ readings: [reading({ amount: 50, at: now - 30_000 })], logged: [], loggingSince: 0, alarms: [alarm] }, 'fal', now);
    expect(after.level).toBe('ok');
    expect(after.alarm).toEqual(alarm);
    // And a day on it is gone from the tile.
    expect(walletStanding({ readings: [reading({ amount: 50 })], logged: [], loggingSince: 0, alarms: [alarm] }, 'fal', now + 86_400_000).alarm).toBeNull();
  });

  it('takes a peek from the panel', () => {
    expect(parseWalletPatch({ check: true, peek: true })).toEqual({ check: true, peek: true });
  });
});

describe('a provider’s empty wallet, told apart from everything else', () => {
  it('reads the provider’s words and never our own gateway’s', () => {
    expect(isProviderFundsError('fal', '403 {"detail":"User is locked. Reason: TOP_UP."}')).toBe(true);
    expect(isProviderFundsError('elevenlabs', '401 {"detail":{"status":"quota_exceeded"}}')).toBe(true);
    expect(isProviderFundsError('google', '429 Your prepayment credits are depleted.')).toBe(true);
    expect(isProviderFundsError('google', '429 You exceeded your current quota, please check your plan and billing details.')).toBe(false);
    expect(isProviderFundsError('fal', '402 rpg-credits (no-diesel)')).toBe(true); // a bare 402 is fal's money
    expect(isProviderFundsError('openai', '402 rpg-credits')).toBe(false);
    expect(fundsProviderOf('deepseek')).toBeNull();
    expect(fundsProviderOf('fal')).toBe('fal');
  });
});
