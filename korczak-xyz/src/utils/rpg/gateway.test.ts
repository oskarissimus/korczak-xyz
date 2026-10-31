import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_KEY, apiFetch, gatewayKeys, gatewayUrl, serverCost, setGatewayContext, setTokenSource } from './gateway';
import { NO_KEYS } from '../accountKeys/keys';

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenSource(null);
  setGatewayContext(() => ({ world: null, quest: null }));
});

function lastCall(fetch: ReturnType<typeof vi.fn>): { url: string; headers: Headers } {
  const [url, init] = fetch.mock.calls.at(-1)!;
  return { url: String(url), headers: new Headers((init as RequestInit).headers) };
}

describe('apiFetch', () => {
  it('sends a provider request to the gateway, and an account key as the reader’s ID token only', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    setTokenSource(async () => 'id-token');
    setGatewayContext(() => ({ world: 'w-1', quest: 'q-1' }));
    await apiFetch(`https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse&key=${ACCOUNT_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const { url, headers } = lastCall(fetch);
    expect(url).toBe(`${gatewayUrl()}/generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse`);
    expect(url).not.toContain('key=');
    expect(headers.get('authorization')).toBe('Bearer id-token');
    expect(headers.get('x-rpg-key')).toBeNull();
    expect(headers.get('x-rpg-world')).toBe('w-1');
    expect(headers.get('x-rpg-quest')).toBe('q-1');
  });

  it('carries a key that is only in this browser in its own header, and no provider header', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await apiFetch('https://api.elevenlabs.io/v1/text-to-speech/v', { method: 'POST', headers: { 'xi-api-key': 'sk-own' } });
    let { headers } = lastCall(fetch);
    expect(headers.get('xi-api-key')).toBeNull();
    expect(headers.get('x-rpg-key')).toBe('sk-own');

    await apiFetch('https://queue.fal.run/fal-ai/trellis', { method: 'POST', headers: { Authorization: 'Key fal-own' } });
    ({ headers } = lastCall(fetch));
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-rpg-key')).toBe('fal-own');
  });

  it('leaves alone a host that is not a provider’s', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(''));
    vi.stubGlobal('fetch', fetch);
    await apiFetch('https://v3.fal.media/files/x.glb', { method: 'PUT' });
    expect(String(fetch.mock.calls[0][0])).toBe('https://v3.fal.media/files/x.glb');
  });

  it('will not send an account request signed out', async () => {
    vi.stubGlobal('fetch', vi.fn());
    setTokenSource(async () => null);
    await expect(apiFetch('https://fal.run/fal-ai/flux/schnell', { headers: { Authorization: `Key ${ACCOUNT_KEY}` } })).rejects.toThrow(/signed out/);
  });
});

describe('gatewayKeys', () => {
  it('turns the account’s keys into handles, and leaves a browser’s own alone', () => {
    const keys = { ...NO_KEYS, google: 'AIza-real', fal: 'fal-real' };
    expect(gatewayKeys(keys, true)).toMatchObject({ google: ACCOUNT_KEY, fal: ACCOUNT_KEY, openai: null });
    expect(gatewayKeys(keys, false)).toEqual(keys);
  });
});

describe('serverCost', () => {
  it('reads the gateway’s price', () => {
    expect(serverCost(new Response('', { headers: { 'x-rpg-cost-usd': '0.012000' } }))).toBe(0.012);
    expect(serverCost(new Response(''))).toBeNull();
  });
});
