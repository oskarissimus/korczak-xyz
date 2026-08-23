import { describe, expect, it } from 'vitest';
import { subIdFor, urlBase64ToUint8Array } from './vapid';

describe('urlBase64ToUint8Array', () => {
  it('decodes a real VAPID public key to the 65 bytes PushManager wants', () => {
    // A P-256 uncompressed point: 65 bytes, leading 0x04. A key that decodes to any other length
    // fails at subscribe() with an opaque InvalidAccessError and nothing in the console to say
    // which of the two keys was wrong.
    const key =
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it('handles every padding case', () => {
    // base64url drops the '=' padding, so the length mod 4 can be 2, 3 or 0 — and the 2 case is
    // the one a naive implementation gets wrong.
    expect(urlBase64ToUint8Array('AQ')).toEqual(new Uint8Array([1]));
    expect(urlBase64ToUint8Array('AQI')).toEqual(new Uint8Array([1, 2]));
    expect(urlBase64ToUint8Array('AQID')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('translates the url-safe alphabet', () => {
    // '-' and '_' stand in for '+' and '/'; leaving them makes atob throw.
    expect(() => urlBase64ToUint8Array('-_-_')).not.toThrow();
    expect(urlBase64ToUint8Array('-_-_')).toEqual(urlBase64ToUint8Array('+/+/'));
  });
});

describe('subIdFor', () => {
  it('is stable for one endpoint', async () => {
    const endpoint = 'https://web.push.apple.com/QBcd1234';
    expect(await subIdFor(endpoint)).toBe(await subIdFor(endpoint));
  });

  it('differs between endpoints', async () => {
    expect(await subIdFor('https://a.test/1')).not.toBe(await subIdFor('https://a.test/2'));
  });

  it('is a short lowercase hex id, legal as a Firestore document id', async () => {
    expect(await subIdFor('https://a.test/1')).toMatch(/^[0-9a-f]{32}$/);
  });
});
