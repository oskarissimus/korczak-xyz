import { describe, expect, it } from 'vitest';

import {
  MAX_BEATS,
  beatPrompt,
  extractJson,
  heardAside,
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

  it('keeps the English prop of a thing to gather, and of an enemy to slay', () => {
    const reply = JSON.stringify({ ...good, targetName: 'rdzeń', targetProp: 'a cracked green glowing reactor core' });
    expect(parseBeat(reply, { ...ctx, job: { kind: 'collect', count: 2 } })?.job?.prop).toBe('a cracked green glowing reactor core');
    // A slay job's is one of the enemies, made a person when they walk on two legs (`people.ts`).
    expect(parseBeat(reply, ctx)?.job?.prop).toBe('a cracked green glowing reactor core');
  });

  it('keeps how a character looks, in English, and lets someone met before keep their model', () => {
    const look = 'a stooped old woman in a patched green wool dress, grey braid';
    const reply = JSON.stringify({ ...good, npc: { ...good.npc, appearance: look } });
    const beat = parseBeat(reply, ctx);
    expect(beat?.npc.appearance).toBe(look);
    const model = { glb: 'https://fal.media/m.glb', image: 'i', prompt: 'p', costUsd: 0.023, ms: 1, at: 1 };
    const met = parseBeat(reply, { ...ctx, characters: [{ ...beat!.npc, appearance: undefined, model }] });
    expect(met?.npc.model).toEqual(model);
    expect(met?.npc.appearance).toBe(look);
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
    expect(prompt).toContain("defeat 3 hostile foes");
    expect(prompt).toContain("IT IS SPOKEN DIALOGUE");
    expect(prompt).toContain('HOW IT IS TOLD');
    expect(prompt).toContain('"clues"');
    expect(prompt).toContain('1. leads on to a step of gathering 2 things');
    expect(prompt).toContain('2. ENDS the quest');
    expect(prompt).toContain('The hero decided (said to Marta): "I will find it."');
  });

  it('is written in the world it is given, and in no franchise', () => {
    const world = {
      name: 'Sól i Szkło',
      pitch: 'A salt flat under a glass sky.',
      tone: 'quiet',
      tech: 'lenses and wind engines',
      climate: 'dry heat',
      people: 'salt rakers in white veils',
      architecture: 'domes of fused sand',
      threats: 'glass wasps',
      player: 'a lens-grinder for hire',
      address: 'szlifierzu',
      hub: 'Biała Misa',
      words: ['kryza'],
    };
    const prompt = beatPrompt({ ...ctx, index: 0, job: null, world });
    expect(prompt).toContain('THE WORLD: "Sól i Szkło"');
    expect(prompt).toContain('a lens-grinder for hire');
    expect(prompt).toContain('"szlifierzu"');
    expect(prompt).toContain('in Biała Misa');
    expect(prompt).not.toMatch(/witcher|monster hunter|village square/i);
    // Without a world, the classic one: still no franchise named.
    expect(beatPrompt(ctx)).not.toMatch(/witcher/i);
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

describe('going to meet someone', () => {
  // Owner, 28 Oct 2026: Tiago, the witness, said his friend from the tribe knew more; the hero went to
  // find the friend, and found Tiago, because the next beat never heard what Tiago had said.
  const cave = parseBeat(
    JSON.stringify({
      ...good,
      witness: { name: 'Tiago', gender: 'male', greeting: 'You believe them?', talk: [{ label: 'Meaning?', reply: 'My friend from the tribe knows more.' }] },
      decisions: [
        { label: 'I will gather the vines.', reply: 'Go.', consequence: 'Off to the vines.' },
        {
          label: 'I will find the friend Tiago spoke of.',
          reply: 'Fool!',
          consequence: 'The hero went to find the scout.',
          after: 'witness',
          meet: { name: null, who: 'Tiago’s friend from the tribe, a scout on the outskirts' },
        },
      ],
    }),
    { ...ctx, plan: [{ kind: 'collect', count: 2 }, { kind: 'talk', count: 0 }], characters: [...ctx.characters, { name: 'Tiago', gender: 'male', color: '#8b4513' }] },
  )!;

  it('keeps whom a decision sets out to meet, and someone known by their exact name', () => {
    expect(cave.decisions[1].meet).toEqual({ who: 'Tiago’s friend from the tribe, a scout on the outskirts' });
    expect(cave.decisions[0].meet).toBeUndefined();
    const known = parseBeat(
      JSON.stringify({ ...good, decisions: [good.decisions[0], { ...good.decisions[1], meet: { name: 'marta', who: 'the widow' } }] }),
      { ...ctx, plan: [{ kind: 'collect', count: 2 }, { kind: 'talk', count: 0 }] },
    )!;
    expect(known.decisions[1].meet).toEqual({ name: 'Marta', who: 'the widow' });
  });

  it('passes on what the witness said and what was asked, once heard', () => {
    expect(heardAside(cave, false, [])).toBe('');
    const heard = heardAside(cave, true, [0]);
    expect(heard).toContain('Tiago (another person there): You believe them? My friend from the tribe knows more.');
    expect(heard).toContain('asked "Who are you?", Old Tomasz: The gravedigger.');
  });

  const after = (meet: { name?: string; who: string }): BeatContext => ({
    ...ctx,
    index: 2,
    job: { kind: 'talk', count: 0 },
    plan: [null, null],
    characters: [...ctx.characters, { name: 'Old Tomasz', gender: 'male', color: '#334455' }, { name: 'Tiago', gender: 'male', color: '#8b4513' }],
    history: [
      ...ctx.history,
      {
        npcName: 'Old Tomasz',
        placeName: 'Gallows Hill',
        situation: 'They came at dusk.',
        chose: 'I will find the friend Tiago spoke of.',
        consequence: 'The hero went to find the scout.',
        heard: heardAside(cave, true, []),
        witnessName: 'Tiago',
        meet,
      },
    ],
  });

  it('tells the next beat who it is with, and who it is not', () => {
    const prompt = beatPrompt(after({ who: 'Tiago’s friend from the tribe' }));
    expect(prompt).toContain('Also heard there: Tiago (another person there)');
    expect(prompt).toContain('set out to meet: someone NOT met yet: Tiago’s friend from the tribe');
    expect(prompt).toContain('a NEW character with a name of their own. It is not "Old Tomasz" or "Tiago"');
    expect(beatPrompt(after({ name: 'Marta', who: 'the widow' }))).toContain('set out to meet: "Marta" (the widow), with exactly that name');
    expect(beatPrompt(ctx)).toContain('Every decision is said to the npc');
  });

  it('will not play a meeting with someone new that has someone already met waiting there', () => {
    const reply = (name: string) => JSON.stringify({ ...good, place: 'village', npc: { name, gender: 'male' } });
    expect(parseBeat(reply('Tiago'), after({ who: 'Tiago’s friend' }))).toBeNull();
    expect(parseBeat(reply('Itzel'), after({ who: 'Tiago’s friend' }))?.npc.name).toBe('Itzel');
    expect(parseBeat(reply('Tiago'), after({ name: 'Tiago', who: 'the scout' }))?.npc.name).toBe('Tiago');
  });
});
