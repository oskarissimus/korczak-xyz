import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PER_MILLION, PRICE_CHANGES, tokenCost, tokenPrice } from './cost';
import { falCost } from './gatewayRoutes';
import { FAL_LISTED, SCORE_MS, grossUsd, priceRows } from './priceList';

describe('the price list', () => {
  it('quotes the provider for every text model the code prices', () => {
    const rows = priceRows();
    for (const [prefix] of PER_MILLION) {
      const row = rows.find((r) => r.model === (prefix === 'gemma-' ? 'gemma-*' : prefix));
      expect(row, prefix).toBeDefined();
      expect(row!.verbatim.join(' '), prefix).not.toContain('—');
    }
  });

  it('lists exactly the fal.ai models falCost prices', () => {
    const source = readFileSync(new URL('./gatewayRoutes.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('export function falCost'), source.indexOf('/** Gemini'));
    const cased = [...block.matchAll(/case '([^']+)':/g)].map((m) => m[1]).sort();
    expect([...FAL_LISTED].sort()).toEqual(cased);
    for (const model of FAL_LISTED) expect(falCost(model, {}), model).not.toBeNull();
  });

  it('prices the score at the length music.ts asks for', () => {
    const music = readFileSync(new URL('./music.ts', import.meta.url), 'utf8');
    expect(Number(/export const MUSIC_MS = ([\d_]+);/.exec(music)![1].replace(/_/g, ''))).toBe(SCORE_MS);
  });

  it('normalises with the same functions a real request is priced by', () => {
    const flash = priceRows().find((r) => r.model === 'gemini-3.8-flash')!;
    expect(flash.usd).toBeCloseTo(tokenCost('gemini-3.8-flash', { input: 8000, output: 1200, thoughts: 800 })!, 10);
    expect(grossUsd(1)).toBeCloseTo(1.23, 10);
  });
});

describe('announced price changes', () => {
  it('apply from their day and not before', () => {
    const before = Date.parse('2026-11-30T23:59:59Z');
    const after = Date.parse('2026-12-01T00:00:00Z');
    expect(tokenPrice('gemini-4-argon', before)).toEqual({ input: 2, output: 10 });
    expect(tokenPrice('gemini-4-argon', after)).toEqual({ input: 4, output: 20 });
    expect(tokenPrice('gemini-3.8-flash', Date.parse('2026-12-31T12:00:00Z'))).toEqual({ input: 0.75, output: 3.75 });
    expect(tokenPrice('gemini-3.8-flash', Date.parse('2027-01-01T00:00:00Z'))).toEqual({ input: 1.5, output: 7.5 });
  });

  it('name a row that exists', () => {
    for (const c of PRICE_CHANGES) expect(PER_MILLION.some(([p]) => p === c.prefix), c.prefix).toBe(true);
  });
});
