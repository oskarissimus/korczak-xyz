import { describe, expect, it } from 'vitest';

import { demoContext } from './demoLimits';
import { freePrompt } from './freeLine';
import {
  ARCHETYPES,
  MBTI_TYPES,
  drawPersona,
  drawPersonas,
  letterDistance,
  parsePersona,
  personaLabel,
  personaWords,
  type Persona,
} from './persona';
import { beatPrompt, parseBeat, staticBeat, type BeatContext } from './quest';

const npc: Persona = { mbti: 'ENTP', archetype: 'jester' };
const witness: Persona = { mbti: 'ISFJ' };

const ctx: BeatContext = {
  lang: 'en',
  index: 0,
  seed: 'an old debt',
  job: null,
  plan: [{ kind: 'collect', count: 2 }, { kind: 'talk', count: 0 }],
  title: null,
  history: [],
  chronicle: [],
  places: [],
  characters: [
    { name: 'Marta', gender: 'female', color: '#6b3a4a' },
    { name: 'Ronin Takeda', gender: 'male', color: '#334455', persona: { mbti: 'INTJ', archetype: 'ruler' } },
  ],
  personas: { npc, witness },
};

const reply = (who = 'Old Tomasz', seen = 'Jagna') =>
  JSON.stringify({
    title: 'The Ring',
    npc: { name: who, gender: 'male', color: '#334455' },
    place: 'village',
    objectiveText: 'Find the ring',
    greeting: 'You came.',
    story: [{ ask: 'What happened?', say: 'They came at dusk.' }],
    witness: { name: seen, gender: 'female', greeting: 'Don’t trust him.', talk: [] },
    decisions: [
      { label: 'I will look.', reply: 'Go then.', consequence: 'The hero went looking.' },
      { label: 'I will ask around.', reply: 'Ask Jagna.', consequence: 'The hero asked around.' },
    ],
  });

describe('drawPersonas', () => {
  it('draws every type and every archetype, and leaves some without an archetype', () => {
    const types = new Set<string>();
    const archetypes = new Set<string>();
    let bare = 0;
    for (let i = 0; i < 3000; i++) {
      const p = drawPersona();
      types.add(p.mbti);
      if (p.archetype) archetypes.add(p.archetype);
      else bare++;
    }
    expect(types.size).toBe(MBTI_TYPES.length);
    expect(archetypes.size).toBe(ARCHETYPES.length);
    expect(bare).toBeGreaterThan(600);
    expect(bare).toBeLessThan(1500);
  });

  it('never gives the witness a type within a letter of the npc’s, nor the same archetype', () => {
    for (let i = 0; i < 2000; i++) {
      const { npc: a, witness: b } = drawPersonas();
      expect(letterDistance(a.mbti, b.mbti)).toBeGreaterThanOrEqual(2);
      if (a.archetype) expect(b.archetype).not.toBe(a.archetype);
    }
  });
});

describe('parsePersona', () => {
  it('reads what it wrote, forgivingly, and refuses anything else', () => {
    expect(parsePersona({ mbti: 'entp ', archetype: 'Jester' })).toEqual(npc);
    expect(parsePersona({ mbti: 'ISFJ', archetype: 'wizard' })).toEqual({ mbti: 'ISFJ' });
    expect(parsePersona({ mbti: 'XXXX' })).toBeNull();
    expect(parsePersona('ENTP')).toBeNull();
  });
});

describe('the persona in the game', () => {
  it('is told to the model for the new npc and witness, and with the people already met', () => {
    const prompt = beatPrompt(ctx);
    expect(prompt).toContain(`a NEW npc is ${personaWords(npc)}`);
    expect(prompt).toContain(`a NEW witness is ${personaWords(witness)}`);
    expect(prompt).toContain(`"Ronin Takeda" (${personaWords(ctx.characters[1].persona!)})`);
    expect(prompt).toContain('never named');
    expect(beatPrompt({ ...ctx, personas: undefined })).not.toContain('WHO THEY ARE');
  });

  it('is given to whoever the beat brings in new, and to someone met before types, once', () => {
    const beat = parseBeat(reply(), ctx)!;
    expect(beat.npc.persona).toEqual(npc);
    expect(beat.witness?.npc.persona).toEqual(witness);
    expect(parseBeat(reply('marta'), ctx)!.npc).toEqual({ ...ctx.characters[0], persona: npc });
    expect(parseBeat(reply('Old Tomasz', 'Ronin Takeda'), ctx)!.witness?.npc).toEqual(ctx.characters[1]);
    expect(parseBeat(reply(), { ...ctx, personas: undefined })!.npc.persona).toBeUndefined();
  });

  it('crosses to the demo’s function with the context', () => {
    const back = demoContext(JSON.parse(JSON.stringify(ctx)));
    expect(back.personas).toEqual({ npc, witness });
    expect(back.characters[1].persona).toEqual(ctx.characters[1].persona);
    expect(demoContext({ ...ctx, personas: { npc } }).personas).toBeUndefined();
  });

  it('is told to the model that answers a typed line', () => {
    const beat = { ...staticBeat('en', 0), npc: { ...staticBeat('en', 0).npc, persona: npc } };
    const prompt = freePrompt({ lang: 'en', beat, history: [], title: null, said: 'Hello?', seen: [], heard: '', characters: [] });
    expect(prompt).toContain(personaWords(npc));
  });

  it('is named in the console in the game’s language', () => {
    expect(personaLabel(npc, 'pl')).toBe('ENTP Dyskutant · Błazen');
    expect(personaLabel(witness, 'en')).toBe('ISFJ Defender');
  });
});
