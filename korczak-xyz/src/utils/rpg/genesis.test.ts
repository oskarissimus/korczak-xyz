import { describe, expect, it } from 'vitest';

import {
  CLASSIC_LOOK,
  clampExotic,
  DEFAULT_EXOTIC,
  demoGenesis,
  demoWorld,
  franchised,
  genesisPrompt,
  genesisTemperature,
  lift,
  parseLook,
  parseWorlds,
  pickWorld,
  typicalityTarget,
} from './genesis';

const ctx = { lang: 'pl' as const, seeds: ['lighthouse', 'fermentation', 'Battle of Lützen (1632)'], avoid: ['Kraina Mgieł: a foggy marsh'], exotic: 100 };

const candidate = (name: string, typicality: number, extra: Record<string, unknown> = {}) => ({
  name,
  typicality,
  pitch: 'Lighthouses that brew the fog the ships need.',
  tone: 'wry',
  tech: 'clockwork lenses',
  climate: 'damp',
  people: 'brewers in cork armour',
  architecture: 'stone towers',
  threats: 'fog eels',
  player: 'a lamp inspector',
  address: 'inspektorze',
  hub: 'Latarnia Zero',
  words: ['zaczyn', 'snop'],
  look: { sky: '#223344', fog: '#556677', time: 'night', weather: 'spores', flora: 'fungi', water: 'flooded', growth: 'sparse' },
  ...extra,
});

describe('genesisPrompt', () => {
  it('carries the seeds, the worlds to avoid and the language, and asks for candidates', () => {
    const prompt = genesisPrompt(ctx);
    expect(prompt).toContain('"lighthouse", "fermentation", "Battle of Lützen (1632)"');
    expect(prompt).toContain('- Kraina Mgieł: a foggy marsh');
    expect(prompt).toContain('Polish');
    expect(prompt).toContain('4 CANDIDATE worlds');
    expect(prompt).toContain('"typicality"');
    for (const word of ['fungi', 'spires', 'flooded', 'sparks']) expect(prompt).toContain(`"${word}"`);
  });

  it("takes the player's own words at their word, not as dice to transform", () => {
    const prompt = genesisPrompt({ ...ctx, seeds: ['kapelusz', 'piasek', 'rewolwer'], chosen: true, exotic: 10 });
    expect(prompt).toContain('WORDS THE PLAYER CHOSE: "kapelusz", "piasek", "rewolwer"');
    expect(prompt).not.toContain('drawn at random by dice');
    expect(prompt).not.toContain('never literal');
    expect(prompt).toContain('well-loved version');
    expect(prompt).toContain('4 CANDIDATE worlds');
  });

  it('makes a description the premise, with the slider for how far to take it', () => {
    const wish = 'Miasto na grzbiecie żółwia, który od stu lat śpi';
    const prompt = genesisPrompt({ ...ctx, seeds: [], wish, exotic: 90 });
    expect(prompt).toContain(`---\n${wish}\n---`);
    expect(prompt).toContain('This is the premise');
    expect(prompt).toContain('far from its stock version');
    expect(prompt).not.toContain('SEEDS');
    // Dice seeds beside a wish are flavour only.
    expect(genesisPrompt({ ...ctx, wish })).toContain('Use them only as small flavour, if at all');
  });
});

describe('parseWorlds', () => {
  it('reads every playable candidate and drops one borrowing a franchise', () => {
    const reply = JSON.stringify({
      worlds: [candidate('Latarnie', 12), candidate('Szkoła w Hogwarcie', 5), candidate('Zwykły zamek', 90), { name: 'No hub' }],
    });
    const worlds = parseWorlds(reply, ctx, 1000);
    expect(worlds.map((w) => w.name)).toEqual(['Latarnie', 'Zwykły zamek']);
    expect(worlds[0]).toMatchObject({ lang: 'pl', seeds: ctx.seeds, typicality: 12, hub: 'Latarnia Zero', address: 'inspektorze' });
    expect(worlds[0].look).toMatchObject({ sky: '#223344', time: 'night', weather: 'spores', flora: 'fungi', water: 'flooded' });
    // What the model left out is the classic look's.
    expect(worlds[0].look.wall).toBe(CLASSIC_LOOK.wall);
    expect(new Set(worlds.map((w) => w.id)).size).toBe(2);
  });

  it('tolerates a fence and a single world without the list', () => {
    expect(parseWorlds('```json\n' + JSON.stringify(candidate('Sam', 30)) + '\n```', ctx)).toHaveLength(1);
    expect(parseWorlds('no json here', ctx)).toEqual([]);
  });
});

