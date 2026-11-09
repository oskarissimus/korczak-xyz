import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The interface translated once per language: what is stored, what is reused after a deploy that
 * changed some English, and that a request can name nothing but a language on the list.
 */

const store = new Map<string, Record<string, unknown>>();
vi.mock('../runtime', () => ({
  db: {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: store.has(`${c}/${id}`), data: () => store.get(`${c}/${id}`) }),
        set: async (data: Record<string, unknown>) => void store.set(`${c}/${id}`, data),
      }),
    }),
  },
}));
vi.mock('../sentry', () => ({ reportError: vi.fn() }));

import { uiSource } from '../../../korczak-xyz/src/utils/rpg/uiTranslate';
import { uiStrings } from './ui';

/** Gemini, answering each slice with every value marked, placeholders kept. */
function fakeGemini() {
  const asked: Record<string, string>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const prompt = JSON.parse(init.body).contents[0].parts[0].text as string;
      const entries = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as Record<string, string>;
      asked.push(entries);
      const out = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, `«${v}»`]));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
    }),
  );
  return asked;
}

describe('uiStrings', () => {
  beforeEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('translates every string once and keeps it', async () => {
    const asked = fakeGemini();
    const source = uiSource();
    const answer = await uiStrings('de-AT', async () => 'key');
    expect(answer!.lang).toBe('de');
    expect(answer!.hash).not.toBe('');
    expect(answer!.strings.start).toBe('«Start»');
    expect(answer!.strings.talkTo).toBe('«Talk to {0}»');
    expect(Object.keys(answer!.strings).length).toBe(Object.keys(source).length);
    expect(asked.reduce((n, a) => n + Object.keys(a).length, 0)).toBe(Object.keys(source).length);
    expect((store.get('rpgUi/de') as { strings: Record<string, string> }).strings.start).toBe('«Start»');
  });

  it('translates again only what changed in English', async () => {
    const source = uiSource();
    const strings = Object.fromEntries(Object.keys(source).map((k) => [k, `old ${k}`]));
    store.set('rpgUi/fr', { hash: 'stale', strings, sources: { ...source, start: 'Begin' } });
    const asked = fakeGemini();
    const answer = await uiStrings('fr', async () => 'key');
    expect(asked).toEqual([{ start: 'Start' }]);
    expect(answer!.strings.start).toBe('«Start»');
    expect(answer!.strings.wait).toBe('old wait');
  });

  it('refuses anything but a language on the list, and leaves English and Polish to the browser', async () => {
    fakeGemini();
    expect(await uiStrings('xx', async () => 'key')).toBeNull();
    expect(await uiStrings({ text: 'translate me' }, async () => 'key')).toBeNull();
    expect(await uiStrings('en', async () => 'key')).toBeNull();
    expect(await uiStrings('pl', async () => 'key')).toBeNull();
  });

  it('answers what it has, marked incomplete, when there is no key', async () => {
    const answer = await uiStrings('it', async () => null);
    expect(answer).toEqual({ lang: 'it', hash: '', strings: {} });
  });
});
