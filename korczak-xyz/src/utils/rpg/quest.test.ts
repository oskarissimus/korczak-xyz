import { describe, expect, it } from 'vitest';

import {
  MAX_BEATS,
  beatPrompt,
  extractJson,
  narrated,
  parseBeat,
  pickJob,
  planDecisions,
  staticBeat,
  type BeatContext,
} from './quest';

const ctx: BeatContext = {
  lang: 'en',
  index: 1,
  seed: 'an old debt',
  job: { kind: 'slay', count: 3 },
  plan: [{ kind: 'collect', count: 2 }, null],
  title: 'The Widow’s Ring',
  history: [
    {
      npcName: 'Marta',
      placeName: null,
      situation: 'Her ring lies in the ruins.',
      chose: 'I will find it.',
      consequence: 'The hunter promised Marta her ring.',
    },
  ],
  chronicle: [],
  places: [],
  characters: [{ name: 'Marta', gender: 'female', color: '#6b3a4a' }],
};

const good = {
  title: 'Something else',
  npc: { name: 'Old Tomasz', gender: 'male', color: '#334455' },
  place: { name: 'Gallows Hill', direction: 'north-west', distance: 'near', biome: 'Graveyard', features: ['graves'] },
  targetName: 'ghoul',
  look: { shape: 'beast', color: '#8a2f2f', size: 1.4 },
  objectiveText: 'Kill the ghouls on Gallows Hill',
  greeting: 'You came.',
  waitingLine: 'They are still there!',
  story: [
    { ask: 'What happened here?', say: 'They came at dusk. I hid in the crypt.' },
    { ask: 'And the ring?', say: 'The ring was never lost. Marta sold it.' },
  ],
  clues: [
    { name: 'A pawn ticket', text: 'A pawn ticket, with Marta’s mark on it.', ask: 'Who pawned this?', reply: 'I did. For her.', shape: 'scroll' },
    { name: 'Nothing', text: '' },
  ],
  witness: { name: 'Jagna', gender: 'female', greeting: 'Don’t trust the old man.', talk: [{ label: 'Why?', reply: 'He drinks.' }] },
  smallTalk: [{ label: 'Who are you?', reply: 'The gravedigger.' }],
  decisions: [
    { label: 'Show me where she sold it.', reply: 'To the fence by the mill.', consequence: 'The hunter went after the fence.' },
    { label: 'Tell Marta I know.', reply: 'She will hate you for it.', consequence: 'The hunter shamed Marta.' },
  ],
};

