import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG, DEFAULT_GOOGLE_MODEL } from './defaults';
import {
  anyKey,
  borrowFromBrowser,
  configWithBorrowedKeys,
  hasNoKeys,
  keysFromSloper,
  shouldBorrow,
  sloperKeysInBrowser,
} from './importKeys';
import { loadConfig } from './storage';

/** A minimal stand-in for `localStorage`, since there is no jsdom in this project. */
function fakeStorage(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

function withBrowser(entries: Record<string, string>) {
  vi.stubGlobal('window', { localStorage: fakeStorage(entries) });
  vi.stubGlobal('localStorage', fakeStorage(entries));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * It is fed a localStorage blob written by an older build of a DIFFERENT app and a Firestore
 * document written by another device. The worst case has to be three nulls rather than a throw on
 * a page that was working a moment ago.
 */
describe('keysFromSloper', () => {
  it('takes the three keys this app can use', () => {
    expect(
      keysFromSloper({
        apiKeys: { openai: 'sk-a', deepseek: 'ds-b', google: 'AIza-c', elevenLabs: 'el-d' },
        llm: { provider: 'deepseek' },
      }),
    ).toEqual({ openai: 'sk-a', google: 'AIza-c', elevenLabs: 'el-d' });
  });

  /* DeepSeek has no model that can look at a photograph, so there is nothing to carry it to. */
  it('drops the DeepSeek key on the way through', () => {
    const keys = keysFromSloper({ apiKeys: { deepseek: 'ds-b' } });
    expect(keys).toEqual({ openai: null, google: null, elevenLabs: null });
    expect(keys).not.toHaveProperty('deepseek');
  });

  it('trims, and reads an empty key as not set', () => {
    expect(keysFromSloper({ apiKeys: { openai: '  sk-a  ', google: '   ' } })).toEqual({
      openai: 'sk-a',
      google: null,
      elevenLabs: null,
    });
  });

  it('gives three nulls for anything it cannot read', () => {
    const empty = { openai: null, google: null, elevenLabs: null };
    expect(keysFromSloper(null)).toEqual(empty);
    expect(keysFromSloper('nonsense')).toEqual(empty);
    expect(keysFromSloper({})).toEqual(empty);
    expect(keysFromSloper({ apiKeys: 'nope' })).toEqual(empty);
    expect(keysFromSloper({ apiKeys: { openai: 42 } })).toEqual(empty);
  });
});

describe('anyKey and hasNoKeys', () => {
  it('says whether there is anything to borrow, or anything to borrow over', () => {
    expect(anyKey({ openai: null, google: null, elevenLabs: null })).toBe(false);
    expect(anyKey({ openai: null, google: null, elevenLabs: 'el' })).toBe(true);
    expect(hasNoKeys(DEFAULT_CONFIG)).toBe(true);
    expect(
      hasNoKeys({ ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys, openai: 'sk' } }),
    ).toBe(false);
  });
});

describe('configWithBorrowedKeys', () => {
  it('keeps the OpenAI defaults when an OpenAI key came along', () => {
    const config = configWithBorrowedKeys(DEFAULT_CONFIG, {
      openai: 'sk-a',
      google: 'AIza-c',
      elevenLabs: null,
    });

    expect(config.apiKeys.openai).toBe('sk-a');
    expect(config.vision).toEqual(DEFAULT_CONFIG.vision);
  });

  /*
   * The difference between the import working and the import looking broken: the default provider
   * is OpenAI, so a Google-only borrow would fill in a key the app never asks for and leave Start
   * dead with nothing on screen explaining why.
   */
  it('moves the provider when only a Google key came along', () => {
    const config = configWithBorrowedKeys(DEFAULT_CONFIG, {
      openai: null,
      google: 'AIza-c',
      elevenLabs: null,
    });

    expect(config.vision.provider).toBe('google');
    expect(config.vision.model).toBe(DEFAULT_GOOGLE_MODEL);
  });

  it('leaves everything that is not a key alone', () => {
    const base = {
      ...DEFAULT_CONFIG,
      remarks: { ...DEFAULT_CONFIG.remarks, persona: 'codriver' as const, intervalSeconds: 40 },
    };
    const config = configWithBorrowedKeys(base, {
      openai: 'sk-a',
      google: null,
      elevenLabs: null,
    });

    expect(config.remarks).toEqual(base.remarks);
    expect(config.voice).toEqual(base.voice);
  });
});

describe('sloperKeysInBrowser', () => {
  it('reads the wizard’s own localStorage key', () => {
    withBrowser({ 'sloper-config': JSON.stringify({ apiKeys: { openai: 'sk-a' } }) });
    expect(sloperKeysInBrowser().openai).toBe('sk-a');
  });

  /* The name sloper used on GitHub Pages, which a browser may still carry. */
  it('falls back to the legacy key', () => {
    withBrowser({ 'sloper-api-config': JSON.stringify({ apiKeys: { google: 'AIza-c' } }) });
    expect(sloperKeysInBrowser().google).toBe('AIza-c');
  });

  it('survives a corrupt config belonging to the other app', () => {
    withBrowser({ 'sloper-config': '{not json' });
    expect(sloperKeysInBrowser()).toEqual({ openai: null, google: null, elevenLabs: null });
  });

  it('is empty when the wizard has never been opened here', () => {
    withBrowser({});
    expect(borrowFromBrowser()).toEqual({ config: DEFAULT_CONFIG, borrowed: false });
  });
});

/*
 * `settled` is the whole safety argument: it means somebody has DECIDED what the keys here are,
 * and nothing is ever borrowed into a settled config.
 *
 * It replaced "does a `backseat-config` exist", which was the same idea inferred from a
 * side-effect — and which shipped broken, because the sync writes a config up the first time
 * anybody opens the app signed in. An empty document with a recent timestamp then beat the borrow
 * for ever. A fact that exists as a side-effect of a sync cannot carry a meaning the sync does not
 * know about.
 */
describe('shouldBorrow', () => {
  const keyless = DEFAULT_CONFIG;
  const keyed = { ...DEFAULT_CONFIG, apiKeys: { ...DEFAULT_CONFIG.apiKeys, openai: 'sk' } };

  it('borrows into a config nobody has decided and that holds no keys', () => {
    expect(shouldBorrow(keyless, false)).toBe(true);
  });

  /* The key was cleared on purpose. Borrowing here is the resurrection bug. */
  it('never borrows into a settled config, however empty', () => {
    expect(shouldBorrow(keyless, true)).toBe(false);
  });

  it('never borrows over a key that is already there', () => {
    expect(shouldBorrow(keyed, false)).toBe(false);
    expect(shouldBorrow(keyed, true)).toBe(false);
  });
});

describe('loadConfig and the borrow', () => {
  it('borrows when this browser has never saved a config, stamped 0 so the account wins', () => {
    withBrowser({ 'sloper-config': JSON.stringify({ apiKeys: { openai: 'sk-a' } }) });

    const loaded = loadConfig();
    expect(loaded.config.apiKeys.openai).toBe('sk-a');
    expect(loaded.borrowed).toBe(true);
    expect(loaded.settled).toBe(false);
    // `updatedAt: 0` is what stops a borrow this morning overwriting a key typed here last week.
    expect(loaded.updatedAt).toBe(0);
  });

  /*
   * The regression. This is the exact shape a browser is left in by pulling down the empty
   * document the sync created on a first signed-in visit: a saved config, a real timestamp, no
   * keys and nobody having decided anything. It has to still be a first visit to the borrow.
   */
  it('borrows into a saved config that nobody has decided, such as a pulled empty one', () => {
    withBrowser({
      'backseat-config': JSON.stringify({
        apiKeys: { openai: null },
        updatedAt: 1789757457694,
      }),
      'sloper-config': JSON.stringify({ apiKeys: { openai: 'sk-a' } }),
    });

    const loaded = loadConfig();
    expect(loaded.config.apiKeys.openai).toBe('sk-a');
    expect(loaded.borrowed).toBe(true);
    expect(loaded.updatedAt).toBe(0);
  });

  it('never borrows into a settled config, however empty', () => {
    // The shape left behind by clearing a key deliberately. Borrowing here would resurrect it.
    withBrowser({
      'backseat-config': JSON.stringify({
        apiKeys: { openai: null },
        updatedAt: 1730000000000,
        settled: true,
      }),
      'sloper-config': JSON.stringify({ apiKeys: { openai: 'sk-a' } }),
    });

    const loaded = loadConfig();
    expect(loaded.config.apiKeys.openai).toBeNull();
    expect(loaded.borrowed).toBe(false);
    expect(loaded.settled).toBe(true);
    expect(loaded.updatedAt).toBe(1730000000000);
  });

  it('leaves a settled config with keys exactly as it found it', () => {
    withBrowser({
      'backseat-config': JSON.stringify({
        apiKeys: { openai: 'sk-mine' },
        updatedAt: 1730000000000,
        settled: true,
      }),
      'sloper-config': JSON.stringify({ apiKeys: { openai: 'sk-theirs' } }),
    });

    expect(loadConfig().config.apiKeys.openai).toBe('sk-mine');
  });
});
