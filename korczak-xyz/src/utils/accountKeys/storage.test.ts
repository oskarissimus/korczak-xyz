import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_KEYS_STORAGE_KEY, loadAccountKeys } from './storage';

/** A minimal stand-in for `localStorage`, since there is no jsdom in this project. */
function withBrowser(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('localStorage', storage);
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadAccountKeys', () => {
  it('seeds from the apps’ copies, writes the seed, and only then empties the copies', () => {
    const store = withBrowser({
      'sloper-config': JSON.stringify({ apiKeys: { openai: 'sk', deepseek: 'ds' }, updatedAt: 5, llm: 'x' }),
      'audio-guide-config': JSON.stringify({ apiKeys: { google: 'g', elevenLabs: 'el' }, updatedAt: 9 }),
    });

    const { stored } = loadAccountKeys();
    expect(stored.value.apiKeys).toMatchObject({ openai: 'sk', deepseek: 'ds', google: 'g', elevenLabs: 'el' });
    // Stamped 0 and undecided: the account's own copy, if there is one, wins.
    expect(stored.updatedAt).toBe(0);
    expect(stored.settled).toBe(false);

    expect(JSON.parse(store.get(ACCOUNT_KEYS_STORAGE_KEY)!).apiKeys.openai).toBe('sk');
    const sloper = JSON.parse(store.get('sloper-config')!);
    // The rest of the app's config and its stamp untouched, so its own sync notices nothing.
    expect(sloper).toEqual({ apiKeys: { openai: null, deepseek: null }, updatedAt: 5, llm: 'x' });
  });

  it('never seeds into a store somebody cleared, and still empties the stale copies', () => {
    const store = withBrowser({
      [ACCOUNT_KEYS_STORAGE_KEY]: JSON.stringify({ apiKeys: {}, updatedAt: 7, settled: true }),
      'backseat-config': JSON.stringify({ apiKeys: { openai: 'sk' }, updatedAt: 3 }),
    });

    expect(loadAccountKeys().stored.value.apiKeys.openai).toBeNull();
    expect(JSON.parse(store.get('backseat-config')!).apiKeys.openai).toBeNull();
  });

  it('keeps the copies when the seed could not be written', () => {
    const store = withBrowser({
      'sloper-config': JSON.stringify({ apiKeys: { openai: 'sk' }, updatedAt: 5 }),
    });
    const storage = (globalThis as unknown as { localStorage: { setItem: unknown } }).localStorage;
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    expect(loadAccountKeys().stored.value.apiKeys.openai).toBe('sk');
    expect(JSON.parse(store.get('sloper-config')!).apiKeys.openai).toBe('sk');
  });
});
