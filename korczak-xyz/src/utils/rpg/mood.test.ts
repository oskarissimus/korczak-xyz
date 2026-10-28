import { describe, expect, it } from 'vitest';

import { beatPrompt, drawMood, parseBeat, parseMood, seedFor, SEEDS, type BeatContext, type QuestMood } from './quest';
import { demoContext } from './demoLimits';

/** A rand that returns these, in turn. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const opening = (mood?: QuestMood, more: Partial<BeatContext> = {}): BeatContext => ({
  lang: 'en',
  index: 0,
  seed: 'a festival short of one thing',
  job: null,
  plan: [
    { kind: 'collect', count: 2 },
    { kind: 'talk', count: 0 },
  ],
  title: null,
  history: [],
  chronicle: [{ title: 'The Drowned Bell', at: 1, steps: [], ending: 'The bell rang again.' }],
  places: [{ name: 'Gallows Hill', direction: 'north', distance: 'near', biome: 'graveyard', features: ['graves'], groundColor: '#555544' }],
  characters: [{ name: 'Ronin Takeda', gender: 'male', color: '#334455' }],
  dead: ['Marta'],
  ...(mood && { mood }),
  ...more,
});

describe('drawMood', () => {
  it('ties a quest to nothing in a world with no past', () => {
    for (let i = 0; i < 50; i++) expect(drawMood({ places: 0, people: 0 }).tie).toBe('fresh');
  });

  it('leaves most quests their own story, and draws every tone', () => {
    const ties = { fresh: 0, place: 0, person: 0 };
    const tones = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const m = drawMood({ places: 3, people: 5 });
      ties[m.tie] += 1;
      tones.add(m.tone);
    }
    expect(ties.fresh).toBeGreaterThan(1100);
    expect(ties.place).toBeGreaterThan(200);
    expect(ties.person).toBeGreaterThan(150);
    expect([...tones].sort()).toEqual(['adventure', 'comic', 'grim', 'light']);
  });

  it('never ties to a place when there is none', () => {
    expect(drawMood({ places: 0, people: 4 }, seq(0, 0.99)).tie).toBe('person');
  });

  it('is read back from a save, and refused when unknown', () => {
    expect(parseMood({ tone: 'comic', tie: 'place' })).toEqual({ tone: 'comic', tie: 'place' });
    expect(parseMood({ tone: 'tragic', tie: 'place' })).toBeNull();
    expect(parseMood(null)).toBeNull();
  });

  it('gives a grim quest the old seeds and a light one its own', () => {
    expect(SEEDS).toContain(seedFor('grim'));
    expect(SEEDS).not.toContain(seedFor('comic'));
  });
});

describe('the prompt for a mood', () => {
  it('asks a light quest for no dilemma and a grim one for a cost', () => {
    const light = beatPrompt(opening({ tone: 'light', tie: 'fresh' }));
    expect(light).toContain('TONE: light');
    expect(light).toContain('no dilemma');
    expect(light).not.toContain('moral greyness');
    const grim = beatPrompt(opening({ tone: 'grim', tie: 'fresh' }));
    expect(grim).toContain('real choices with a cost');
    expect(grim).toContain('moral greyness');
  });

  it('a comic quest is asked to be funny', () => {
    expect(beatPrompt(opening({ tone: 'comic', tie: 'fresh' }))).toContain('Make the player laugh');
  });

  it('no longer asks every quest to refer to the last ones', () => {
    const p = beatPrompt(opening({ tone: 'adventure', tie: 'fresh' }));
    expect(p).not.toContain('Refer to at least one');
    expect(p).toContain('NOT a sequel');
    expect(p).toContain('do not build on it');
    expect(p).toContain('Someone the hero has not met yet');
  });

  it('a quest tied to a person may bring them back; tied to a place, it passes through one', () => {
    expect(beatPrompt(opening({ tone: 'light', tie: 'person' }))).toContain('one person already met');
    const later = beatPrompt(
      opening({ tone: 'light', tie: 'place' }, { index: 1, job: { kind: 'slay', count: 2 }, plan: [null, null], title: 'X' }),
    );
    expect(later).toContain('pass through one of the places from before it ("Gallows Hill")');
  });

  it('an untied quest may use an old place but is never told to', () => {
    const p = beatPrompt(opening({ tone: 'light', tie: 'fresh' }, { index: 1, job: { kind: 'slay', count: 2 }, plan: [null, null], title: 'X' }));
    expect(p).toContain('never required');
  });

  it('lists every name taken, the dead with the living', () => {
    expect(beatPrompt(opening())).toMatch(/NAMES ALREADY TAKEN: "Ronin Takeda", "Marta"/);
  });

  it('the demo passes the mood through, and drops a bad one', () => {
    const sent = JSON.parse(JSON.stringify(opening({ tone: 'comic', tie: 'person' })));
    expect(demoContext(sent).mood).toEqual({ tone: 'comic', tie: 'person' });
    expect(demoContext({ ...sent, mood: { tone: 'x', tie: 'y' } }).mood).toBeUndefined();
  });
});

describe('a new character with an old name', () => {
  const answer = (npcName: string, witness: string | null = null) =>
    JSON.stringify({
      title: 'A Small Favour',
      npc: { name: npcName, gender: 'female', color: '#aa5533' },
      place: 'village',
      objectiveText: 'Help',
      greeting: 'Oh, good, you.',
      story: [{ ask: 'What is it?', say: 'The cake fell in the well.' }],
      witness: witness ? { name: witness, gender: 'male', greeting: 'It was me.', talk: [] } : null,
      decisions: [
        { label: 'I will fish it out.', reply: 'Thank you!', consequence: 'The hero went for the cake.' },
        { label: 'I will ask the baker.', reply: 'Fine.', consequence: 'The hero went to the baker.' },
      ],
    });

  it('is the person already known, not a second one', () => {
    const beat = parseBeat(answer('Takeda'), opening({ tone: 'light', tie: 'fresh' }));
    expect(beat?.npc.name).toBe('Ronin Takeda');
    expect(beat?.npc.color).toBe('#334455');
  });

  it('a different person keeps their own name', () => {
    expect(parseBeat(answer('Hanna Wick'), opening())?.npc.name).toBe('Hanna Wick');
  });

  it('a witness who would be the npc again is dropped', () => {
    const beat = parseBeat(answer('Ronin Takeda', 'Takeda'), opening());
    expect(beat?.witness).toBeNull();
  });
});