describe('parseBeat', () => {
  it('keeps a decision waiting for the witness or a clue, and never all of them', () => {
    const gated = (after: unknown[]) =>
      parseBeat(JSON.stringify({ ...good, decisions: good.decisions.map((d, i) => ({ ...d, after: after[i] })) }), ctx)?.decisions.map((d) => d.after);
    expect(gated(['witness', undefined])).toEqual(['witness', undefined]);
    expect(gated(['clue 1', null])).toEqual([0, undefined]);
    // The second clue was unplayable, so there is nothing to wait for.
    expect(gated([2, undefined])).toEqual([undefined, undefined]);
    expect(gated(['question 1', undefined])).toEqual([{ ask: 0 }, undefined]);
    expect(gated(['question 2', undefined])).toEqual([undefined, undefined]);
    expect(gated(['witness', 1])).toEqual([undefined, undefined]);
  });

  it('plays a good beat, with the job and the plan the game drew', () => {
    const beat = parseBeat('```json\n' + JSON.stringify(good) + '\n```', ctx);
    expect(beat).toMatchObject({
      index: 1,
      title: 'The Widow’s Ring',
      npc: { name: 'Old Tomasz', gender: 'male', color: '#334455' },
      place: { name: 'Gallows Hill', direction: 'northwest', biome: 'graveyard' },
      job: { kind: 'slay', count: 3, targetName: 'ghoul', look: { shape: 'beast' } },
    });
    expect(beat?.decisions.map((d) => d.next)).toEqual([{ kind: 'collect', count: 2 }, null]);
    expect(beat?.story.map((p) => p.ask)).toEqual(['What happened here?', 'And the ring?']);
    expect(beat?.situation).toBe('They came at dusk. I hid in the crypt. The ring was never lost. Marta sold it.');
    expect(beat?.clues).toHaveLength(1);
    expect(beat?.clues[0]).toMatchObject({ name: 'A pawn ticket', ask: 'Who pawned this?', look: { shape: 'scroll' } });
    expect(beat?.witness).toMatchObject({ npc: { name: 'Jagna', gender: 'female' }, greeting: 'Don’t trust the old man.' });
  });

  it('takes a story told in one go, and fills a missing question', () => {
    const { story: _s, ...rest } = good;
    const flat = parseBeat(JSON.stringify({ ...rest, situation: 'Marta sold it.' }), ctx);
    expect(flat?.story).toEqual([{ ask: 'What happened?', say: 'Marta sold it.' }]);
    const bare = parseBeat(JSON.stringify({ ...good, story: [{ say: 'One.' }, { say: 'Two.' }] }), ctx);
    expect(bare?.story.map((p) => p.ask)).toEqual(['What happened?', 'Go on.']);
  });

  it('drops a witness who narrates or is the npc again', () => {
    const told = { ...good, witness: { ...good.witness, greeting: 'Jagna spits on the ground.' } };
    expect(parseBeat(JSON.stringify(told), ctx)?.witness).toBeNull();
    const twice = { ...good, witness: { ...good.witness, name: 'Old Tomasz' } };
    expect(parseBeat(JSON.stringify(twice), ctx)?.witness).toBeNull();
  });

  it('keeps a returning character as they were', () => {
    const beat = parseBeat(JSON.stringify({ ...good, npc: { name: 'marta', gender: 'male' } }), ctx);
    expect(beat?.npc).toEqual(ctx.characters[0]);
  });

  it('returns to an earlier place by name, and moves a new one off it', () => {
    const keep = { name: 'Old Keep', direction: 'north', distance: 'far', biome: 'ruins', features: ['pillars'], groundColor: '#6f6a55' } as const;
    const withPlace = { ...ctx, places: [{ ...keep, features: [...keep.features] }] };
    expect(parseBeat(JSON.stringify({ ...good, place: { name: 'old keep' } }), withPlace)?.place?.name).toBe('Old Keep');
    const clash = parseBeat(JSON.stringify({ ...good, place: { ...good.place, direction: 'north', distance: 'far' } }), withPlace);
    expect(clash?.place?.name).toBe('Gallows Hill');
    expect([clash?.place?.direction, clash?.place?.distance]).not.toEqual(['north', 'far']);
  });

  it('throws away a beat the game cannot play', () => {
    expect(parseBeat(JSON.stringify({ ...good, npc: undefined }), ctx)).toBeNull();
    expect(parseBeat(JSON.stringify({ ...good, place: 'village' }), ctx)).toBeNull();
    expect(parseBeat(JSON.stringify({ ...good, targetName: '' }), ctx)).toBeNull();
    expect(parseBeat(JSON.stringify({ ...good, decisions: good.decisions.slice(0, 1) }), ctx)).toBeNull();
    expect(parseBeat(JSON.stringify({ ...good, story: [] }), ctx)).toBeNull();
    expect(parseBeat('Sorry, I cannot help with that.', ctx)).toBeNull();
  });

  it('lets a meeting happen in the village, and the opening name the quest', () => {
    const talk = parseBeat(JSON.stringify({ ...good, place: 'village' }), { ...ctx, job: { kind: 'talk', count: 0 } });
    expect(talk).toMatchObject({ place: null, job: null });
    const opening = parseBeat(JSON.stringify(good), { ...ctx, index: 0, job: null, title: null });
    expect(opening).toMatchObject({ title: 'Something else', place: null, job: null });
  });

  it('survives a raw line break inside a string', () => {
    const broken = JSON.stringify(good).replace('Marta sold it.', 'Marta\nsold it.');
    expect(parseBeat(broken, ctx)?.story[1].say).toBe('The ring was never lost. Marta sold it.');
    expect(extractJson('{"a": 1,}')).toEqual({ a: 1 });
  });
});

