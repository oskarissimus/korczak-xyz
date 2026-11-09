import { describe, expect, it } from 'vitest';
import { translations } from './translations';
import { cleanTranslation, fill, slices, sourceHash, uiSource, uiTable } from './uiTranslate';

describe('uiSource', () => {
  const source = uiSource();

  it('holds every string, every record entry and a template for each function', () => {
    expect(source.start).toBe('Start');
    expect(source['dieselCanister.can']).toBe('Canister');
    expect(source.talkTo).toBe('Talk to {0}');
    expect(source.devTypical).toBe('usual here: world {0}, opening {1}, ground {2}, 3D model {3}, rig {4}');
    expect(source.menuWorldsCount).toBe('{0} worlds');
  });

  it('leaves out what a placeholder cannot stand for', () => {
    // arithmetic on an argument, an array argument, a function whose words are on the table
    expect(source.devRigs).toBeUndefined();
    expect(source.wishSummary).toBeUndefined();
    expect(source.aiQuest).toBeUndefined();
    expect(source.aiQuestGoogle).toContain('Google');
  });

  it('hashes the same strings the same way, and other strings otherwise', () => {
    expect(sourceHash(source)).toBe(sourceHash({ ...source }));
    expect(sourceHash(source)).not.toBe(sourceHash({ ...source, start: 'Go' }));
  });

  it('slices the source without losing a key', () => {
    const parts = slices(source, 50);
    expect(parts.reduce((n, p) => n + Object.keys(p).length, 0)).toBe(Object.keys(source).length);
  });
});

describe('cleanTranslation', () => {
  const source = { a: 'Talk to {0}', b: 'Start' };
  it('keeps a translation with the same placeholders and drops the rest', () => {
    expect(cleanTranslation(source, { a: 'Sprich mit {0}', b: 'Los', c: 'extra' })).toEqual({ a: 'Sprich mit {0}', b: 'Los' });
    expect(cleanTranslation(source, { a: 'Sprich mit jemandem', b: 7 })).toEqual({});
    expect(cleanTranslation(source, null)).toEqual({});
  });
});

describe('uiTable', () => {
  const t = uiTable({
    start: 'Los',
    talkTo: 'Sprich mit {0}',
    'dieselCanister.can': 'Kanister',
    menuWorldsCount: '{0} Welten',
    aiQuestGoogle: 'Geschichte: Google',
    aiQuestOpenai: 'Geschichte: OpenAI',
    demoClosedIp: 'Budget weg',
  });

  it('puts the translation in place of the English, and keeps the English where there is none', () => {
    expect(t.start).toBe('Los');
    expect(t.wait).toBe(translations.en.wait);
    expect(t.dieselCanister.can).toBe('Kanister');
    expect(t.dieselCanister.barrel).toBe('Barrel');
  });

  it('fills a translated template with the real arguments, plurals included', () => {
    expect(t.talkTo('Elara')).toBe('Sprich mit Elara');
    expect(t.menuWorldsCount(3)).toBe('3 Welten');
    expect(t.menuWorldsCount(1)).toBe('1 Welten');
  });

  it('lets a function that reads the table read the translation', () => {
    expect(t.aiQuest('google')).toBe('Geschichte: Google');
    expect(t.aiQuest('openai')).toBe('Geschichte: OpenAI');
    expect(t.demoClosed('ip-cap')).toBe('Budget weg');
    expect(t.demoClosed('disabled')).toBe(translations.en.demoClosedOff);
  });

  it('leaves an untranslatable function in English', () => {
    expect(t.devRigs(2, 1, '1 s', '2 s')).toBe(translations.en.devRigs(2, 1, '1 s', '2 s'));
    expect(t.wishSummary(['hat'], '')).toBe(translations.en.wishSummary(['hat'], ''));
  });

  it('fills placeholders in order', () => {
    expect(fill('{1} and {0}', ['a', 'b'])).toBe('b and a');
  });
});
