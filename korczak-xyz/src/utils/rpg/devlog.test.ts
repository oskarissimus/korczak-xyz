import { beforeEach, describe, expect, it } from 'vitest';
import {
  addGenerationTime,
  beginQuestSpend,
  endRequest,
  NO_SPEND,
  questSpend,
  resetDevlog,
  spendUsd,
  startRequest,
  triesSpend,
  updateRequest,
  validSpend,
  worldSpend,
} from './devlog';
import { classicWorld, type WorldBible } from './genesis';

describe('the closing screen counts the whole quest and its world', () => {
  beforeEach(() => {
    resetDevlog();
    beginQuestSpend();
  });

  it('keeps the world’s requests out of the quest', () => {
    const genesis = startRequest('model', 'gemini-3.8-flash', null);
    updateRequest(genesis, { usage: { input: 1000, output: 1000, thoughts: 0 } });
    endRequest(genesis, null);
    addGenerationTime(9000, 'world');
    const hub = startRequest('fal', 'fal-ai/trellis', null, '', 'house');
    endRequest(hub, null, { cost: 0.02 });
    const beat = startRequest('model', 'gemini-3.8-flash', 0);
    updateRequest(beat, { usage: { input: 2000, output: 0, thoughts: 0 } });
    endRequest(beat, null);
    addGenerationTime(4000);
    const clue = startRequest('fal', 'fal-ai/trellis', null, '', 'clue');
    endRequest(clue, null, { cost: 0.02 });

    const q = questSpend();
    expect(q.ms).toBe(4000);
    expect(q.tokens.input).toBe(2000);
    expect(q.falModels).toBe(1);
    expect(q.falCost).toBeCloseTo(0.02);
  });

  it('adds what earlier sittings saved to this one', () => {
    const before = { ...NO_SPEND, ms: 30_000, modelCost: 0.05, voiceChars: 500, voiceCredits: 250, voiceCost: 0.055 };
    beginQuestSpend(before);
    const clip = startRequest('voice', 'eleven_flash_v2_5 · Jagna', null, 'Dzień dobry');
    endRequest(clip, null, { chars: 11, credits: 5.5 });
    addGenerationTime(2000);
    const q = questSpend();
    expect(q.ms).toBe(32_000);
    expect(q.voiceChars).toBe(511);
    expect(q.voiceCredits).toBeCloseTo(255.5);
    expect(spendUsd(q)).toBeCloseTo(0.05 + (255.5 * 22) / 100_000);
  });

  it('survives the trip through a save, and refuses nonsense', () => {
    const saved = JSON.parse(JSON.stringify({ ...NO_SPEND, ms: 5, partial: true }));
    expect(validSpend(saved)).toEqual({ ...NO_SPEND, ms: 5, partial: true });
    expect(validSpend({ ms: 'a', tokens: { input: -1 } })?.ms).toBe(0);
    expect(validSpend(null)).toBeNull();
    expect(validSpend({})).toBeNull();
  });

  it('reads a world’s cost off the world: its genesis and its hub’s models', () => {
    expect(worldSpend(classicWorld('pl'))).toBeNull();
    const model = { glb: 'x.glb', image: 'x.png', prompt: '', costUsd: 0.023, ms: 1, at: 1 };
    const base = { ...classicWorld('pl'), id: 'w1', createdAt: 1 } as WorldBible;
    const spent = triesSpend(
      [
        { model: 'a', status: 500, ms: 1, firstMs: null, error: 'x', usage: null, cost: null },
        { model: 'b', status: 200, ms: 1, firstMs: 1, error: null, usage: { input: 10, output: 20, thoughts: 5 }, cost: 0.01 },
      ],
      8000,
    );
    const w = worldSpend({ ...base, spent, landmarkModel: model, kitModels: { house: model } });
    expect(w).toMatchObject({ ms: 8000, modelCost: 0.01, falModels: 2, unpriced: false });
    expect(w?.falCost).toBeCloseTo(0.046);
    expect(w?.partial).toBeUndefined();
    // From before its cost was kept: the models still count, the genesis is unknown.
    expect(worldSpend({ ...base, landmarkModel: model })).toMatchObject({ falModels: 1, partial: true });
    // Its painted ground is the world's too.
    const ground = { image: 'g.jpg', prompt: '', costUsd: 0.003, ms: 1, at: 1 };
    const g = worldSpend({ ...base, spent, landmarkModel: model, groundTexture: ground });
    expect(g).toMatchObject({ falModels: 1, falTextures: 1 });
    expect(g?.falCost).toBeCloseTo(0.026);
  });
});
