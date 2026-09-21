import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultLanguage,
  isPreset,
  LANGUAGE_KEY,
  loadLanguage,
  MAX_LANGUAGE_LENGTH,
  normalizeLanguage,
  saveLanguage,
} from './language';

/** A minimal stand-in for `localStorage`, since there is no jsdom in this project. */
function fakeStorage(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    read: (key: string) => store.get(key) ?? null,
  };
}

function withBrowser(entries: Record<string, string> = {}) {
  const storage = fakeStorage(entries);
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('localStorage', storage);
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeLanguage', () => {
  it('refuses nothing at all', () => {
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage('   ')).toBeNull();
  });

  it('caps at what the backend will accept, so a stale value cannot fail every tap', () => {
    expect(normalizeLanguage('x'.repeat(200))).toHaveLength(MAX_LANGUAGE_LENGTH);
  });

  it('trims, because a trailing space in a prompt is noise', () => {
    expect(normalizeLanguage('  Deutsch \n')).toBe('Deutsch');
  });
});

describe('loadLanguage', () => {
  it('defaults to the page’s own language the first time', () => {
    withBrowser();
    expect(loadLanguage('pl')).toBe('Polski');
    expect(loadLanguage('en')).toBe('English');
  });

  it('prefers what was chosen over what the page is in', () => {
    withBrowser({ [LANGUAGE_KEY]: 'Español' });
    expect(loadLanguage('pl')).toBe('Español');
  });

  it('falls back when the stored value is junk rather than passing it to a prompt', () => {
    withBrowser({ [LANGUAGE_KEY]: '   ' });
    expect(loadLanguage('en')).toBe(defaultLanguage('en'));
  });
});

describe('saveLanguage', () => {
  it('writes the one key', () => {
    const storage = withBrowser();
    saveLanguage('Italiano');
    expect(storage.read(LANGUAGE_KEY)).toBe('Italiano');
  });
});

describe('isPreset', () => {
  it('knows the two on the list from everything typed into Other', () => {
    expect(isPreset('English')).toBe(true);
    expect(isPreset('Polski')).toBe(true);
    expect(isPreset('Deutsch')).toBe(false);
  });
});
