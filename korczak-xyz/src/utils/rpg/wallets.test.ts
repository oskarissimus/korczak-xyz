import { describe, expect, it } from 'vitest';

import { USD_PER_VOICE_CREDIT } from './cost';
import {
  BadWalletPatch,
  driftRows,
  geminiBillingSql,
  parseGeminiBilling,
  ownSpend,
  parseElevenLabsLeft,
  parseFalBalance,
  parseOpenAiSpent,
  parseWalletPatch,
  type WalletReading,
  type WalletsPage,
} from './wallets';
import type { RequestLogEntry } from './requestLog';

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
    expect(el.actualUsd).toBeCloseTo(3000 * USD_PER_VOICE_CREDIT, 10);
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
