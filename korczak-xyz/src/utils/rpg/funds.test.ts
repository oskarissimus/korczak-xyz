import { beforeEach, describe, expect, it } from 'vitest';
import { endRequest, resetDevlog, startRequest, updateRequest } from './devlog';
import { bannerAlerts, dismissFunds, fundsAlerts, isFundsError, outOfFunds, providerOf, resetFunds } from './funds';

describe('an account out of money is said once, by provider', () => {
  beforeEach(() => {
    resetDevlog();
    resetFunds();
  });

  it('reads each provider’s words for an empty balance', () => {
    expect(isFundsError('fal', '403 {"detail":"User is locked. Reason: TOP_UP."}')).toBe(true);
    expect(isFundsError('fal', '403 {"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing."}')).toBe(true);
    expect(isFundsError('elevenlabs', 'This request exceeds your quota of 10000. You have 3 credits remaining, while 50 credits are required for this request.')).toBe(true);
    expect(isFundsError('google', '429: Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.')).toBe(true);
    expect(isFundsError('openai', '429: You exceeded your current quota, please check your plan and billing details.')).toBe(true);
  });

  it('does not take a model’s quota, a bad key or a timeout for it', () => {
    // Google says "billing details" on a per-model 429 too, which the chain only moves past.
    expect(isFundsError('google', '429: You exceeded your current quota, please check your plan and billing details.')).toBe(false);
    expect(isFundsError('fal', '401 {"detail":"Invalid key"}')).toBe(false);
    expect(isFundsError('fal', '429 concurrent_requests_limit')).toBe(false);
    expect(isFundsError('elevenlabs', 'ElevenLabs 500')).toBe(false);
    expect(isFundsError('fal', 'timed out in the queue')).toBe(false);
  });

  it('knows whose request an entry is', () => {
    expect(providerOf('fal', 'fal-ai/flux/schnell')).toBe('fal');
    expect(providerOf('voice', 'eleven_v3 · Jagna')).toBe('elevenlabs');
    expect(providerOf('music', 'music_v2')).toBe('elevenlabs');
    expect(providerOf('model', 'gpt-4.1')).toBe('openai');
    expect(providerOf('model', 'gemini-3-flash-preview')).toBe('google');
  });

  it('marks the provider once and counts every refusal after', () => {
    for (let i = 0; i < 3; i++) {
      endRequest(startRequest('fal', 'fal-ai/flux/schnell', null, 'a granary', 'place'), '403 {"detail":"User is locked. Reason: TOP_UP."}');
    }
    expect(outOfFunds('fal')).toBe(true);
    expect(outOfFunds('elevenlabs')).toBe(false);
    expect(fundsAlerts()).toHaveLength(1);
    expect(fundsAlerts()[0].count).toBe(3);
  });

  it('is hidden from the game by its ×, but kept in the console', () => {
    endRequest(startRequest('voice', 'eleven_v3 · Jagna', null), 'This request exceeds your quota of 10000.');
    dismissFunds('elevenlabs');
    expect(bannerAlerts()).toHaveLength(0);
    expect(fundsAlerts()).toHaveLength(1);
  });

  it('clears when the same provider answers and charges again', () => {
    endRequest(startRequest('fal', 'fal-ai/flux/schnell', null), '403 {"detail":"User is locked. Reason: TOP_UP."}');
    // The self-rig is a fal entry that costs nothing: it says nothing about the balance.
    endRequest(startRequest('fal', 'self-rig', null), null, { cost: 0 });
    expect(outOfFunds('fal')).toBe(true);
    endRequest(startRequest('fal', 'fal-ai/flux/schnell', null), null, { cost: 0.003 });
    expect(outOfFunds('fal')).toBe(false);
  });

  it('leaves another failure alone', () => {
    const beat = startRequest('model', 'gemini-3.1-pro-preview', 0);
    updateRequest(beat, { usage: null });
    endRequest(beat, '503: The model is overloaded.');
    expect(fundsAlerts()).toHaveLength(0);
  });
});