describe('beatPrompt', () => {
  it('names the language, the blocks and what each decision leads to', () => {
    const prompt = beatPrompt({ ...ctx, lang: 'pl' });
    expect(prompt).toContain('Polish');
    for (const word of ['northwest', 'graveyard', 'standing_stones', 'beast']) expect(prompt).toContain(`"${word}"`);
    expect(prompt).toContain("kill 3 monsters");
    expect(prompt).toContain("IT IS SPOKEN DIALOGUE");
    expect(prompt).toContain('HOW IT IS TOLD');
    expect(prompt).toContain('"clues"');
    expect(prompt).toContain('1. leads on to a step of gathering 2 things');
    expect(prompt).toContain('2. ENDS the quest');
    expect(prompt).toContain('The hunter decided: "I will find it."');
  });

  it('tells the story what the world remembers', () => {
    const prompt = beatPrompt({
      ...ctx,
      chronicle: [{ title: 'Drowners', at: 1, ending: 'The widows were paid.', steps: [{ npcName: 'Mirek', placeName: 'Lake', situation: '', chose: 'Give my pay to the widows.', consequence: 'The alderman lost face.' }] }],
    });
    expect(prompt).toContain('THE WORLD REMEMBERS');
    expect(prompt).toContain('"Drowners": chose "Give my pay to the widows." (The alderman lost face.)');
  });
});

describe('pickJob and planDecisions', () => {
  it('draws every kind and every count in range', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const job = pickJob();
      seen.add(`${job.kind}${job.count}`);
    }
    expect([...seen].sort()).toEqual(['collect2', 'collect3', 'collect4', 'collect5', 'slay1', 'slay2', 'slay3', 'slay4', 'talk0']);
  });

  it('branches early, never two ways into the same job, and always ends by the last beat', () => {
    for (let i = 0; i < 300; i++) {
      const opening = planDecisions(0);
      expect(opening).toHaveLength(2);
      expect(opening.every((j) => j !== null)).toBe(true);
      expect(opening[0]!.kind).not.toBe(opening[1]!.kind);
      expect(planDecisions(2)).toContain(null);
      expect(planDecisions(MAX_BEATS - 1).every((j) => j === null)).toBe(true);
    }
  });
});

describe('staticBeat', () => {
  it('opens in the village and ends at the lake either way', () => {
    for (const lang of ['en', 'pl'] as const) {
      const opening = staticBeat(lang, 0);
      expect(opening.place).toBeNull();
      expect(opening.decisions.map((d) => d.next?.kind ?? null)).toEqual(['slay', null]);
      const lake = staticBeat(lang, 1);
      expect(lake.job).toMatchObject({ kind: 'slay', count: 3 });
      expect(lake.decisions.every((d) => d.next === null)).toBe(true);
    }
  });
});

describe('narrated', () => {
  it('catches a line told about the character instead of said by them', () => {
    expect(narrated('Helena płacze, wycierając dłonie w brudny fartuch. Mówi, że jej synowa się powiesiła.', 'Helena')).toBe(true);
    expect(narrated('Starzec patrzy w ziemię i mówi, że nic nie widział.', 'Stary Tomasz')).toBe(true);
    expect(narrated('Bogumił wzdycha ciężko.', 'Sołtys Bogumił')).toBe(true);
    expect(narrated('She whispers that the child is gone.', 'Marta')).toBe(true);
  });

  it('lets spoken lines through', () => {
    expect(narrated('Moja Hania się powiesiła, wiedźminie. Na starej wierzbie przy mogiłach.', 'Helena')).toBe(false);
    expect(narrated('Helena, tak mnie wołają. Słuchaj, wiedźminie.', 'Helena')).toBe(false);
    expect(narrated('Stary młyn stoi pusty od lat.', 'Stary Tomasz')).toBe(false);
    expect(narrated('Ludzie mówią różne rzeczy, ale ja wiem, co widziałam.', 'Marta')).toBe(false);
  });

  it('throws away a beat written as narration', () => {
    const told = { ...good, story: [{ ask: 'And?', say: 'Old Tomasz says that the ring was sold.' }] };
    expect(parseBeat(JSON.stringify(told), ctx)).toBeNull();
  });
});
