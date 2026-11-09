import { describe, expect, it } from 'vitest';

import { gatewayTarget } from './gatewayRoutes';
import { balanceOf, dieselReservation, dieselRoute, fuelKeys, grantOf, isFollowUp } from './wallet';
import { parseAdminPatch } from './adminConfig';

const target = (path: string, method = 'POST') => gatewayTarget(path, method)!;

describe('diesel as a balance', () => {
  it('pays only for the game’s own routes', () => {
    expect(dieselRoute(target('/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent'), 'POST')).toBe(true);
    expect(dieselRoute(target('/fal.run/fal-ai/flux/schnell'), 'POST')).toBe(true);
    expect(dieselRoute(target('/api.elevenlabs.io/v1/text-to-speech/abc'), 'POST')).toBe(true);
    expect(dieselRoute(target('/api.openai.com/v1/images/generations'), 'POST')).toBe(false);
    expect(dieselRoute(target('/generativelanguage.googleapis.com/v1beta/models/imagen:predict'), 'POST')).toBe(false);
    expect(dieselRoute(target('/api.elevenlabs.io/v1/user/subscription', 'GET'), 'GET')).toBe(false);
  });

  it('reserves a beat’s worst case, a clip and a fal.ai job exactly, and nothing for a follow-up', () => {
    const beat = dieselReservation(target('/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'), 'POST', {}, 20_000);
    // 20k characters in at $0.75/M and 16,384 tokens out at $3.75/M.
    expect(beat).toBeCloseTo((20_000 * 0.75 + 16_384 * 3.75) / 1e6);
    expect(dieselReservation(target('/queue.fal.run/fal-ai/trellis'), 'POST', {}, 10)).toBeCloseTo(0.02);
    const clip = dieselReservation(target('/api.elevenlabs.io/v1/text-to-speech/abc'), 'POST', { text: 'x'.repeat(100), model_id: 'eleven_flash_v2_5' }, 0);
    expect(clip).toBeGreaterThan(0);
    const poll = target('/queue.fal.run/fal-ai/trellis/requests/abc/status', 'GET');
    expect(dieselReservation(poll, 'GET', {}, 0)).toBe(0);
    expect(isFollowUp(poll, 'GET')).toBe(true);
    expect(isFollowUp(target('/fal.run/fal-ai/flux/schnell'), 'POST')).toBe(false);
  });

  it('reads an account never granted as null, and a broken grant as the default', () => {
    expect(balanceOf(undefined)).toBeNull();
    expect(balanceOf({ usd: 3 })).toBeNull();
    expect(balanceOf({ dieselGrantedAt: 1, dieselUsd: -0.001 })).toBe(0);
    expect(balanceOf({ dieselGrantedAt: 1, dieselUsd: 0.42 })).toBe(0.42);
    expect(grantOf(undefined)).toBe(1);
    expect(grantOf({ grantUsd: 2.5 })).toBe(2.5);
    expect(grantOf({ grantUsd: 1e6 })).toBe(1);
  });

  it('fills only the keys the reader lacks and the server has', () => {
    const keys = fuelKeys({ google: null, elevenLabs: 'own', fal: null, openai: null }, { google: true, elevenLabs: true, fal: false, openai: true }, 'H');
    expect(keys).toEqual({ google: 'H', elevenLabs: 'own', fal: null, openai: 'H' });
  });

  it('takes the panel’s diesel settings, top-up and key test, field by field', () => {
    expect(parseAdminPatch({ diesel: { grantUsd: 1.5 }, testKeys: true })).toEqual({ diesel: { grantUsd: 1.5 }, testKeys: true });
    expect(parseAdminPatch({ topUp: { email: ' A@B.pl ', usd: 2 } })).toEqual({ topUp: { email: 'a@b.pl', usd: 2 } });
    expect(() => parseAdminPatch({ diesel: { grant: 1 } })).toThrow();
    expect(() => parseAdminPatch({ diesel: { grantUsd: 999 } })).toThrow();
    expect(() => parseAdminPatch({ topUp: { email: 'nope', usd: 1 } })).toThrow();
    expect(() => parseAdminPatch({ topUp: { email: 'a@b.pl', usd: 0 } })).toThrow();
    expect(() => parseAdminPatch({ testKeys: 'yes' })).toThrow();
  });
});
