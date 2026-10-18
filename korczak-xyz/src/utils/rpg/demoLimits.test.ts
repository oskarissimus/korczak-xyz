import { describe, expect, it } from 'vitest';

import { beatPrompt } from './quest';
import { DEMO_MODELS, beatReservation, checkRpgDemo, clipCost, demoContext, normalizeRpgDemo, remainingUsd } from './demoLimits';
import { MODEL_CHOICES } from './storyteller';

const settings = normalizeRpgDemo({ enabled: true, keyUid: 'owner', apps: { backseat: true } });

const ctx = {
  lang: 'pl',
  index: 1,
  seed: 'an old debt',
  job: { kind: 'collect', count: 2 },
  plan: [{ kind: 'slay', count: 1 }, { kind: 'talk', count: 0 }],
  title: 'Ring',
  history: [{ npcName: 'Marta', placeName: null, situation: 'x'.repeat(5000), chose: 'Go', consequence: 'Went' }],
  chronicle: [],
  places: [],
  characters: [{ name: 'Marta', gender: 'female', color: 'red' }],
};

describe('normalizeRpgDemo', () => {
  it('defaults to $4 a person and $10 for everybody, on unless switched off', () => {
    expect(settings).toEqual({ enabled: true, keyUid: 'owner', on: true, perIpUsd: 4, dailyUsd: 10 });
    expect(normalizeRpgDemo({ apps: { rpg: false } }).on).toBe(false);
  });

  it('will not be configured into a donation', () => {
    const wild = normalizeRpgDemo({ rpgPerIpUsd: 1000, rpgDailyUsd: -5 });
    expect(wild.perIpUsd).toBe(20);
    expect(wild.dailyUsd).toBe(0);
  });
});

describe('checkRpgDemo', () => {
  it('refuses a call that would pass either cap, with 402 rather than 429', () => {
    expect(checkRpgDemo(settings, { ip: 3.9, all: 5 }, 0.05)).toEqual({ ok: true });
    expect(checkRpgDemo(settings, { ip: 3.9, all: 5 }, 0.2)).toEqual({ ok: false, reason: 'ip-cap', status: 402 });
    expect(checkRpgDemo(settings, { ip: 0, all: 9.95 }, 0.1)).toEqual({ ok: false, reason: 'all-cap', status: 402 });
  });

  it('says why it is closed before it counts anything', () => {
    expect(checkRpgDemo({ ...settings, enabled: false }, { ip: 0, all: 0 }, 0)).toMatchObject({ reason: 'disabled' });
    expect(checkRpgDemo({ ...settings, keyUid: '' }, { ip: 0, all: 0 }, 0)).toMatchObject({ reason: 'no-key' });
    expect(checkRpgDemo({ ...settings, on: false }, { ip: 0, all: 0 }, 0)).toMatchObject({ reason: 'app-off', status: 503 });
  });

  it('never reports a negative remainder', () => {
    expect(remainingUsd(settings, { ip: 5, all: 3 })).toEqual({ ip: 0, all: 7 });
  });
});

describe('beatReservation', () => {
  it('prices every model the demo offers, aliases included', () => {
    for (const model of DEMO_MODELS) expect(beatReservation(model, 10_000), model).not.toBeNull();
    expect(beatReservation('a-model-nobody-priced', 10_000)).toBeNull();
  });

  it('is the worst case: the prompt as tokens and the whole output budget', () => {
    // Pro: $2 in, $12 out per million.
    expect(beatReservation('gemini-3.1-pro-preview', 10_000)).toBeCloseTo((10_000 * 2 + 16_384 * 12) / 1e6);
  });

  it('offers exactly the Google models on the picker', () => {
    expect([...DEMO_MODELS]).toEqual(MODEL_CHOICES.filter((m) => m.provider === 'google').map((m) => m.id));
  });

  it('prices a clip by its length', () => {
    expect(clipCost(200)).toBeCloseTo(200 * 0.5 * 0.00022);
  });
});

describe('demoContext', () => {
  it('cuts what a stranger sends to what the game itself would', () => {
    const clean = demoContext(ctx);
    expect(clean.history[0].situation).toHaveLength(300);
    expect(clean.characters[0].color).toBe('#666666');
    expect(clean.lang).toBe('pl');
    expect(() => beatPrompt(clean)).not.toThrow();
  });

  it('refuses a beat the quest cannot have', () => {
    expect(() => demoContext({ ...ctx, index: 9 })).toThrow();
    expect(() => demoContext({ ...ctx, plan: [] })).toThrow();
    expect(() => demoContext(null)).toThrow();
  });

  it('keeps only the last of every list', () => {
    const many = demoContext({ ...ctx, history: Array.from({ length: 20 }, () => ctx.history[0]), chronicle: Array(50).fill({ title: 't', ending: 'e', steps: [] }) });
    expect(many.history).toHaveLength(4);
    expect(many.chronicle).toHaveLength(5);
  });
});
