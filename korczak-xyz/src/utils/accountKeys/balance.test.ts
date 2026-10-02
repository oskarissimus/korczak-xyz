import { describe, expect, it } from 'vitest';

import {
  parseDeepSeekBalance,
  parseElevenLabsSubscription,
  parseOpenAiCosts,
  spentSince,
  startOfUtcMonth,
} from './balance';

describe('parseDeepSeekBalance', () => {
  it('reads the documented shape, amounts as strings', () => {
    expect(
      parseDeepSeekBalance({
        is_available: true,
        balance_infos: [
          { currency: 'USD', total_balance: '4.20', granted_balance: '0.00', topped_up_balance: '4.20' },
        ],
      }),
    ).toEqual({
      available: true,
      balances: [{ currency: 'USD', total: 4.2, granted: 0, toppedUp: 4.2 }],
    });
  });

  it('is empty rather than a throw on anything else', () => {
    expect(parseDeepSeekBalance(null)).toEqual({ available: false, balances: [] });
  });
});

describe('parseElevenLabsSubscription', () => {
  it('reads characters used, the limit and the reset', () => {
    expect(
      parseElevenLabsSubscription({
        tier: 'starter',
        character_count: 12000,
        character_limit: 30000,
        next_character_count_reset_unix: 1760000000,
      }),
    ).toEqual({ tier: 'starter', used: 12000, limit: 30000, resetAt: 1760000000000 });
  });
});

describe('OpenAI costs', () => {
  const page = {
    data: [
      { start_time: 1790812800, results: [{ amount: { value: 1.25 } }, { amount: { value: 0.5 } }] },
      { start_time: 1790899200, results: [] },
      { start_time: 1790985600, results: [{ amount: { value: 2 } }] },
    ],
    has_more: true,
    next_page: 'page_2',
  };

  it('sums each day’s results and hands back the next page', () => {
    const { days, nextPage } = parseOpenAiCosts(page);
    expect(days).toEqual([
      { start: 1790812800, usd: 1.75 },
      { start: 1790899200, usd: 0 },
      { start: 1790985600, usd: 2 },
    ]);
    expect(nextPage).toBe('page_2');
  });

  it('counts whole UTC days from the one a time falls in', () => {
    const { days } = parseOpenAiCosts(page);
    // 2 Oct 2026, mid-afternoon: that whole day counts, the day before does not.
    expect(spentSince(days, Date.UTC(2026, 9, 2, 15, 0))).toBe(2);
    expect(spentSince(days, Date.UTC(2026, 9, 3, 15, 0))).toBe(2);
    expect(spentSince(days, Date.UTC(2026, 9, 4))).toBe(0);
    expect(spentSince(days, startOfUtcMonth(Date.UTC(2026, 9, 20)))).toBe(3.75);
  });
});
