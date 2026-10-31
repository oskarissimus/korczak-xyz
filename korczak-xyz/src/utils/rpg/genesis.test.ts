import { describe, expect, it } from 'vitest';

import {
  CLASSIC_LOOK,
  clampExotic,
  DEFAULT_EXOTIC,
  demoGenesis,
  demoWorld,
  firstObject,
  franchised,
  genesisPrompt,
  genesisTemperature,
  hubSizesPrompt,
  lift,
  parseHubSizes,
  parseLook,
  parseWorlds,
  partialJson,
  pickWorld,
  previewWorld,
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
    expect(prompt).toContain('names the genre at once');
    // Aimed nearer the familiar than dice worlds at the same slider.
    expect(prompt).toContain(`Aim them around ${typicalityTarget(10, true)}.`);
    expect(typicalityTarget(35, true)).toBe(69);
    expect(typicalityTarget(35)).toBe(57);
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

  it('keeps the hub’s pieces the model described for the image model, and nothing it made up', () => {
    const reply = JSON.stringify({
      worlds: [candidate('Kit', 40, { kit: { house: ' a cork hut ', lamp: 'a lens on a stone stump', roof: 'x', cart: 7 } }), candidate('Bare', 40)],
    });
    const [kit, bare] = parseWorlds(reply, ctx, 1000);
    expect(kit.kit).toEqual({ house: 'a cork hut', lamp: 'a lens on a stone stump' });
    expect(bare.kit).toBeUndefined();
    expect(genesisPrompt(ctx)).toContain('"kit"');
  });

  it('keeps each piece’s real size within what its slot allows, and drops what is not a size', () => {
    const reply = JSON.stringify({
      worlds: [candidate('Sized', 40, { sizes: { house: [3.6, 8.2], hall: [40, 900], lamp: ['2', 0.4], goods: [-1, 2], cart: 3, roof: [1, 1] } })],
    });
    const [w] = parseWorlds(reply, ctx, 1000);
    expect(w.sizes).toEqual({ house: { height: 3.6, width: 7.5 }, hall: { height: 10, width: 9 }, lamp: { height: 2, width: 0.4 } });
    expect(parseWorlds(JSON.stringify({ worlds: [candidate('Bare', 40)] }), ctx)[0].sizes).toBeUndefined();
    expect(genesisPrompt(ctx)).toContain('"sizes"');
  });

  it('keeps the ground a candidate described, in English, for the ground texture', () => {
    const reply = JSON.stringify({ worlds: [candidate('Mud', 40, { terrain: ' wet black mud with puddles ', cover: ' reeds and sedge ' }), candidate('Bare', 40)] });
    const [mud, bare] = parseWorlds(reply, ctx, 1000);
    expect(mud.terrain).toBe('wet black mud with puddles');
    expect(bare.terrain).toBeUndefined();
    expect(mud.cover).toBe('reeds and sedge');
    expect(bare.cover).toBeUndefined();
    expect(genesisPrompt(ctx)).toContain('"terrain"');
    expect(genesisPrompt(ctx)).toContain('"cover"');
  });

  it('asks an older world’s sizes from the lines its pieces were drawn from', () => {
    const world = { hub: 'Rust Halt', architecture: 'trucks', landmark: 'a rusted crane', kit: { house: 'a covered truck' } };
    const prompt = hubSizesPrompt(world);
    expect(prompt).toContain('house: a covered truck');
    expect(prompt).toContain('landmark: a rusted crane');
    expect(prompt).toContain('truck-sized');
    expect(parseHubSizes('```json\n{"sizes": {"house": [3.5, 7], "landmark": [9, 4]}}\n```')).toEqual({
      house: { height: 3.5, width: 7 },
      landmark: { height: 9, width: 4 },
    });
    expect(parseHubSizes('no idea')).toBeNull();
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
    // The relief is kept when it is one the land knows, and left out otherwise (the land takes one from the id).
    expect(parseLook({ relief: 'rugged' }).relief).toBe('rugged');
    expect('relief' in parseLook({ relief: 'alpine' })).toBe(false);
  });
});

