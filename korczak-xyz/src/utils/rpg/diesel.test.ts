import { describe, expect, it } from 'vitest';
import { beatLitres, CANISTERS, EMPTY_LITRES, formatLitres, lineLitres, litres, plantState, worldLitres } from './diesel';
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

  it('prices every demo model, a world as two steps', () => {
    for (const model of DEMO_MODELS) {
      const beat = beatLitres(model);
      expect(beat, model).not.toBeNull();
      expect(worldLitres(model)).toBeCloseTo(beat! * 2);
    }
    expect(beatLitres('gemma-4-31b-it')).toBe(0);
    expect(beatLitres('no-such-model')).toBeNull();
    expect(lineLitres()).toBeGreaterThan(0);
  });

  it('sells more litres per złoty in the bigger canister', () => {
    const perZloty = CANISTERS.map((c) => c.litres / c.pln);
    expect([...perZloty].sort((a, b) => a - b)).toEqual(perZloty);
  });
});
