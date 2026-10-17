import { describe, expect, it } from 'vitest';

import { extractJson, parseQuest, pickJob, questPrompt, staticQuest } from './quest';

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
  place: { name: 'The Drowned Chapel', direction: 'North-West', distance: 'near', biome: 'graveyard', features: ['graves', 'nonsense'] },
  kind: 'collect',
  look: { shape: 'skull', color: '#AABBCC', size: 9 },
  targetName: 'relic',
  count: 4,
};

describe('parseQuest', () => {
  it('reads a well-formed answer, fenced or not', () => {
    const quest = parseQuest('```json\n' + JSON.stringify(good) + '\n```', 'en');
    expect(quest?.place).toEqual({
      name: 'The Drowned Chapel',
      direction: 'northwest',
      distance: 'near',
      biome: 'graveyard',
      features: ['graves'],
      groundColor: '#4b4a3c',
    });
    expect(quest?.look).toEqual({ shape: 'skull', color: '#aabbcc', size: 2 });
    expect(quest?.kind).toBe('collect');
    expect(quest?.count).toBe(4);
    expect(quest?.smallTalk).toEqual([{ label: 'Who are you?', reply: 'A widow.' }]);
  });

  it('reads the quest giver as male unless the model says female', () => {
    expect(parseQuest(JSON.stringify(good), 'en')?.npcGender).toBe('male');
    expect(parseQuest(JSON.stringify({ ...good, npcGender: 'female' }), 'en')?.npcGender).toBe('female');
  });

  it('refuses a place the world does not have', () => {
    expect(parseQuest(JSON.stringify({ ...good, place: { ...good.place, biome: 'volcano' } }), 'en')).toBeNull();
    expect(parseQuest(JSON.stringify({ ...good, place: { ...good.place, direction: 'up' } }), 'en')).toBeNull();
    expect(parseQuest(JSON.stringify({ ...good, place: undefined }), 'en')).toBeNull();
  });

  it('refuses an objective the engine cannot play', () => {
    expect(parseQuest(JSON.stringify({ ...good, kind: 'escort' }), 'en')).toBeNull();
    expect(parseQuest(JSON.stringify({ ...good, count: 'three' }), 'en')).toBeNull();
    expect(parseQuest(JSON.stringify({ ...good, count: null }), 'en')).toBeNull();
  });

  it('forgives a count written as a string and a capitalised place', () => {
    const quest = parseQuest(JSON.stringify({ ...good, count: '3', kind: 'Slay' }), 'en');
    expect(quest).toMatchObject({ count: 3, kind: 'slay' });
    // A skull cannot be slain: the look falls back to a shape the objective can use.
    expect(quest?.look.shape).toBe('humanoid');
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
    const prompt = questPrompt('pl', 'an old debt', { kind: 'slay', count: 2 });
    expect(prompt).toContain('Polish');
    for (const word of ['northwest', 'graveyard', 'standing_stones', 'beast']) {
      expect(prompt).toContain(`"${word}"`);
    }
  });

  it('hands over the job instead of offering a choice', () => {
    const prompt = questPrompt('en', 'an old debt', { kind: 'collect', count: 5 });
    expect(prompt).toContain('"kind": "collect"');
    expect(prompt).toContain('"count": 5');
    expect(prompt).toContain('"scroll"');
    expect(prompt).not.toContain('"humanoid"');
    expect(questPrompt('en', 'x', { kind: 'slay', count: 1 })).toContain('single dangerous creature');
  });
});

describe('pickJob', () => {
  it('draws both kinds and every count in range', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const job = pickJob();
      seen.add(`${job.kind}${job.count}`);
      expect(job.count).toBeGreaterThanOrEqual(job.kind === 'slay' ? 1 : 2);
      expect(job.count).toBeLessThanOrEqual(job.kind === 'slay' ? 4 : 5);
    }
    expect([...seen].sort()).toEqual(['collect2', 'collect3', 'collect4', 'collect5', 'slay1', 'slay2', 'slay3', 'slay4']);
  });

  it('stays in range at the edges of the random number', () => {
    expect(pickJob(() => 0)).toEqual({ kind: 'slay', count: 1 });
    expect(pickJob(() => 0.9999999)).toEqual({ kind: 'collect', count: 5 });
  });
});

describe('parseQuest with a job', () => {
  it('keeps the drawn kind and count whatever the model wrote', () => {
    const quest = parseQuest(JSON.stringify({ ...good, kind: 'collect', count: 3 }), 'en', { kind: 'slay', count: 4 });
    expect(quest).toMatchObject({ kind: 'slay', count: 4 });
    expect(['humanoid', 'beast', 'blob']).toContain(quest?.look.shape);
  });

  it('does not need the model to repeat them', () => {
    const { kind: _k, count: _c, ...rest } = good;
    expect(parseQuest(JSON.stringify(rest), 'en', { kind: 'collect', count: 2 })).toMatchObject({ kind: 'collect', count: 2 });
  });
});