describe('one world written out', () => {
  const kit = { house: 'a cork hut', hall: 'a brewery hall', tree: 'a fog mushroom', stall: 'a tap stand', cart: 'a barrel sled', lamp: 'a lens post', goods: 'kegs' };
  const answer = JSON.stringify({
    candidates: [
      { name: 'A', typicality: 10, pitch: 'One.' },
      { name: 'Latarnie', typicality: 30, pitch: 'Two.' },
    ],
    chosen: 2,
    // In the order the prompt asks for: what the hub is made of before the rest of the bible.
    world: (({ tone, tech, climate, people, threats, player, address, hub, words, ...first }) => ({
      ...first,
      landmark: 'a brass lighthouse',
      terrain: 'wet cork',
      sizes: { house: [3, 5] },
      kit,
      tone,
      tech,
      climate,
      people,
      threats,
      player,
      address,
      hub,
      words,
    }))(candidate('Latarnie', 30, { look: { ...CLASSIC_LOOK, flora: 'fungi' } })),
  });

  it('asks for sketches and the one the game’s rule picks, written out with its look and kit first', () => {
    const near = genesisPrompt(ctx);
    expect(near).toContain('the closest to');
    expect(near).not.toContain('SECOND');
    expect(genesisPrompt({ ...ctx, nth: 2 })).toContain('the SECOND closest to');
    expect(near.indexOf('"look"')).toBeLessThan(near.indexOf('"kit"'));
    expect(near.indexOf('"kit"')).toBeLessThan(near.indexOf('  "threats": string'));
    expect(demoGenesis({ ...ctx, nth: 2 }).nth).toBe(2);
    expect(demoGenesis({ ...ctx, nth: 7 }).nth).toBe(1);
  });

  it('reads the written-out world under the chosen candidate’s id', () => {
    const worlds = parseWorlds(answer, ctx, 1000);
    expect(worlds).toHaveLength(1);
    expect(worlds[0].name).toBe('Latarnie');
    expect(worlds[0].id).toBe(`w${(1000).toString(36)}1`);
    expect(worlds[0].kit?.cart).toBe('a barrel sled');
    expect(pickWorld(worlds, 85)).toBe(worlds[0]);
  });

  it('sees the hub’s makings in the stream before the bible is finished, under the same id', () => {
    // Cut in the middle of the world's words, after its kit.
    const half = answer.slice(0, answer.indexOf('"threats"') + 14);
    expect(parseWorlds(half, ctx, 1000)).toEqual([]);
    const early = previewWorld(half, ctx, 1000);
    expect(early?.id).toBe(parseWorlds(answer, ctx, 1000)[0].id);
    expect(early?.landmark).toBe('a brass lighthouse');
    expect(early?.kit?.goods).toBe('kegs');
    expect(early?.look.flora).toBe('fungi');
    // Not before the kit is whole.
    expect(previewWorld(answer.slice(0, answer.indexOf('"goods"')), ctx, 1000)).toBeNull();
  });
});

describe('partialJson', () => {
  it('keeps every value before the last comma, closing what is open', () => {
    expect(partialJson('{"a": 1, "b": {"c": "x, y", "d": [1, 2')).toEqual({ a: 1, b: { c: 'x, y', d: [1] } });
    expect(partialJson('{"a": "he said \\"hi, there')).toBeNull();
    expect(partialJson('noise {"a": [1, 2]} trailing')).toEqual({ a: [1, 2] });
  });
});

describe('firstObject', () => {
  it('reads an answer the model kept closing after it was whole', () => {
    expect(firstObject('{"world": {"name": "x}"}}\n }\n}\n}')).toEqual({ world: { name: 'x}' } });
    expect(parseWorlds(`${JSON.stringify({ chosen: 1, world: candidate('Ok', 20) })}\n }\n}`, ctx, 1)).toHaveLength(1);
  });
});
