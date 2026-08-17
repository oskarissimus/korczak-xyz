/*
 * The merged app's settings, and the one interesting thing about them: the two numbers describing a
 * sitting used to live on each trainer, and someone who had changed one of them must not be
 * silently reset by the merge.
 *
 * There is no jsdom and no setup file in this project, so `localStorage` does not exist in tests.
 * The fake below is what makes "a record a previous build left behind" a reachable state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';

const logger = vi.hoisted(() => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/logger', () => ({
  ...logger,
  describeError: (e: unknown) => ({ name: (e as Error)?.name, message: String(e) }),
}));

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

let store: MemoryStorage;

function install(seed: Record<string, unknown> = {}): void {
  store = new MemoryStorage();
  for (const [key, value] of Object.entries(seed)) store.setItem(key, JSON.stringify(value));
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
}

async function load() {
  vi.resetModules();
  return import('./settings');
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'localStorage');
});

beforeEach(() => {
  Object.values(logger.log).forEach((fn) => fn.mockReset());
});

describe('sanitizeSettings', () => {
  it('starts a fresh record on both decks', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.trainers).toEqual(['fretboard', 'transpose']);
  });

  it('keeps what a stored record does say', () => {
    const settings = sanitizeSettings({ trainers: ['transpose'], sessionLength: 40 });
    expect(settings.trainers).toEqual(['transpose']);
    expect(settings.sessionLength).toBe(40);
    expect(settings.newPerSession).toBe(DEFAULT_SETTINGS.newPerSession);
  });

  /*
   * A record with no readable trainer left builds an empty sitting, and an empty sitting looks
   * exactly like being caught up — so it has to be repaired here, on the way in from either
   * localStorage or the account, rather than diagnosed later.
   */
  it('never lands on no deck at all', () => {
    expect(sanitizeSettings({ trainers: [] }).trainers).toEqual(DEFAULT_SETTINGS.trainers);
    expect(sanitizeSettings({ trainers: ['ukulele'] as never }).trainers).toEqual(
      DEFAULT_SETTINGS.trainers
    );
    expect(sanitizeSettings({ trainers: undefined as never }).trainers).toEqual(
      DEFAULT_SETTINGS.trainers
    );
  });

  it('drops a deck this build has never heard of, and keeps the ones it has', () => {
    // Settings sync between devices, so a newer build can name a trainer this one lacks.
    const settings = sanitizeSettings({ trainers: ['transpose', 'theremin'] as never });
    expect(settings.trainers).toEqual(['transpose']);
  });

  it('dedupes', () => {
    expect(sanitizeSettings({ trainers: ['fretboard', 'fretboard'] }).trainers).toEqual([
      'fretboard',
    ]);
  });

  it('repairs a length that would make a sitting impossible', () => {
    expect(sanitizeSettings({ sessionLength: 0 }).sessionLength).toBe(
      DEFAULT_SETTINGS.sessionLength
    );
    expect(sanitizeSettings({ sessionLength: NaN }).sessionLength).toBe(
      DEFAULT_SETTINGS.sessionLength
    );
    expect(sanitizeSettings({ newPerSession: -1 }).newPerSession).toBe(
      DEFAULT_SETTINGS.newPerSession
    );
    // Nought new cards is a legitimate choice: review only.
    expect(sanitizeSettings({ newPerSession: 0 }).newPerSession).toBe(0);
  });

  it('takes a default for anything the stored record is missing', () => {
    expect(sanitizeSettings({}, { sessionLength: 40 }).sessionLength).toBe(40);
    // What the record does say still wins over the default.
    expect(sanitizeSettings({ sessionLength: 10 }, { sessionLength: 40 }).sessionLength).toBe(10);
  });
});

describe('loadSettings', () => {
  it('reads its own record', async () => {
    install({ 'flashcards-settings': { trainers: ['fretboard'], sessionLength: 40 } });
    const { loadSettings } = await load();
    expect(loadSettings().trainers).toEqual(['fretboard']);
    expect(loadSettings().sessionLength).toBe(40);
  });

  it('starts on the defaults with nothing stored anywhere', async () => {
    install();
    const { loadSettings } = await load();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  describe('the sitting shape the two trainers used to hold', () => {
    it('is adopted from the fretboard record', async () => {
      install({ 'fretboard-settings': { maxFret: 12, sessionLength: 40, newPerSession: 10 } });
      const { loadSettings } = await load();
      const settings = loadSettings();
      expect(settings.sessionLength).toBe(40);
      expect(settings.newPerSession).toBe(10);
    });

    it('is adopted from the transpose record when the fretboard has none', async () => {
      install({ 'transpose-settings': { keys: 'songbook', sessionLength: 10, newPerSession: 3 } });
      const { loadSettings } = await load();
      expect(loadSettings().sessionLength).toBe(10);
      expect(loadSettings().newPerSession).toBe(3);
    });

    it('prefers the fretboard, the older and larger of the two decks', async () => {
      install({
        'fretboard-settings': { sessionLength: 40 },
        'transpose-settings': { sessionLength: 10 },
      });
      const { loadSettings } = await load();
      expect(loadSettings().sessionLength).toBe(40);
    });

    it('is only a default — its own record wins once there is one', async () => {
      install({
        'fretboard-settings': { sessionLength: 40 },
        'flashcards-settings': { sessionLength: 10 },
      });
      const { loadSettings } = await load();
      expect(loadSettings().sessionLength).toBe(10);
    });

    it('ignores a trainer record that never named a shape', async () => {
      install({ 'fretboard-settings': { maxFret: 12 } });
      const { loadSettings } = await load();
      expect(loadSettings().sessionLength).toBe(DEFAULT_SETTINGS.sessionLength);
    });

    it('survives an unreadable trainer record', async () => {
      install();
      store.setItem('fretboard-settings', '{ not json');
      store.setItem('transpose-settings', JSON.stringify({ sessionLength: 10 }));
      const { loadSettings } = await load();
      expect(loadSettings().sessionLength).toBe(10);
    });
  });
});

describe('saveSettings', () => {
  it('writes what loadSettings reads back', async () => {
    install();
    const { loadSettings, saveSettings } = await load();
    saveSettings({ trainers: ['transpose'], sessionLength: 10, newPerSession: 3 });
    expect(loadSettings()).toEqual({
      trainers: ['transpose'],
      sessionLength: 10,
      newPerSession: 3,
    });
  });
});
