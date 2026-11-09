import { describe, expect, it } from 'vitest';
import { beatLitres, questLitres, CANISTERS, EMPTY_LITRES, formatLitres, lineLitres, litres, plantState, worldLitres } from './diesel';
import { DEMO_MODELS, RPG_DEMO_DEFAULTS } from './demoLimits';

describe('diesel', () => {
  it('is a cent a litre, never below zero', () => {
    expect(litres(RPG_DEMO_DEFAULTS.perIpUsd)).toBe(400);
    expect(litres(-1)).toBe(0);
  });

  it('says whole litres from ten up and one decimal below, in the locale', () => {
    expect(formatLitres(312.4, 'pl')).toBe('312 L');
    expect(formatLitres(4.46, 'pl')).toBe('4,5 L');
    expect(formatLitres(4.46, 'en')).toBe('4.5 L');
    expect(formatLitres(1200, 'en')).toBe('1,200 L');
  });

  it('stops the generator when not even the cheapest paid step fits', () => {
    expect(plantState(EMPTY_LITRES - 0.1)).toBe('stopped');
    expect(plantState(EMPTY_LITRES)).toBe('running');
  });

  it('prices every demo model, a world as more than its quest', () => {
    const all = { voice: true, music: true, fal: true };
    for (const model of DEMO_MODELS) {
      const beat = beatLitres(model);
      expect(beat, model).not.toBeNull();
      expect(worldLitres(model, all)!).toBeGreaterThan(questLitres(model, all)!);
    }
    expect(beatLitres('gemma-4-31b-it')).toBe(0);
    expect(beatLitres('no-such-model')).toBeNull();
    expect(lineLitres()).toBeGreaterThan(0);
  });

  it('prices a world and its first quest at what the ledger measured, not just the model’s words', () => {
    const all = { voice: true, music: true, fal: true };
    // Seven worlds played through their first quest, 1–4 Nov 2026: $0.41–0.72.
    expect(worldLitres('gemini-3.8-flash', all)).toBeGreaterThan(55);
    expect(worldLitres('gemini-3.8-flash', all)).toBeLessThan(85);
    // On the demo: no score, no models, so it is mostly the lines.
    expect(questLitres('gemini-3.8-flash', { voice: true, music: false, fal: false })).toBeLessThan(questLitres('gemini-3.8-flash', all)!);
  });

  it('sells more litres per złoty in the bigger canister', () => {
    const perZloty = CANISTERS.map((c) => c.litres / c.pln);
    expect([...perZloty].sort((a, b) => a - b)).toEqual(perZloty);
  });
});
