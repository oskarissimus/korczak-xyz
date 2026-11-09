import { describe, expect, it } from 'vitest';

import { BadPatch, demoKeysOf, demoWrite, keyHints, parseAdminPatch, serverKeysFrom } from './adminConfig';

describe('parseAdminPatch', () => {
  it('takes keys to set and keys to clear, trimmed', () => {
    expect(parseAdminPatch({ keys: { google: ' abc123 ', fal: null } })).toEqual({ keys: { google: 'abc123', fal: null } });
  });

  it('refuses what it does not know rather than dropping it', () => {
    expect(() => parseAdminPatch({ keys: { deepseek: 'x' } })).toThrow(BadPatch);
    expect(() => parseAdminPatch({ secrets: {} })).toThrow(BadPatch);
    expect(() => parseAdminPatch({ demo: { keyUid: 'someone' } })).toThrow(BadPatch);
    expect(() => parseAdminPatch({ keys: { google: '' } })).toThrow(BadPatch);
    expect(() => parseAdminPatch({ keys: { google: 'a b' } })).toThrow(BadPatch);
    expect(() => parseAdminPatch(null)).toThrow(BadPatch);
  });

  it('holds the demo’s caps to their maxima', () => {
    expect(parseAdminPatch({ demo: { on: true, perIpUsd: 2.555, dailyUsd: 50 } })).toEqual({ demo: { on: true, perIpUsd: 2.56, dailyUsd: 50 } });
    expect(() => parseAdminPatch({ demo: { dailyUsd: 51 } })).toThrow(BadPatch);
    expect(() => parseAdminPatch({ demo: { perIpUsd: -1 } })).toThrow(BadPatch);
  });
});

describe('the rest', () => {
  it('reads the store and hints at it by four characters', () => {
    const keys = serverKeysFrom({ apiKeys: { google: 'AIza-long-1234', elevenLabs: '  ', other: 'x' } });
    expect(keys).toEqual({ google: 'AIza-long-1234', elevenLabs: null, fal: null, openai: null });
    expect(keyHints(keys).google).toBe('1234');
  });

  it('writes only the RPG’s own fields of demo/config', () => {
    expect(demoWrite({ on: false, dailyUsd: 5 })).toEqual({ apps: { rpg: false }, rpgDailyUsd: 5 });
  });

  it('pays with the server’s key before the account’s', () => {
    const none = { google: null, elevenLabs: null, fal: null, openai: null };
    expect(demoKeysOf({ ...none, google: 's' }, { google: 'a', elevenLabs: 'v' })).toEqual({ google: 's', elevenLabs: 'v', payer: 'server' });
    expect(demoKeysOf(none, { google: 'a', elevenLabs: null }).payer).toBe('account');
    expect(demoKeysOf(none, { google: null, elevenLabs: null }).payer).toBe('nobody');
  });
});
