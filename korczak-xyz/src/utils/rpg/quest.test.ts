import { describe, expect, it } from 'vitest';

import {
  MAX_BEATS,
  beatPrompt,
  extractJson,
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
  situation: 'The ring was never lost. Marta sold it.',
  smallTalk: [{ label: 'Who are you?', reply: 'The gravedigger.' }],
  decisions: [
    { label: 'Show me where she sold it.', reply: 'To the fence by the mill.', consequence: 'The hunter went after the fence.' },
    { label: 'Tell Marta I know.', reply: 'She will hate you for it.', consequence: 'The hunter shamed Marta.' },
  ],
};

describe('parseBeat', () => {
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
    expect(parseBeat(JSON.stringify({ ...good, situation: '' }), ctx)).toBeNull();
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
    expect(parseBeat(broken, ctx)?.situation).toBe('The ring was never lost. Marta sold it.');
    expect(extractJson('{"a": 1,}')).toEqual({ a: 1 });
  });
});

describe('beatPrompt', () => {
  it('names the language, the blocks and what each decision leads to', () => {
    const prompt = beatPrompt({ ...ctx, lang: 'pl' });
    expect(prompt).toContain('Polish');
    for (const word of ['northwest', 'graveyard', 'standing_stones', 'beast']) expect(prompt).toContain(`"${word}"`);
    expect(prompt).toContain('kill 3 monsters');
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
