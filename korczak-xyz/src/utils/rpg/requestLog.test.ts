import { describe, expect, it } from 'vitest';

import { gatewayTarget } from './gatewayRoutes';
import {
  dailyCosts,
  describePrice,
  groupCosts,
  isPaidRequest,
  safeHeaders,
  trimForLog,
  warsawDay,
  type RequestLogEntry,
} from './requestLog';

const target = (path: string, method = 'POST') => gatewayTarget(path, method)!;

describe('which requests are logged', () => {
  it('logs what can cost money', () => {
    expect(isPaidRequest(target('/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent'), 'POST')).toBe(true);
    expect(isPaidRequest(target('/api.elevenlabs.io/v1/text-to-speech/abc'), 'POST')).toBe(true);
    expect(isPaidRequest(target('/api.elevenlabs.io/v1/music'), 'POST')).toBe(true);
    expect(isPaidRequest(target('/queue.fal.run/fal-ai/trellis'), 'POST')).toBe(true);
    expect(isPaidRequest(target('/fal.run/fal-ai/flux/schnell'), 'POST')).toBe(true);
  });

  it('does not log what is free', () => {
    expect(isPaidRequest(target('/queue.fal.run/fal-ai/trellis/requests/abc/status', 'GET'), 'GET')).toBe(false);
    expect(isPaidRequest(target('/queue.fal.run/fal-ai/trellis/requests/abc', 'GET'), 'GET')).toBe(false);
    expect(isPaidRequest(target('/api.elevenlabs.io/v1/shared-voices', 'GET'), 'GET')).toBe(false);
    expect(isPaidRequest(target('/rest.alpha.fal.ai/storage/upload/initiate'), 'POST')).toBe(false);
  });
});

describe('how a price is described', () => {
  const at = Date.parse('2026-11-10T08:00:00Z');

  it('shows the arithmetic of a token-priced answer', () => {
    const d = describePrice(target('/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent'), {}, {
      usd: 0.0105,
      model: 'gemini-3.8-flash',
      usage: { input: 8000, output: 1200, thoughts: 800 },
      image: false,
      credits: null,
      at,
    });
    expect(d.source).toBe('usage');
    expect(d.basis).toBe('gemini-3.8-flash: 8000 in × $0.75/1M + 2000 out (1200 + 800 thinking) × $3.75/1M');
    expect(d.usage).toEqual({ input: 8000, output: 1200, thoughts: 800 });
  });

  it('trusts ElevenLabs when it says what a clip took', () => {
    const d = describePrice(target('/api.elevenlabs.io/v1/text-to-speech/abc'), { text: 'Witaj', model_id: 'eleven_flash_v2_5' }, {
      usd: 0.0002,
      model: 'eleven_flash_v2_5',
      usage: null,
      image: false,
      credits: 3,
      at,
    });
    expect(d.source).toBe('provider');
    expect(d.usage).toEqual({ chars: 5, credits: 3 });
  });

  it('says when there is no price', () => {
    const d = describePrice(target('/queue.fal.run/fal-ai/unknown-model'), {}, { usd: null, model: 'fal-ai/unknown-model', usage: null, image: false, credits: null, at });
    expect(d.source).toBe('none');
  });
});

describe('what is kept', () => {
  it('never keeps a header that carries a key', () => {
    expect(safeHeaders(Object.entries({ 'x-goog-api-key': 'k', Authorization: 'Bearer x', 'xi-api-key': 'k', 'content-type': 'application/json' }))).toEqual({
      'content-type': 'application/json',
    });
  });

  it('cuts inline base64 to its length', () => {
    const big = 'A'.repeat(10_000);
    expect(trimForLog({ image: big, prompt: 'hi' })).toEqual({ image: `${'A'.repeat(200)}… [10000 characters]`, prompt: 'hi' });
  });
});

function entry(over: Partial<RequestLogEntry>): RequestLogEntry {
  return {
    id: 'x',
    at: Date.parse('2026-11-09T10:00:00Z'),
    uid: 'u1',
    payer: 'diesel',
    provider: 'google',
    host: 'h',
    method: 'POST',
    path: '/p',
    model: 'm',
    status: 200,
    ms: 1,
    world: null,
    quest: null,
    usd: 0.01,
    source: 'usage',
    basis: '',
    usdPln: 4,
    fxDate: '2026-11-09',
    bodies: null,
    requestBytes: 0,
    responseBytes: 0,
    contentType: null,
    ...over,
  };
}

describe('the dashboard sums', () => {
  it('groups by the chosen key, dearest first, in złoty at each request’s own rate', () => {
    const groups = groupCosts(
      [entry({ provider: 'google', usd: 0.01 }), entry({ provider: 'fal', usd: 0.25, usdPln: null }), entry({ provider: 'google', usd: null })],
      'provider',
      3.9,
    );
    expect(groups.map((g) => g.key)).toEqual(['fal', 'google']);
    expect(groups[0].pln).toBeCloseTo(0.25 * 3.9, 10);
    expect(groups[1]).toMatchObject({ calls: 2, unpriced: 1 });
    expect(groups[1].pln).toBeCloseTo(0.04, 10);
  });

  it('draws every day of the range, the empty ones too, by the Warsaw day', () => {
    const from = Date.parse('2026-11-07T12:00:00Z');
    const to = Date.parse('2026-11-10T12:00:00Z');
    // 23:30 UTC on the 8th is already the 9th in Warsaw.
    const days = dailyCosts([entry({ at: Date.parse('2026-11-08T23:30:00Z'), usd: 0.5 })], from, to);
    expect(days.map((d) => d.day)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    expect(days[2]).toMatchObject({ usd: 0.5, calls: 1 });
    expect(warsawDay(Date.parse('2026-11-08T23:30:00Z'))).toBe('2026-11-09');
  });
});
