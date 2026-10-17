import { describe, expect, it } from 'vitest';

import { extractJson, parseQuest, questPrompt, staticQuest } from './quest';

const good = {
  title: 'The Widow’s Ring',
  npcName: 'Marta',
  greeting: 'Hunter.',
  pitch: 'My husband’s ring lies in the ruins.',
  smallTalk: [{ label: 'Who are you?', reply: 'A widow.' }, { label: 7, reply: 'dropped' }],
  acceptLine: 'Go.',
  declineLine: 'Then go away.',
  waitingLine: 'Well?',
  completeLine: 'Thank you.',
  objectiveText: 'Find the relics in the ruins',
  location: 'ruins',
  kind: 'collect',
  targetName: 'relic',
  count: 4,
};

describe('parseQuest', () => {
  it('reads a well-formed answer, fenced or not', () => {
    const quest = parseQuest('```json\n' + JSON.stringify(good) + '\n```', 'en');
    expect(quest?.location).toBe('ruins');
    expect(quest?.kind).toBe('collect');
    expect(quest?.count).toBe(4);
    expect(quest?.smallTalk).toEqual([{ label: 'Who are you?', reply: 'A widow.' }]);
  });

  it('reads the quest giver as male unless the model says female', () => {
    expect(parseQuest(JSON.stringify(good), 'en')?.npcGender).toBe('male');
    expect(parseQuest(JSON.stringify({ ...good, npcGender: 'female' }), 'en')?.npcGender).toBe('female');
  });

  it('refuses a place the world does not have', () => {
    expect(parseQuest(JSON.stringify({ ...good, location: 'mountains' }), 'en')).toBeNull();
  });

  it('refuses an objective the engine cannot play', () => {
    expect(parseQuest(JSON.stringify({ ...good, kind: 'escort' }), 'en')).toBeNull();
    expect(parseQuest(JSON.stringify({ ...good, count: 'three' }), 'en')).toBeNull();
    expect(parseQuest(JSON.stringify({ ...good, count: null }), 'en')).toBeNull();
  });

  it('forgives a count written as a string and a capitalised place', () => {
    const quest = parseQuest(JSON.stringify({ ...good, count: '3', location: 'Ruins ', kind: 'Slay' }), 'en');
    expect(quest).toMatchObject({ count: 3, location: 'ruins', kind: 'slay' });
  });

  it('clamps the count and fills missing lines from the hand-written quest', () => {
    const { acceptLine: _, ...rest } = good;
    const quest = parseQuest(JSON.stringify({ ...rest, count: 40 }), 'pl');
    expect(quest?.count).toBe(5);
    expect(quest?.acceptLine).toBe(staticQuest('pl').acceptLine);
  });

  it('repairs a raw line break in a string and a trailing comma', () => {
    const broken = JSON.stringify(good).replace('lies in the ruins.', 'lies\nin the ruins.').replace(/}$/, ',}');
    expect(parseQuest(broken, 'en')?.pitch).toBe('My husband’s ring lies in the ruins.');
  });

  it('answers null to prose', () => {
    expect(parseQuest('Sorry, I cannot help with that.', 'en')).toBeNull();
    expect(extractJson('{ not json }')).toBeNull();
  });
});

describe('questPrompt', () => {
  it('names the language and every place', () => {
    const prompt = questPrompt('pl', 'an old debt');
    expect(prompt).toContain('Polish');
    for (const place of ['ruins', 'forest', 'lake']) expect(prompt).toContain(`"${place}"`);
  });
});
