import { describe, expect, it } from 'vitest';

import { beatPrompt, isDead, jobDone, parseBeat, slainBy, type Beat, type BeatContext } from './quest';
import { deadInSave, mendSave, type SavedGame } from './save';

// The quest that found this (Oct 2026): a ronin killed as a step's single foe came back as the last
// step's npc, and a brother said to be dead came back as its witness.
const ctx: BeatContext = {
  lang: 'pl',
  index: 3,
  seed: 'a feud between two families',
  job: { kind: 'collect', count: 3 },
  plan: [null, null],
  title: 'Hańba w Błocie',
  history: [
    {
      npcName: 'Emi',
      placeName: 'Bambusowe Zgliszcza',
      situation: 'Takeda nie zniszczył daniny z kaprysu.',
      chose: 'Wytropię i zniszczę obóz Krwawego Ogara.',
      consequence: 'Bohater uderzy na obóz.',
      done: 'killed Ronin Takeda',
    },
  ],
  chronicle: [],
  places: [],
  characters: [
    { name: 'Emi', gender: 'female', color: '#4a5a40' },
    { name: 'Takeda', gender: 'male', color: '#4a0e17' },
  ],
  dead: ['Ronin Takeda', 'Kenji'],
};

const answer = (npc: string, witness: string | null, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'Hańba w Błocie',
    npc: { name: npc, gender: 'male' },
    place: { name: 'Wąwóz', direction: 'south', distance: 'near', biome: 'rocky_hills', features: ['rocks'] },
    targetName: 'kopczyk',
    look: { shape: 'chest', color: '#555555', size: 0.8 },
    greeting: 'Masz proch?',
    story: [{ ask: 'Co teraz?', say: 'Ogar idzie.' }],
    witness: witness ? { name: witness, gender: 'male', greeting: 'Stój!', talk: [] } : null,
    decisions: [
      { label: 'Wysadzę proch.', reply: 'Niech tak będzie.', consequence: 'Wąwóz runął.', dies: ['Kuro', 7, ''] },
      { label: 'Odchodzę.', reply: 'Idź.', consequence: 'Odszedł.' },
    ],
    ...extra,
  });

describe('the dead', () => {
  it('matches a name inside a longer one, either way round', () => {
    expect(isDead('Takeda', ['Ronin Takeda'])).toBe(true);
    expect(isDead('Ronin Takeda', ['Takeda'])).toBe(true);
    expect(isDead('kenji', ['Kenji'])).toBe(true);
    expect(isDead('Kenjiro', ['Kenji'])).toBe(false);
    expect(isDead('Emi', ['Ronin Takeda', 'Kenji'])).toBe(false);
    expect(isDead('Takeda', undefined)).toBe(false);
  });

  it('records what a job did, and whom it killed by name', () => {
    const one = { kind: 'slay' as const, count: 1, targetName: 'Ronin Takeda', look: { shape: 'humanoid' as const, color: '#000000', size: 1.6 } };
    expect(jobDone(one)).toBe('killed Ronin Takeda');
    expect(slainBy(one)).toBe('Ronin Takeda');
    expect(jobDone({ ...one, count: 4, targetName: 'bandyta' })).toBe('killed 4 × bandyta');
    expect(slainBy({ ...one, count: 4 })).toBeNull();
    expect(slainBy({ ...one, kind: 'collect' })).toBeNull();
    expect(jobDone(null)).toBeNull();
  });

  it('tells the model who is dead, keeps them off the list of the living, and says what was done', () => {
    const prompt = beatPrompt(ctx);
    expect(prompt).toContain('THE DEAD: "Ronin Takeda", "Kenji"');
    expect(prompt).toMatch(/PEOPLE ALREADY IN THIS WORLD[^\n]*"Emi"/);
    expect(prompt).not.toMatch(/PEOPLE ALREADY IN THIS WORLD[^\n]*"Takeda"/);
    expect(prompt).toContain('At Bambusowe Zgliszcza, where the hero killed Ronin Takeda, Emi:');
    expect(prompt).toContain('"dead": [');
    expect(prompt).toContain('"dies": [');
  });

  it('does not play a beat whose npc is dead, and drops a dead witness', () => {
    expect(parseBeat(answer('Takeda', null), ctx)).toBeNull();
    const beat = parseBeat(answer('Kuro', 'Kenji'), ctx);
    expect(beat?.npc.name).toBe('Kuro');
    expect(beat?.witness).toBeNull();
  });

  it('reads who died and who a choice kills, never the people on stage', () => {
    const beat = parseBeat(answer('Kuro', 'Nobu', { dead: ['Kenji', 'Kuro', 'Nobu', 'Ogar'] }), ctx)!;
    expect(beat.dead).toEqual(['Kenji', 'Ogar']);
    expect(beat.decisions[0].dies).toEqual(['Kuro']);
    expect(beat.decisions[1].dies).toBeUndefined();
  });
});

const beat = (index: number, npc: string, job: Beat['job'], next: Beat['decisions'][number]['next']): Beat => ({
  index,
  title: 'Hańba w Błocie',
  npc: { name: npc, gender: 'male', color: '#333333' },
  place: null,
  job,
  objectiveText: '',
  greeting: '',
  story: [{ ask: '?', say: '…' }],
  situation: '…',
  clues: [],
  witness: null,
  waitingLine: '',
  smallTalk: [],
  decisions: [{ label: `go on from ${index}`, reply: '', consequence: '', next }],
});

const ronin = { kind: 'slay' as const, count: 1, targetName: 'Ronin Takeda', look: { shape: 'humanoid' as const, color: '#000000', size: 1.6 } };
const step = (chose: string) => ({ npcName: '', placeName: null, situation: '', chose, consequence: '' });

const save = (beats: Beat[], history: SavedGame['history'], decision: number | null = null): SavedGame => ({
  version: 1,
  at: 0,
  lang: 'pl',
  seed: '',
  static: false,
  beats,
  progress: 0,
  history,
  lastLines: [],
  seen: [0],
  heard: false,
  decision,
});

describe('a save that has the dead walking', () => {
  const beats = [
    beat(0, 'Nobu', null, { kind: 'slay', count: 1 }),
    beat(1, 'Emi', ronin, { kind: 'collect', count: 3 }),
    beat(2, 'Takeda', { ...ronin, kind: 'collect', count: 3, targetName: 'kopczyk' }, null),
  ];
  const history = [step('go on from 0'), step('go on from 1')];

  it('knows its dead from its beats, even from before the list was kept', () => {
    expect(deadInSave(save(beats, history))).toEqual(['Ronin Takeda']);
  });

  it('writes again a step whose npc is dead, from the decision before it', () => {
    const mended = mendSave(save(beats, history), ['Ronin Takeda']);
    expect(mended.beats.map((b) => b.npc.name)).toEqual(['Nobu', 'Emi']);
    expect(mended.decision).toBe(0);
    expect(mended.progress).toBe(1);
    expect(mended.history).toHaveLength(2);
    expect(mended.history[1].done).toBe('killed Ronin Takeda');
  });

  it('leaves a step that was already decided, and one with nobody dead in it', () => {
    const decided = save(beats, [...history, step('go on from 2')], 0);
    expect(mendSave(decided, ['Ronin Takeda']).beats).toHaveLength(3);
    expect(mendSave(save(beats, history), ['Kenji']).beats).toHaveLength(3);
  });
});