describe('pickWorld', () => {
  it('picks one of the two least typical, by the dice', () => {
    const worlds = parseWorlds(JSON.stringify({ worlds: [candidate('A', 70), candidate('B', 10), candidate('C', 40), candidate('D', 95)] }), ctx);
    expect(pickWorld(worlds, 0, () => 0)?.name).toBe('B');
    expect(pickWorld(worlds, 0, () => 0.99)?.name).toBe('C');
    expect(pickWorld([])).toBeNull();
  });

  it('picks near the slider’s target', () => {
    const worlds = parseWorlds(JSON.stringify({ worlds: [candidate('A', 70), candidate('B', 10), candidate('C', 40), candidate('D', 95)] }), ctx);
    expect(pickWorld(worlds, typicalityTarget(0), () => 0)?.name).toBe('D');
    expect(pickWorld(worlds, typicalityTarget(0), () => 0.99)?.name).toBe('A');
  });
});

describe('the exotic slider', () => {
  it('turns the prompt, the target and the temperature from familiar to anything', () => {
    const familiar = genesisPrompt({ ...ctx, exotic: 0 });
    const twisted = genesisPrompt({ ...ctx, exotic: 50 });
    const exotic = genesisPrompt({ ...ctx, exotic: 100 });
    expect(familiar).toMatch(/classic RPGs/);
    expect(familiar).toMatch(/elves, dwarves/);
    expect(familiar).not.toMatch(/Stay away from the clichés/);
    expect(twisted).toMatch(/ONE strong unusual twist/);
    expect(exotic).toMatch(/Stay away from the clichés/);
    expect(familiar).toMatch(/Aim them around 85/);
    expect(exotic).toMatch(/Aim them around 5\b/);
    expect(genesisTemperature(0)).toBe(0.9);
    expect(genesisTemperature(100)).toBe(1.35);
    expect(clampExotic('nope')).toBe(DEFAULT_EXOTIC);
    expect(clampExotic(250)).toBe(100);
    expect(demoGenesis({ seeds: ['a'], exotic: 12.4 }).exotic).toBe(12);
  });
});

describe('parseLook', () => {
  it('keeps known words and colours and falls back on the rest', () => {
    const look = parseLook({ sky: 'blue', time: 'NIGHT', weather: 'lava', flora: 'spires' });
    expect(look.sky).toBe(CLASSIC_LOOK.sky);
    expect(look.time).toBe('night');
    expect(look.weather).toBe('none');
    expect(look.flora).toBe('spires');
  });
});

describe('franchised', () => {
  it('catches the names a model reaches for by reflex', () => {
    expect(franchised('Akademia jak Hogwart')).toBe(true);
    expect(franchised('a WITCHER for hire')).toBe(true);
    expect(franchised('Salt rakers of the glass flat')).toBe(false);
  });
});

describe('the demo', () => {
  it('cuts a stranger’s world and genesis to what the game sends', () => {
    const w = demoWorld({ ...candidate('X'.repeat(500), 1), words: Array(20).fill('słowo') });
    expect(w?.name).toHaveLength(60);
    expect(w?.words).toHaveLength(6);
    expect(demoWorld({ name: 'no player' })).toBeUndefined();
    const g = demoGenesis({ lang: 'xx', seeds: ['a'.repeat(300), 'b', 'c', 'd', 'e', 'f', 'g', 'h'], avoid: 'nope', chosen: 'yes' });
    expect(g.lang).toBe('en');
    expect(g.seeds).toHaveLength(6);
    expect(g.chosen).toBe(false);
    expect(g.wish).toBeUndefined();
    expect(demoGenesis({ wish: `  ${'w'.repeat(900)}`, chosen: true })).toMatchObject({ chosen: true, wish: expect.stringMatching(/^w{598}$/) });
    expect(g.seeds[0]).toHaveLength(80);
    expect(g.avoid).toEqual([]);
  });
});

describe('lift', () => {
  it('brings a black world up to something visible and keeps hues', () => {
    expect(lift('#000000', 0.3)).toBe('#4d4d4d');
    expect(parseLook({ ground: '#000000' }).ground).toBe('#737373');
    expect(lift('#100008', 0.5)).toBe('#800040');
    expect(lift('#ffeedd', 0.3)).toBe('#ffeedd');
  });

  it('leaves the classic look as it is', () => {
    expect(parseLook(CLASSIC_LOOK)).toEqual(CLASSIC_LOOK);
  });
});
